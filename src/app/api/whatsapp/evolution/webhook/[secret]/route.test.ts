import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Testes do gate de autenticação de POST /api/whatsapp/evolution/webhook/
// [secret] (Task 8). O gate são só doze linhas no topo da rota; o ponto
// destes testes é travar a propriedade "nada acontece sem o segredo certo",
// não testar o parsing da mensagem em si (isso já existia antes da Task 8 e
// não foi alterado).
//
// "Nada acontece" é verificado de duas formas:
//   - `supabaseAdmin()` (o único jeito da rota falar com o banco) nunca é
//     chamado quando o gate barra a requisição.
//   - nenhuma tabela é consultada (`fromCalls` fica vazio).
// ---------------------------------------------------------------------------

const fromCalls: string[] = [];
const eqCalls: Array<[string, unknown]> = [];
const inCalls: Array<[string, unknown[]]> = [];

function makeSupabaseMock(options?: {
  instanceAccountId?: string;
  messageTargetIds?: string[];
}) {
  function builder(table: string) {
    const b: Record<string, unknown> = {};
    let isUpdate = false;
    const chain = () => b;
    for (const m of ["select", "insert", "order", "limit"]) {
      b[m] = vi.fn(chain);
    }
    b.eq = vi.fn((column: string, value: unknown) => {
      eqCalls.push([column, value]);
      return b;
    });
    b.in = vi.fn((column: string, values: unknown[]) => {
      inCalls.push([column, values]);
      return b;
    });
    b.update = vi.fn(() => {
      isUpdate = true;
      return b;
    });
    b.maybeSingle = vi.fn(() =>
      Promise.resolve({
        data:
          table === "evolution_instances" && options?.instanceAccountId
            ? { account_id: options.instanceAccountId }
            : null,
        error: null,
      }),
    );
    b.single = vi.fn(() => Promise.resolve({ data: null, error: null }));
    b.then = (resolve: (v: unknown) => unknown) => {
      if (table === "messages" && !isUpdate && options?.messageTargetIds) {
        return resolve({
          data: options.messageTargetIds.map((id) => ({ id })),
          error: null,
        });
      }
      return resolve({ data: null, error: null });
    };
    return b;
  }

  return {
    from: vi.fn((table: string) => {
      fromCalls.push(table);
      return builder(table);
    }),
  };
}

let supabaseMock = makeSupabaseMock();

vi.mock("@/lib/automations/admin-client", () => ({
  supabaseAdmin: vi.fn(() => supabaseMock),
}));

vi.mock("@/lib/whatsapp/resolve-conversation", () => ({
  resolveConversationByPhone: vi.fn(),
}));

const { supabaseAdmin } = await import("@/lib/automations/admin-client");
const { POST } = await import("./route");

