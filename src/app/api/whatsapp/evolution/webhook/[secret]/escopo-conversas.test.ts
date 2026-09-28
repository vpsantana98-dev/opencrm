import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// "Quais conversas guardar" (migration 059).
//
// Arquivo separado do route.test.ts de propósito: aquele monta um duplo
// de Supabase inteiro para outras propriedades, e o que interessa aqui é
// uma decisão só — se a mensagem de grupo é DESCARTADA na entrada.
//
// O risco desta funcionalidade é descartar demais. Uma conta com o
// padrão ('todas') que parasse de receber grupo, ou pior, que parasse de
// receber 1:1, perderia mensagem de cliente sem nenhum erro aparecendo
// em lugar nenhum. Por isso os dois lados estão travados aqui.
// ---------------------------------------------------------------------------

/** O que a conta respondeu no cadastro. Trocado por teste. */
let escopoDaConta = "todas";

const resolvidas: string[] = [];

function makeDb() {
  return {
    from: vi.fn((tabela: string) => {
      const b: Record<string, unknown> = {};
      const chain = () => b;
      for (const m of ["select", "insert", "update", "order", "limit", "eq"]) {
        b[m] = vi.fn(chain);
      }
      b.maybeSingle = vi.fn(() => {
        if (tabela === "evolution_instances") {
          return Promise.resolve({
            data: { id: "inst-1", account_id: "acct-1" },
            error: null,
          });
        }
        if (tabela === "accounts") {
          return Promise.resolve({
            data: { conversation_scope: escopoDaConta },
            error: null,
          });
        }
        // `messages` (checagem de duplicata) e o resto: nada encontrado.
        return Promise.resolve({ data: null, error: null });
      });
      b.single = vi.fn(() => Promise.resolve({ data: null, error: null }));
      b.then = (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null });
      return b;
    }),
  };
}

let db = makeDb();

vi.mock("@/lib/automations/admin-client", () => ({
  supabaseAdmin: vi.fn(() => db),
}));

// As duas resoluções apenas registram que foram chamadas — é o sinal de
// "esta mensagem seria gravada". Elas lançam depois para o resto do
// pipeline (mídia, automações, webhooks) não precisar de duplo.
vi.mock("@/lib/whatsapp/resolve-group", () => ({
  resolveGroupConversation: vi.fn(async () => {
    resolvidas.push("grupo");
    throw new Error("parar aqui");
  }),
}));
vi.mock("@/lib/whatsapp/resolve-conversation", () => ({
  resolveConversationByPhone: vi.fn(async () => {
    resolvidas.push("individual");
    throw new Error("parar aqui");
  }),
}));

vi.mock("@/lib/whatsapp/evolution-api", () => ({
  getInstanceNumber: vi.fn(async () => null),
  getGroupSubject: vi.fn(async () => "Grupo"),
}));
vi.mock("@/lib/whatsapp/capture-instance-phone", () => ({
  captureInstancePhone: vi.fn(async () => undefined),
}));

const { POST } = await import("./route");

const SEGREDO = "segredo-de-teste";

function mensagem(jid: string) {
  return {
    event: "messages.upsert",
    instance: "inst-1",
    data: {
      key: { id: `msg-${jid}`, remoteJid: jid, fromMe: false },
      pushName: "Fulano",
      message: { conversation: "oi" },
      messageTimestamp: 1_700_000_000,
    },
  };
}

function chamar(jid: string) {
  const request = new Request(
    `https://app.example.com/api/whatsapp/evolution/webhook/${SEGREDO}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(mensagem(jid)),
    },
  );
  return POST(request, { params: Promise.resolve({ secret: SEGREDO }) });
}

beforeEach(() => {
  resolvidas.length = 0;
  db = makeDb();
  escopoDaConta = "todas";
  process.env.EVOLUTION_WEBHOOK_SECRET = SEGREDO;
});

describe("escopo de conversas no webhook", () => {
  it("padrão ('todas'): grupo entra", async () => {
    escopoDaConta = "todas";
    await chamar("120363000000000000@g.us");
    expect(resolvidas).toEqual(["grupo"]);
  });

  it("'sem_grupos': grupo é descartado ANTES de gravar qualquer coisa", async () => {
    // Antes de gravar importa: filtrar só na exibição já teria criado o
    // contato-grupo, a conversa e baixado as mídias para o storage.
    escopoDaConta = "sem_grupos";
    await chamar("120363000000000000@g.us");
    expect(resolvidas).toEqual([]);
  });

  it("'sem_grupos' NÃO afeta conversa individual", async () => {
    // O erro caro seria este: uma conta que quis silenciar grupos parar
    // de receber mensagem de cliente, sem nenhum sinal de erro.
    escopoDaConta = "sem_grupos";
    await chamar("5531999998888@s.whatsapp.net");
    expect(resolvidas).toEqual(["individual"]);
  });

  it("conta sem preferência gravada se comporta como 'todas'", async () => {
    // Clientes que já existem não têm resposta nenhuma. Qualquer coisa
    // diferente de 'sem_grupos' precisa deixar passar.
    escopoDaConta = "";
    await chamar("120363000000000000@g.us");
    expect(resolvidas).toEqual(["grupo"]);
  });
});
