import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Gerência de UM número: renomear, tornar padrão e remover.
//
// Três coisas aqui quebram em silêncio se ninguém travar:
//
//  1. tornar padrão precisa LIMPAR o padrão anterior antes de marcar o
//     novo. Existe um índice único parcial (migration 058) permitindo um
//     padrão por cliente — marcar primeiro viola a constraint e a troca
//     falha inteira, deixando o padrão antigo no lugar;
//  2. remover o padrão precisa PROMOVER outro. Sem padrão, toda conversa
//     nova nasce sem número definido;
//  3. o id de um número de OUTRO cliente não pode resolver. A RLS aqui
//     usa `is_account_member`, que vale para qualquer conta da pessoa —
//     não só a que ela está olhando.
// ---------------------------------------------------------------------------

/** Escritas na tabela, na ordem em que aconteceram. */
const escritas: Array<{
  op: "update" | "delete";
  payload?: Record<string, unknown>;
  filtros: Record<string, unknown>;
}> = [];

function makeDb() {
  return {
    from: vi.fn(() => {
      const registro: {
        op: "update" | "delete";
        payload?: Record<string, unknown>;
        filtros: Record<string, unknown>;
      } = { op: "update", filtros: {} };
      const b: Record<string, unknown> = {};
      b.update = vi.fn((payload: Record<string, unknown>) => {
        registro.op = "update";
        registro.payload = payload;
        escritas.push(registro);
        return b;
      });
      b.delete = vi.fn(() => {
        registro.op = "delete";
        escritas.push(registro);
        return b;
      });
      b.eq = vi.fn((col: string, val: unknown) => {
        registro.filtros[col] = val;
        return b;
      });
      b.then = (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null });
      return b;
    }),
  };
}

let db = makeDb();
let adminDb = makeDb();

vi.mock("@/lib/auth/account", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/account")>();
  return {
    ...actual,
    requireRole: vi.fn(async () => ({
      supabase: db,
      userId: "user-1",
      accountId: "acct-1",
      role: "admin",
      account: { id: "acct-1", name: "Acme" },
    })),
  };
});

vi.mock("@/lib/automations/admin-client", () => ({
  supabaseAdmin: vi.fn(() => adminDb),
}));

vi.mock("@/lib/whatsapp/evolution-api", () => ({
  isEvolutionConfigured: vi.fn(() => true),
  deleteInstance: vi.fn(async () => undefined),
}));

vi.mock("@/lib/whatsapp/proxy-pool", () => ({
  releaseProxy: vi.fn(async () => undefined),
}));

const VENDAS = {
  id: "inst-vendas",
  account_id: "acct-1",
  instance_name: "inst-vendas",
  status: "connected",
  phone: "+5531999990001",
  label: "Vendas",
  is_default: true,
};
const SUPORTE = {
  id: "inst-suporte",
  account_id: "acct-1",
  instance_name: "inst-suporte",
  status: "connected",
  phone: "+5531999990002",
  label: "Suporte",
  is_default: false,
};

vi.mock("@/lib/whatsapp/instances", () => ({
  listarInstancias: vi.fn(async () => [VENDAS, SUPORTE]),
}));

