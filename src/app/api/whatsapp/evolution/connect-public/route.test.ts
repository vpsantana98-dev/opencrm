import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Task 8, rodada 3: teste de rota para POST /api/whatsapp/evolution/connect-
// public. Mesma motivação de connect/route.test.ts: src/lib/http/
// base-url.test.ts prova que resolveConfiguredBaseUrl() é seguro; nada
// provava que ESTA ROTA o chama de fato. O revisor reproduziu o bug da
// rodada 1 justamente sabotando este arquivo (trocando de volta pra
// resolveBaseUrl com fallback de header) e nada detectou, porque não havia
// teste de rota nenhum aqui.
//
// connect-public não exige login (só um token de conexão válido na URL do
// link, que é o que a agência manda por WhatsApp pro cliente final), então
// a barreira pra forjar X-Forwarded-Host é ainda mais baixa que em connect.
//
// Task 5 (fase antiban): a rota agora atribui um proxy do pool ANTES de
// criar a instância na Evolution, e passa a config para createInstance
// como terceiro parâmetro. O describe "aplica o proxy antes do QR" trava
// a propriedade central da task: se assignProxy lançar (pool esgotado), a
// rota recusa e a Evolution NUNCA é chamada. Sem isso, uma instância
// poderia nascer sem proxy e ter o pareamento registrado pelo IP da VPS,
// pior ainda aqui porque a rota é pública (sem login).
// ---------------------------------------------------------------------------

function makeAdminMock() {
  const updateCalls: Array<{
    table: string;
    payload: Record<string, unknown>;
  }> = [];

  function builder(table: string) {
    const b: Record<string, unknown> = {};
    const chain = () => b;
    b.select = vi.fn(chain);
    b.eq = vi.fn(chain);
    b.update = vi.fn((payload: Record<string, unknown>) => {
      updateCalls.push({ table, payload });
      return b;
    });
    // .select(...).eq(...).maybeSingle() é terminal: sempre devolve uma
    // instância válida, já que o hash do token não é o que este arquivo
    // testa (isso é comportamento pré-existente, não tocado pela Task 8).
    b.maybeSingle = vi.fn(() =>
      Promise.resolve({
        data: { account_id: "acct-1", instance_name: "acct-1", phone: null },
        error: null,
      }),
    );
    // .update(...).eq(...) é awaited direto (sem .maybeSingle()) no
    // código real, então o builder precisa ser "thenable".
    b.then = (resolve: (v: unknown) => unknown) =>
      resolve(Promise.resolve({ data: null, error: null }));
    return b;
  }

  return {
    from: vi.fn((table: string) => builder(table)),
    updateCalls,
  };
}

let adminMock = makeAdminMock();

vi.mock("@/lib/automations/admin-client", () => ({
  supabaseAdmin: vi.fn(() => adminMock),
}));

vi.mock("@/lib/whatsapp/evolution-api", () => ({
  isEvolutionConfigured: vi.fn(() => true),
  createInstance: vi.fn(async () => ({
    base64: "data:image/png;base64,QVo=",
    pairingCode: null,
  })),
}));

// Preserva a classe real ProxyPoolError (a rota faz `instanceof`), só
// mocka assignProxyIfAvailable.
vi.mock("@/lib/whatsapp/proxy-pool", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/whatsapp/proxy-pool")>();
  return {
    ...actual,
    assignProxyIfAvailable: vi.fn(async () => ({
      proxyId: "proxy-1",
      config: {
        host: "203.0.113.10",
        port: 8080,
        protocol: "http" as const,
        username: "proxy-user",
        password: "proxy-pass",
      },
    })),
  };
});

const { createInstance } = await import("@/lib/whatsapp/evolution-api");
const { assignProxyIfAvailable, ProxyPoolError } = await import(
  "@/lib/whatsapp/proxy-pool"
);
const { POST } = await import("./route");

function callConnectPublic(headers: Record<string, string> = {}) {
  return POST(
    new Request(
      "https://app.example.com/api/whatsapp/evolution/connect-public",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ token: "qualquer-token-de-conexao" }),
      },
    ),
  );
}