function postWebhook(
  secret: string,
  body: Record<string, unknown> = { instance: "acct-1", event: "connection_update", data: {} },
) {
  return POST(
    new Request(`http://localhost/api/whatsapp/evolution/webhook/${secret}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ secret }) },
  );
}

describe("POST /api/whatsapp/evolution/webhook/[secret]: gate de autenticação", () => {
  const ORIGINAL_SECRET = process.env.EVOLUTION_WEBHOOK_SECRET;

  beforeEach(() => {
    fromCalls.length = 0;
    eqCalls.length = 0;
    inCalls.length = 0;
    supabaseMock = makeSupabaseMock();
    vi.mocked(supabaseAdmin).mockImplementation(() => supabaseMock as never);
    delete process.env.EVOLUTION_WEBHOOK_SECRET;
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) {
      delete process.env.EVOLUTION_WEBHOOK_SECRET;
    } else {
      process.env.EVOLUTION_WEBHOOK_SECRET = ORIGINAL_SECRET;
    }
  });

  it("não processa nada e responde 200 quando a env do segredo está ausente", async () => {
    // process.env.EVOLUTION_WEBHOOK_SECRET já está ausente (beforeEach).
    const res = await postWebhook("qualquer-coisa");
    const json = await res.json();

    // Fail-closed com {ok:true}: a Evolution não reentra em loop de retry,
    // mas nada é lido nem escrito no banco.
    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(supabaseAdmin).not.toHaveBeenCalled();
    expect(fromCalls).toHaveLength(0);
  });

  it("responde 404 e não processa nada quando o segredo do caminho está errado (comprimento diferente)", async () => {
    process.env.EVOLUTION_WEBHOOK_SECRET = "segredo-correto";

    const res = await postWebhook("segredo-errado");
    const json = await res.json();

    // 404, não 401: não confirma pra quem está sondando que o caminho
    // existe.
    expect(res.status).toBe(404);
    expect(json).toEqual({ error: "Not found" });
    expect(supabaseAdmin).not.toHaveBeenCalled();
    expect(fromCalls).toHaveLength(0);
  });

  it("responde 404 e não processa nada quando o segredo do caminho está errado (MESMO comprimento)", async () => {
    // Caso crítico: "segredo-errado" acima tem 14 chars contra os 15 de
    // "segredo-correto", então só exercita o ramo de comprimento
    // diferente de secretMatches (o `if (providedBuf.length !==
    // expectedBuf.length)`). Em produção o segredo tem sempre 64 chars
    // (`openssl rand -hex 32`), comprimento PÚBLICO (documentado em
    // .env.local.example): um atacante sempre acerta o comprimento, e
    // cairia exatamente no ramo que o teste acima não cobre (a chamada
    // real a `timingSafeEqual`). Este teste usa um segredo do MESMO
    // comprimento do correto, diferindo só no último caractere, pra
    // travar esse ramo também.
    process.env.EVOLUTION_WEBHOOK_SECRET = "segredo-correto";

    const res = await postWebhook("segredo-corretX");
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json).toEqual({ error: "Not found" });
    expect(supabaseAdmin).not.toHaveBeenCalled();
    expect(fromCalls).toHaveLength(0);
  });

  it("passa pelo gate e processa a requisição quando o segredo do caminho bate", async () => {
    process.env.EVOLUTION_WEBHOOK_SECRET = "segredo-correto";

    const res = await postWebhook("segredo-correto");

    expect(res.status).toBe(200);
    // Chegou a consultar o banco pra resolver a instância → conta, ou
    // seja, o gate deixou passar (o brief não muda o que acontece depois
    // disso, então não afirmamos mais que isso aqui).
    expect(supabaseAdmin).toHaveBeenCalled();
    expect(fromCalls).toContain("evolution_instances");
  });

  it("trata a env do segredo só com espaço como ausente (fail-closed)", async () => {
    process.env.EVOLUTION_WEBHOOK_SECRET = "   ";

    const res = await postWebhook("   ");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(supabaseAdmin).not.toHaveBeenCalled();
    expect(fromCalls).toHaveLength(0);
  });

  it("limita ACK de entrega a mensagens da conta da instancia", async () => {
    process.env.EVOLUTION_WEBHOOK_SECRET = "segredo-correto";
    supabaseMock = makeSupabaseMock({
      instanceAccountId: "acct-a",
      messageTargetIds: ["internal-message-a"],
    });
    vi.mocked(supabaseAdmin).mockImplementation(() => supabaseMock as never);

    const res = await postWebhook("segredo-correto", {
      instance: "instance-a",
      event: "messages.update",
      data: [{ key: { id: "shared-wa-id" }, update: { status: 2 } }],
    });

    expect(res.status).toBe(200);
    expect(eqCalls).toContainEqual(["message_id", "shared-wa-id"]);
    expect(eqCalls).toContainEqual(["conversations.account_id", "acct-a"]);
    expect(inCalls).toContainEqual(["id", ["internal-message-a"]]);
  });
});
