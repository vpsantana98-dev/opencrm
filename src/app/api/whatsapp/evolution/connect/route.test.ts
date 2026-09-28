import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Task 8, rodada 3: teste de rota para POST /api/whatsapp/evolution/connect.
//
// src/lib/http/base-url.test.ts prova que resolveConfiguredBaseUrl() é
// seguro (ignora headers, só aceita NEXT_PUBLIC_SITE_URL validada). Nada
// provava que ESTA ROTA de fato chama essa função em vez de resolveBaseUrl
// com fallback de header. Foi exatamente essa junta que a rodada 1 quebrou
// (a implementação inicial usava resolveBaseUrl com fallback pra
// X-Forwarded-Host) e nenhum teste pegou, porque não existia teste de rota
// nenhum aqui. Este arquivo trava a propriedade fim a fim: com a env
// ausente, a rota recusa (503) e não chama a Evolution, mesmo com um header
// de atacante presente na requisição; com a env setada, a URL registrada
// vem dela, nunca do header.
//
// Task 5 (fase antiban): a rota agora atribui um proxy do pool ANTES de
// criar a instância na Evolution, e passa a config para createInstance
// como terceiro parâmetro. O describe abaixo, "aplica o proxy antes do
// QR", trava a propriedade central da task: se assignProxy lançar (pool
// esgotado), a rota responde erro e a Evolution NUNCA é chamada. Sem
// isso, uma instância poderia nascer sem proxy e ter o pareamento
// registrado pelo IP da VPS.
// ---------------------------------------------------------------------------

// Escritas feitas na tabela de instâncias, para os testes olharem.
//
// Era `upsertCalls`: a rota usava `upsert(..., { onConflict: "account_id" })`,
// que só funcionava porque `account_id` era único — ou seja, porque só
// existia um número por cliente. Com vários, o upsert deixou de existir.
const escritas: Array<Record<string, unknown>> = [];

/** Uma instância já existente, para o caminho "reconectar". */
const INSTANCIA_EXISTENTE = {
  id: "inst-1",
  account_id: "acct-1",
  instance_name: "inst-1",
  status: "disconnected",
  phone: null,
  label: null,
  is_default: true,
};

// Duplo encadeável: `listarInstancias` faz select/eq/order/order e o
// resultado é aguardado direto (sem terminal), então o builder precisa
// ser thenable.
function makeSupabaseMock(instancias = [INSTANCIA_EXISTENTE]) {
  function builder(resultado: unknown) {
    const b: Record<string, unknown> = {};
    const chain = () => b;
    b.select = vi.fn(chain);
    b.eq = vi.fn(chain);
    b.order = vi.fn(chain);
    b.maybeSingle = vi.fn(() => Promise.resolve(resultado));
    b.single = vi.fn(() => Promise.resolve(resultado));
    b.then = (resolve: (v: unknown) => void) => resolve(resultado);
    return b;
  }
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => builder({ data: instancias, error: null })),
      update: vi.fn((payload: Record<string, unknown>) => {
        escritas.push(payload);
        return builder({ data: null, error: null });
      }),
      insert: vi.fn((payload: Record<string, unknown>) => {
        escritas.push(payload);
        return builder({ data: { id: "inst-nova" }, error: null });
      }),
    })),
  };
}

let supabaseMock = makeSupabaseMock();

// Client admin usado pela rota para (a) buscar o telefone já conhecido da
// instância (preferência regional do proxy) e (b) por assignProxy/
// releaseProxy internamente (mockados abaixo). Aqui só precisamos que
// .select("phone").eq(...).maybeSingle() resolva com algo válido.
function makeAdminMock() {
  function builder() {
    const b: Record<string, unknown> = {};
    const chain = () => b;
    b.select = vi.fn(chain);
    b.eq = vi.fn(chain);
    b.maybeSingle = vi.fn(() =>
      Promise.resolve({ data: { phone: null }, error: null }),
    );
    return b;
  }
  return { from: vi.fn(() => builder()) };
}

let adminMock = makeAdminMock();

vi.mock("@/lib/automations/admin-client", () => ({
  supabaseAdmin: vi.fn(() => adminMock),
}));

vi.mock("@/lib/auth/account", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/account")>();
  return {
    ...actual,
    requireRole: vi.fn(async () => ({
      supabase: supabaseMock,
      userId: "user-1",
      accountId: "acct-1",
      role: "admin",
      account: { id: "acct-1", name: "Acme" },
    })),
  };
});

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

// A rota lê o corpo (para saber QUAL número reconectar, ou se é um
// número novo), mas nunca lê headers: a URL do webhook vem só de
// NEXT_PUBLIC_SITE_URL. O teste anexa um Request com header forjado,
// exatamente como um proxy real entregaria, pra provar que ele não tem
// NENHUM jeito de chegar até a lógica da rota.
type PostHandler = (request: Request) => Promise<Response>;
function callConnect(
  headers: Record<string, string> = {},
  corpo?: Record<string, unknown>,
) {
  const request = new Request(
    "https://app.example.com/api/whatsapp/evolution/connect",
    {
      method: "POST",
      headers: corpo
        ? { ...headers, "content-type": "application/json" }
        : headers,
      body: corpo ? JSON.stringify(corpo) : undefined,
    },
  );
  return (POST as unknown as PostHandler)(request);
}

