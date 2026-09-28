import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Review final, item 3 (continuação de ../route.test.ts): PATCH e DELETE de
// /api/proxies/[id].
//
// O PATCH é o handler mais perigoso da branch: quem passa por ele reescreve
// `host` e `port` de um proxy GLOBAL, que atende outros clientes, e desvia o
// tráfego de WhatsApp deles para um servidor que controla. Sem
// `requirePlatformAdmin`, qualquer cadastrado no CRM faria isso, porque a
// rota usa o cliente com service role (ignora RLS) e `proxies` não tem
// account_id.
//
// Como em ../route.test.ts, `requirePlatformAdmin` NÃO é mockado: o que
// precisa ser travado é a ligação entre a rota e o portão.
// ---------------------------------------------------------------------------

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const OUTSIDER_ID = "22222222-2222-4222-8222-222222222222";

const getUser = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

function makeAdmin() {
  const updates: Array<Record<string, unknown>> = [];
  const deletes: string[] = [];

  function builder(table: string) {
    const state = { isDelete: false };
    const b: Record<string, unknown> = {};
    b.select = vi.fn(() => b);
    b.eq = vi.fn((column: string, value: unknown) => {
      if (state.isDelete && column === "id") deletes.push(String(value));
      return b;
    });
    b.update = vi.fn((payload: Record<string, unknown>) => {
      updates.push(payload);
      return b;
    });
    b.delete = vi.fn(() => {
      state.isDelete = true;
      return b;
    });
    b.maybeSingle = vi.fn(() =>
      Promise.resolve({ data: { id: "proxy-1", host: "203.0.113.10" }, error: null }),
    );
    b.then = (resolve: (v: unknown) => unknown) =>
      resolve(
        table === "evolution_instances"
          ? { data: [], error: null, count: 0 }
          : { data: null, error: null },
      );
    return b;
  }

  return {
    client: { from: vi.fn((table: string) => builder(table)) },
    updates,
    deletes,
  };
}

let adminState = makeAdmin();

vi.mock("@/lib/automations/admin-client", () => ({
  supabaseAdmin: vi.fn(() => adminState.client),
}));

const { supabaseAdmin } = await import("@/lib/automations/admin-client");
const { PATCH, DELETE } = await import("./route");

const params = Promise.resolve({ id: "proxy-1" });

/** O ataque que o portão bloqueia: sequestrar o host de um proxy alheio. */
function patchProxy() {
  return PATCH(
    new Request("https://crm.example.com/api/proxies/proxy-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "198.51.100.66", port: 3128 }),
    }),
    { params },
  );
}

function deleteProxy() {
  return DELETE(
    new Request("https://crm.example.com/api/proxies/proxy-1", {
      method: "DELETE",
    }),
    { params },
  );
}

describe("/api/proxies/[id]: só platform admin passa", () => {
  const ORIGINAL = process.env.PLATFORM_ADMIN_USER_IDS;

  beforeEach(() => {
    adminState = makeAdmin();
  });

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.PLATFORM_ADMIN_USER_IDS;
    } else {
      process.env.PLATFORM_ADMIN_USER_IDS = ORIGINAL;
    }
  });

  describe("sem PLATFORM_ADMIN_USER_IDS configurada", () => {
    beforeEach(() => {
      delete process.env.PLATFORM_ADMIN_USER_IDS;
      getUser.mockResolvedValue({
        data: { user: { id: ADMIN_ID } },
        error: null,
      });
    });

    it("PATCH nega e não reescreve o host de ninguém", async () => {
      const res = await patchProxy();

      expect(res.status).toBe(403);
      expect(supabaseAdmin).not.toHaveBeenCalled();
      expect(adminState.updates).toHaveLength(0);
    });

    it("DELETE nega e não remove nada", async () => {
      const res = await deleteProxy();

      expect(res.status).toBe(403);
      expect(supabaseAdmin).not.toHaveBeenCalled();
      expect(adminState.deletes).toHaveLength(0);
    });
  });

  describe("usuário autenticado fora da allowlist", () => {
    beforeEach(() => {
      process.env.PLATFORM_ADMIN_USER_IDS = ADMIN_ID;
      getUser.mockResolvedValue({
        data: { user: { id: OUTSIDER_ID } },
        error: null,
      });
    });

    it("PATCH nega e não reescreve o host de ninguém", async () => {
      const res = await patchProxy();

      expect(res.status).toBe(403);
      expect(supabaseAdmin).not.toHaveBeenCalled();
      expect(adminState.updates).toHaveLength(0);
    });

    it("DELETE nega e não remove nada", async () => {
      const res = await deleteProxy();

      expect(res.status).toBe(403);
      expect(supabaseAdmin).not.toHaveBeenCalled();
      expect(adminState.deletes).toHaveLength(0);
    });
  });

  describe("usuário na allowlist", () => {
    beforeEach(() => {
      process.env.PLATFORM_ADMIN_USER_IDS = ADMIN_ID;
      getUser.mockResolvedValue({
        data: { user: { id: ADMIN_ID } },
        error: null,
      });
    });

    it("PATCH passa e grava a alteração", async () => {
      const res = await patchProxy();

      expect(res.status).toBe(200);
      expect(adminState.updates).toHaveLength(1);
      expect(adminState.updates[0]).toMatchObject({ host: "198.51.100.66" });
    });

    it("DELETE passa e remove o proxy", async () => {
      const res = await deleteProxy();

      expect(res.status).toBe(200);
      expect(adminState.deletes).toEqual(["proxy-1"]);
    });
  });
});