describe("POST /api/whatsapp/evolution/connect-public: origem da URL do webhook", () => {
  const ORIGINAL_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;
  const ORIGINAL_SECRET = process.env.EVOLUTION_WEBHOOK_SECRET;

  beforeEach(() => {
    adminMock = makeAdminMock();
    vi.mocked(createInstance).mockClear();
    vi.mocked(assignProxyIfAvailable).mockClear();
    delete process.env.NEXT_PUBLIC_SITE_URL;
    // Setado pra garantir que o teste alcança a checagem de origem (o
    // segredo do webhook é checado ANTES, e sem ele a rota já devolveria
    // 503 por um motivo diferente do que este arquivo testa).
    process.env.EVOLUTION_WEBHOOK_SECRET = "segredo-de-teste";
  });

  afterEach(() => {
    if (ORIGINAL_SITE_URL === undefined) {
      delete process.env.NEXT_PUBLIC_SITE_URL;
    } else {
      process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL_SITE_URL;
    }
    if (ORIGINAL_SECRET === undefined) {
      delete process.env.EVOLUTION_WEBHOOK_SECRET;
    } else {
      process.env.EVOLUTION_WEBHOOK_SECRET = ORIGINAL_SECRET;
    }
  });

  it("sem NEXT_PUBLIC_SITE_URL, recusa com 503 mesmo com X-Forwarded-Host de atacante, e não chama a Evolution", async () => {
    const res = await callConnectPublic({ "x-forwarded-host": "evil.tld" });
    const json = await res.json();

    expect(res.status).toBe(503);
    expect(json.error).toMatch(/URL pública/i);
    expect(createInstance).not.toHaveBeenCalled();
  });

  it("com NEXT_PUBLIC_SITE_URL setada, usa a env e ignora o X-Forwarded-Host de atacante", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://crm.example.com";

    const res = await callConnectPublic({ "x-forwarded-host": "evil.tld" });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.qr).toBeTruthy();
    expect(createInstance).toHaveBeenCalledTimes(1);

    const [, webhookUrl] = vi.mocked(createInstance).mock.calls[0] as [
      string,
      string,
      unknown,
    ];
    expect(webhookUrl).toBe(
      "https://crm.example.com/api/whatsapp/evolution/webhook/segredo-de-teste",
    );
    expect(webhookUrl).not.toContain("evil.tld");
  });
});

describe("POST /api/whatsapp/evolution/connect-public: aplica o proxy antes do QR", () => {
  const ORIGINAL_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;
  const ORIGINAL_SECRET = process.env.EVOLUTION_WEBHOOK_SECRET;

  beforeEach(() => {
    adminMock = makeAdminMock();
    vi.mocked(createInstance).mockClear();
    vi.mocked(assignProxyIfAvailable).mockReset();
    vi.mocked(assignProxyIfAvailable).mockImplementation(async () => ({
      proxyId: "proxy-1",
      config: {
        host: "203.0.113.10",
        port: 8080,
        protocol: "http" as const,
        username: "proxy-user",
        password: "proxy-pass",
      },
    }));
    process.env.NEXT_PUBLIC_SITE_URL = "https://crm.example.com";
    process.env.EVOLUTION_WEBHOOK_SECRET = "segredo-de-teste";
  });

  afterEach(() => {
    if (ORIGINAL_SITE_URL === undefined) {
      delete process.env.NEXT_PUBLIC_SITE_URL;
    } else {
      process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL_SITE_URL;
    }
    if (ORIGINAL_SECRET === undefined) {
      delete process.env.EVOLUTION_WEBHOOK_SECRET;
    } else {
      process.env.EVOLUTION_WEBHOOK_SECRET = ORIGINAL_SECRET;
    }
  });

  it("passa a config do proxy como terceiro argumento de createInstance", async () => {
    const res = await callConnectPublic();
    expect(res.status).toBe(200);
    expect(assignProxyIfAvailable).toHaveBeenCalledTimes(1);
    expect(createInstance).toHaveBeenCalledTimes(1);

    const [, , proxyConfig] = vi.mocked(createInstance).mock.calls[0] as [
      string,
      string,
      { host: string },
    ];
    expect(proxyConfig).toEqual({
      host: "203.0.113.10",
      port: 8080,
      protocol: "http",
      username: "proxy-user",
      password: "proxy-pass",
    });
  });

  it("propriedade central: se o pool de proxies está esgotado, a rota recusa e NUNCA cria a instância na Evolution", async () => {
    vi.mocked(assignProxyIfAvailable).mockImplementation(async () => {
      throw new ProxyPoolError("proxy_pool_exhausted");
    });

    const res = await callConnectPublic();
    const json = await res.json();

    expect(res.status).toBe(503);
    expect(json.error).toMatch(/capacidade máxima/i);
    expect(createInstance).not.toHaveBeenCalled();
  });
});