describe("POST /api/whatsapp/evolution/connect: origem da URL do webhook", () => {
  const ORIGINAL_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;
  const ORIGINAL_SECRET = process.env.EVOLUTION_WEBHOOK_SECRET;

  beforeEach(() => {
    escritas.length = 0;
    supabaseMock = makeSupabaseMock();
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
    const res = await callConnect({ "x-forwarded-host": "evil.tld" });
    const json = await res.json();

    expect(res.status).toBe(503);
    expect(json.error).toMatch(/URL pública/i);
    expect(createInstance).not.toHaveBeenCalled();
  });

  it("com NEXT_PUBLIC_SITE_URL setada, usa a env e ignora o X-Forwarded-Host de atacante", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://crm.example.com";

    const res = await callConnect({ "x-forwarded-host": "evil.tld" });
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

describe("POST /api/whatsapp/evolution/connect: aplica o proxy antes do QR", () => {
  const ORIGINAL_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;
  const ORIGINAL_SECRET = process.env.EVOLUTION_WEBHOOK_SECRET;

  beforeEach(() => {
    escritas.length = 0;
    supabaseMock = makeSupabaseMock();
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
    const res = await callConnect();
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

    const res = await callConnect();
    const json = await res.json();

    expect(res.status).toBe(503);
    expect(json.error).toMatch(/capacidade máxima/i);
    expect(createInstance).not.toHaveBeenCalled();
  });

  it("pool vazio: conecta SEM proxy (config null chega ao createInstance) e devolve o QR", async () => {
    vi.mocked(assignProxyIfAvailable).mockImplementation(async () => ({
      proxyId: null,
      config: null,
    }));

    const res = await callConnect();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.qr).toBeTruthy();
    expect(createInstance).toHaveBeenCalledTimes(1);
    const [, , proxyConfig] = vi.mocked(createInstance).mock.calls[0] as [
      string,
      string,
      unknown,
    ];
    expect(proxyConfig).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Vários números por cliente.
//
// Antes, a rota fazia `upsert(..., { onConflict: "account_id" })`: pedir
// para conectar um segundo número SOBRESCREVIA a linha do primeiro, e o
// número que já estava no ar sumia do CRM sem nenhum aviso — a sessão
// continuava viva na Evolution, mas o sistema não sabia mais dela.
//
// O que estes testes travam é a escolha do alvo: `novo: true` cria uma
// linha nova, `instanceId` mira um número específico, e o padrão
// (corpo vazio) reconecta o número existente como sempre fez.
// ---------------------------------------------------------------------------
describe("POST /api/whatsapp/evolution/connect: qual número conectar", () => {
  const ORIGINAL_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;
  const ORIGINAL_SECRET = process.env.EVOLUTION_WEBHOOK_SECRET;

  beforeEach(() => {
    escritas.length = 0;
    supabaseMock = makeSupabaseMock();
    adminMock = makeAdminMock();
    vi.mocked(createInstance).mockClear();
    vi.mocked(assignProxyIfAvailable).mockClear();
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

  it("sem alvo, reconecta o número que já existe (não cria outro)", async () => {
    const res = await callConnect();
    expect(res.status).toBe(200);

    // O nome mandado para a Evolution é o do número existente: é assim
    // que ela reconhece a sessão. Um nome novo aqui criaria uma
    // instância paralela e a antiga ficaria órfã.
    const [nome] = vi.mocked(createInstance).mock.calls[0];
    expect(nome).toBe("inst-1");
    expect(escritas.some((e) => "account_id" in e)).toBe(false);
  });

  it("com `novo: true`, cria outra linha em vez de sobrescrever a primeira", async () => {
    const res = await callConnect({}, { novo: true });
    expect(res.status).toBe(200);

    const insercao = escritas.find((e) => "account_id" in e);
    expect(insercao).toBeTruthy();
    // Não vira padrão: o cliente já tinha um número padrão, e promover o
    // recém-chegado mudaria por qual número as respostas saem.
    expect(insercao?.is_default).toBe(false);
    // O nome NÃO pode ser o id da conta: `instance_name` é UNIQUE, e o
    // segundo número colidiria com o primeiro.
    expect(insercao?.instance_name).not.toBe("acct-1");
  });

  it("com `instanceId` desconhecido, recusa em vez de conectar outro número", async () => {
    // Devolver o padrão aqui seria pior do que falhar: quem pediu para
    // reconectar o número B receberia o QR do número A e derrubaria a
    // sessão errada.
    const res = await callConnect({}, { instanceId: "inst-de-outro-cliente" });
    expect(res.status).toBe(404);
    expect(createInstance).not.toHaveBeenCalled();
  });
});