const { deleteInstance } = await import("@/lib/whatsapp/evolution-api");
const { releaseProxy } = await import("@/lib/whatsapp/proxy-pool");
const { PATCH, DELETE } = await import("./route");

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}
function req(corpo?: Record<string, unknown>) {
  return new Request("https://app.example.com/x", {
    method: "PATCH",
    headers: corpo ? { "content-type": "application/json" } : {},
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
}

beforeEach(() => {
  escritas.length = 0;
  db = makeDb();
  adminDb = makeDb();
  vi.mocked(deleteInstance).mockClear();
  vi.mocked(releaseProxy).mockClear();
});

describe("PATCH /api/whatsapp/evolution/instances/[id]", () => {
  it("tornar padrão LIMPA o anterior antes de marcar o novo", async () => {
    const res = await PATCH(req({ isDefault: true }), ctx("inst-suporte"));
    expect(res.status).toBe(200);

    // A ordem é o que importa: limpar depois de marcar violaria o índice
    // único parcial e a troca falharia inteira.
    const [primeira, segunda] = escritas;
    expect(primeira.payload).toEqual({ is_default: false });
    expect(primeira.filtros).toEqual({
      account_id: "acct-1",
      is_default: true,
    });
    expect(segunda.payload).toEqual({ is_default: true });
    expect(segunda.filtros).toEqual({ id: "inst-suporte" });
  });

  it("apelido vazio volta a ser NULL, não string vazia", async () => {
    // A lista mostra o telefone quando não há apelido; gravar "" faria o
    // nome do número sumir da tela.
    const res = await PATCH(req({ label: "   " }), ctx("inst-suporte"));
    expect(res.status).toBe(200);
    expect(escritas[0].payload).toEqual({ label: null });
  });

  it("apelido é aparado e limitado", async () => {
    await PATCH(req({ label: "  Comercial  " }), ctx("inst-suporte"));
    expect(escritas[0].payload).toEqual({ label: "Comercial" });
  });

  it("número de outro cliente devolve 404 e não escreve nada", async () => {
    const res = await PATCH(req({ label: "X" }), ctx("inst-de-outra-conta"));
    expect(res.status).toBe(404);
    expect(escritas).toHaveLength(0);
  });

  it("corpo sem nada para mudar devolve 400", async () => {
    const res = await PATCH(req({}), ctx("inst-suporte"));
    expect(res.status).toBe(400);
    expect(escritas).toHaveLength(0);
  });
});

describe("DELETE /api/whatsapp/evolution/instances/[id]", () => {
  it("remover o PADRÃO promove outro número", async () => {
    const res = await DELETE(req(), ctx("inst-vendas"));
    expect(res.status).toBe(200);

    const promocao = escritas.find(
      (e) => e.op === "update" && e.payload?.is_default === true,
    );
    expect(promocao?.filtros).toEqual({ id: "inst-suporte" });
  });

  it("remover um número comum NÃO mexe no padrão", async () => {
    const res = await DELETE(req(), ctx("inst-suporte"));
    expect(res.status).toBe(200);
    expect(escritas.some((e) => e.payload?.is_default === true)).toBe(false);
  });

  it("apaga na Evolution e solta o proxy DAQUELE número", async () => {
    await DELETE(req(), ctx("inst-suporte"));
    expect(deleteInstance).toHaveBeenCalledWith("inst-suporte");
    // Com o nome: soltar por conta liberaria a vaga dos outros números
    // e o pool passaria a achar que tem IP livre que não tem.
    expect(releaseProxy).toHaveBeenCalledWith(
      expect.anything(),
      "acct-1",
      "inst-suporte",
    );
  });

  it("a linha só é apagada DEPOIS da Evolution", async () => {
    // Se a linha sumisse primeiro e a Evolution falhasse, a sessão
    // ficaria de pé sem nada apontando para ela — e o nome dela mora
    // justamente na linha que teria sido apagada.
    const ordem: string[] = [];
    vi.mocked(deleteInstance).mockImplementation(async () => {
      ordem.push("evolution");
    });
    adminDb = {
      from: vi.fn(() => {
        const b: Record<string, unknown> = {};
        b.delete = vi.fn(() => {
          ordem.push("banco");
          return b;
        });
        b.update = vi.fn(() => b);
        b.eq = vi.fn(() => b);
        b.then = (resolve: (v: unknown) => void) =>
          resolve({ data: null, error: null });
        return b;
      }),
    };

    await DELETE(req(), ctx("inst-suporte"));
    expect(ordem).toEqual(["evolution", "banco"]);
  });

  it("Evolution fora do ar não impede a remoção no CRM", async () => {
    vi.mocked(deleteInstance).mockRejectedValueOnce(new Error("rede caiu"));
    const res = await DELETE(req(), ctx("inst-suporte"));
    expect(res.status).toBe(200);
    expect(escritas.some((e) => e.op === "delete")).toBe(true);
  });

  it("número de outro cliente devolve 404 e não toca na Evolution", async () => {
    const res = await DELETE(req(), ctx("inst-de-outra-conta"));
    expect(res.status).toBe(404);
    expect(deleteInstance).not.toHaveBeenCalled();
    expect(escritas).toHaveLength(0);
  });
});
