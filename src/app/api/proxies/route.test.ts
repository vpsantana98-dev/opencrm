import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Review final, item 3: o portão de autorização do pool não tinha proteção
// contra regressão.
//
// Provado por sabotagem no review: apagar `await requirePlatformAdmin();` dos
// quatro handlers do pool deixava a suíte inteira verde, o typecheck limpo e
// o lint sem erro. O que esse portão guarda é o ativo mais valioso da branch:
// quem passa por ele reescreve `host` e `port` de um proxy que atende OUTROS
// clientes, e desvia o tráfego de WhatsApp deles para um servidor que
// controla.
//
// Este arquivo cobre GET e POST /api/proxies; o PATCH e o DELETE estão em
// [id]/route.test.ts. `requirePlatformAdmin` NÃO é mockado de propósito: o
// que precisa ser travado é a LIGAÇÃO entre a rota e o portão, e um mock do
// portão apagaria justamente isso. O que se mocka é a camada abaixo dele
// (sessão do Supabase) e o cliente de service role, para provar que ele nem é
// instanciado quando a autorização falha.
// ---------------------------------------------------------------------------

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const OUTSIDER_ID = "22222222-2222-4222-8222-222222222222";

const getUser = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

function makeAdmin() {
  function builder(table: string) {
    const b: Record<string, unknown> = {};
    b.select = vi.fn(() => b);
    b.order = vi.fn(() => b);
    b.not = vi.fn(() => b);
    b.eq = vi.fn(() => b);
    b.insert = vi.fn(() => b);
    b.single = vi.fn(() =>
      Promise.resolve({ data: { id: "proxy-1", label: "SP-01" }, error: null }),
    );
    b.then = (resolve: (v: unknown) => unknown) =>
      resolve(
        table === "proxies"
          ? { data: [], error: null }
          : { data: [], error: null },
      );
    return b;
  }
  return { from: vi.fn((table: string) => builder(table)) };
}

let adminMock = makeAdmin();

vi.mock("@/lib/automations/admin-client", () => ({
  supabaseAdmin: vi.fn(() => adminMock),
}));

const { supabaseAdmin } = await import("@/lib/automations/admin-client");
const { GET, POST } = await import("./route");

function postProxy() {
  return POST(
    new Request("https://crm.example.com/api/proxies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "SP-01", host: "203.0.113.10", port: 8080 }),
    }),
  );
}

describe("/api/proxies: só platform admin passa", () => {
  const ORIGINAL = process.env.PLATFORM_ADMIN_USER_IDS;

  beforeEach(() => {
    adminMock = makeAdmin();
    getUser.mockResolvedValue({
      data: { user: { id: OUTSIDER_ID } },
      error: null,
    });
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
      // Usuário autenticado, e ainda assim negado: a env ausente
      // significa que ninguém é admin de plataforma.
      getUser.mockResolvedValue({
        data: { user: { id: ADMIN_ID } },
        error: null,
      });
    });

    it("GET nega e não toca no banco", async () => {
      const res = await GET();

      expect(res.status).toBe(403);
      expect(supabaseAdmin).not.toHaveBeenCalled();
    });

    it("POST nega e não toca no banco", async () => {
      const res = await postProxy();

      expect(res.status).toBe(403);
      expect(supabaseAdmin).not.toHaveBeenCalled();
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

    it("GET nega e não toca no banco", async () => {
      const res = await GET();

      expect(res.status).toBe(403);
      expect(supabaseAdmin).not.toHaveBeenCalled();
    });

    it("POST nega e não toca no banco", async () => {
      const res = await postProxy();

      expect(res.status).toBe(403);
      expect(supabaseAdmin).not.toHaveBeenCalled();
    });
  });

  // Sem estes dois, a bateria acima ficaria verde numa rota que negasse
  // tudo (ou que nem existisse). Eles provam que o 403 vem do portão, e
  // não de outro erro no caminho.
  describe("usuário na allowlist", () => {
    beforeEach(() => {
      process.env.PLATFORM_ADMIN_USER_IDS = ADMIN_ID;
      getUser.mockResolvedValue({
        data: { user: { id: ADMIN_ID } },
        error: null,
      });
    });

    it("GET passa e chega ao banco", async () => {
      const res = await GET();

      expect(res.status).toBe(200);
      expect(supabaseAdmin).toHaveBeenCalled();
    });

    it("POST passa e chega ao banco", async () => {
      const res = await postProxy();

      expect(res.status).toBe(201);
      expect(supabaseAdmin).toHaveBeenCalled();
    });
  });
});
