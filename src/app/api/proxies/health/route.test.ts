import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Review final, item 2: o cron de saúde não pode desfazer uma decisão do
// operador.
//
// /api/proxies/[id] deixa o platform admin marcar um proxy como `degraded`
// de propósito (o provedor avisou que aquele IP está flagged e o operador
// quer drenar sem desligar). O cron gravava `status: "active"` em TODO check
// bem-sucedido, então esse `degraded` deliberado voltava para `active` no
// tick seguinte e o proxy passava a receber instância nova. Só `disabled`
// sobrevivia, porque a varredura o exclui.
//
// A distinção é o contador: `degraded` com `consecutive_failures > 0` veio da
// escada de falhas e um sucesso pode limpá-lo; `degraded` com contador zerado
// é mão humana e tem que sobreviver.
// ---------------------------------------------------------------------------

interface ProxyRow {
  id: string;
  status: string;
  consecutive_failures: number;
}

interface InstanceRow {
  account_id: string;
  instance_name: string;
  proxy_id: string | null;
}

interface AdminConfig {
  proxies: ProxyRow[];
  proxiesError?: { message: string } | null;
  /** Instâncias com status 'connected', para a varredura por instância. */
  instances?: InstanceRow[];
}

function makeAdmin(config: AdminConfig) {
  const updates: Array<{ id: string; payload: Record<string, unknown> }> = [];

  function builder(table: string) {
    const state = {
      isUpdate: false,
      payload: undefined as Record<string, unknown> | undefined,
      id: undefined as string | undefined,
    };
    const b: Record<string, unknown> = {};
    b.select = vi.fn(() => b);
    b.neq = vi.fn(() => b);
    b.eq = vi.fn((column: string, value: unknown) => {
      if (column === "id") state.id = String(value);
      return b;
    });
    b.update = vi.fn((payload: Record<string, unknown>) => {
      state.isUpdate = true;
      state.payload = payload;
      return b;
    });
    b.then = (resolve: (v: unknown) => unknown) => {
      if (state.isUpdate) {
        updates.push({ id: state.id ?? "?", payload: state.payload ?? {} });
        return resolve({ data: null, error: null });
      }
      if (table === "proxies") {
        return resolve(
          config.proxiesError
            ? { data: null, error: config.proxiesError }
            : { data: config.proxies, error: null },
        );
      }
      if (table === "evolution_instances") {
        return resolve({ data: config.instances ?? [], error: null });
      }
      return resolve({ data: [], error: null });
    };
    return b;
  }

  return { admin: { from: vi.fn((table: string) => builder(table)) }, updates };
}

let adminState = makeAdmin({ proxies: [] });

vi.mock("@/lib/automations/admin-client", () => ({
  supabaseAdmin: vi.fn(() => adminState.admin),
}));

vi.mock("@/lib/whatsapp/proxy-check", () => ({
  checkProxyExitIp: vi.fn(async () => ({
    ok: true,
    exitIp: "198.51.100.7",
    latencyMs: 120,
  })),
}));

// Preserva o módulo real (ProxyPoolError é uma classe usada por instanceof
// em outros pontos); só loadProxyConfig é substituído.
vi.mock("@/lib/whatsapp/proxy-pool", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/whatsapp/proxy-pool")>();
  return {
    ...actual,
    loadProxyConfig: vi.fn(async () => ({
      host: "203.0.113.10",
      port: 8080,
      protocol: "http" as const,
      username: "u",
      password: "p",
    })),
  };
});

vi.mock("@/lib/whatsapp/evolution-api", () => ({
  isEvolutionConfigured: vi.fn(() => true),
  findProxy: vi.fn(async () => ({ configured: true, host: "203.0.113.10" })),
}));

const { checkProxyExitIp } = await import("@/lib/whatsapp/proxy-check");
const { findProxy, isEvolutionConfigured } = await import(
  "@/lib/whatsapp/evolution-api"
);
const { GET } = await import("./route");

const CRON_SECRET = "segredo-de-cron";

function callHealth() {
  return GET(
    new Request("https://crm.example.com/api/proxies/health", {
      headers: { "x-cron-secret": CRON_SECRET },
    }),
  );
}

describe("GET /api/proxies/health: o degraded do operador sobrevive ao cron", () => {
  const ORIGINAL_CRON = process.env.AUTOMATION_CRON_SECRET;
  const ORIGINAL_VPS = process.env.VPS_PUBLIC_IP;

  beforeEach(() => {
    process.env.AUTOMATION_CRON_SECRET = CRON_SECRET;
    // Diferente do exitIp do mock: sem vazamento nestes casos.
    process.env.VPS_PUBLIC_IP = "31.97.249.95";
    vi.mocked(checkProxyExitIp).mockResolvedValue({
      ok: true,
      exitIp: "198.51.100.7",
      latencyMs: 120,
    });
  });

  afterEach(() => {
    if (ORIGINAL_CRON === undefined) {
      delete process.env.AUTOMATION_CRON_SECRET;
    } else {
      process.env.AUTOMATION_CRON_SECRET = ORIGINAL_CRON;
    }
    if (ORIGINAL_VPS === undefined) {
      delete process.env.VPS_PUBLIC_IP;
    } else {
      process.env.VPS_PUBLIC_IP = ORIGINAL_VPS;
    }
  });

  it("propriedade central: check OK NÃO reativa um degraded com contador zerado", async () => {
    adminState = makeAdmin({
      proxies: [{ id: "p-humano", status: "degraded", consecutive_failures: 0 }],
    });

    const res = await callHealth();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(adminState.updates).toHaveLength(1);
    // O que trava a propriedade: o update não toca em `status`.
    expect(adminState.updates[0].payload).not.toHaveProperty("status");
    expect(json.degradedPreserved).toBe(1);
  });

  it("check OK reativa o degraded que veio do contador de falhas", async () => {
    adminState = makeAdmin({
      proxies: [{ id: "p-falho", status: "degraded", consecutive_failures: 4 }],
    });

    const res = await callHealth();
    const json = await res.json();

    expect(adminState.updates).toHaveLength(1);
    expect(adminState.updates[0].payload.status).toBe("active");
    expect(adminState.updates[0].payload.consecutive_failures).toBe(0);
    expect(json.degradedPreserved).toBe(0);
  });

  it("proxy active segue active e com o contador zerado", async () => {
    adminState = makeAdmin({
      proxies: [{ id: "p-ok", status: "active", consecutive_failures: 2 }],
    });

    await callHealth();

    expect(adminState.updates[0].payload.status).toBe("active");
    expect(adminState.updates[0].payload.consecutive_failures).toBe(0);
  });

  it("falha na checagem não reativa nada: o degraded do operador continua degraded", async () => {
    vi.mocked(checkProxyExitIp).mockResolvedValue({
      ok: false,
      exitIp: null,
      latencyMs: 30,
      error: "timeout",
    });
    adminState = makeAdmin({
      proxies: [{ id: "p-humano", status: "degraded", consecutive_failures: 0 }],
    });

    await callHealth();

    expect(adminState.updates[0].payload.status).toBe("degraded");
    expect(adminState.updates[0].payload.consecutive_failures).toBe(1);
  });

  it("sem o segredo do cron, recusa e não checa nada", async () => {
    adminState = makeAdmin({
      proxies: [{ id: "p-ok", status: "active", consecutive_failures: 0 }],
    });

    const res = await GET(
      new Request("https://crm.example.com/api/proxies/health"),
    );

    expect(res.status).toBe(401);
    expect(checkProxyExitIp).not.toHaveBeenCalled();
    expect(adminState.updates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Review final, item 5: a varredura por INSTÂNCIA.
//
// A spec pede, como teste de aceite da camada de rede, que cada instância
// CONECTADA saia por um IP diferente do da VPS, e nomeia o modo de falha "se
// um proxy cair e a Evolution fizer fallback para conexão direta". A
// varredura por proxy não cobre isso: ela só compara o IP quando o check deu
// certo, então justo quando o proxy cai a comparação nem roda.
//
// Estes testes travam os dois sinais novos: instância conectada sem proxy
// vinculado no CRM (a situação de toda a frota que já estava conectada antes
// desta branch), e instância vinculada que a Evolution não confirma.
// ---------------------------------------------------------------------------
describe("GET /api/proxies/health: varredura por instância", () => {
  const ORIGINAL_CRON = process.env.AUTOMATION_CRON_SECRET;
  const ORIGINAL_VPS = process.env.VPS_PUBLIC_IP;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.AUTOMATION_CRON_SECRET = CRON_SECRET;
    process.env.VPS_PUBLIC_IP = "31.97.249.95";
    vi.mocked(checkProxyExitIp).mockResolvedValue({
      ok: true,
      exitIp: "198.51.100.7",
      latencyMs: 120,
    });
    vi.mocked(isEvolutionConfigured).mockReturnValue(true);
    vi.mocked(findProxy).mockResolvedValue({
      configured: true,
      host: "203.0.113.10",
    });
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    if (ORIGINAL_CRON === undefined) {
      delete process.env.AUTOMATION_CRON_SECRET;
    } else {
      process.env.AUTOMATION_CRON_SECRET = ORIGINAL_CRON;
    }
    if (ORIGINAL_VPS === undefined) {
      delete process.env.VPS_PUBLIC_IP;
    } else {
      process.env.VPS_PUBLIC_IP = ORIGINAL_VPS;
    }
  });

  function loggedText(): string {
    return (errorSpy.mock.calls as unknown[][])
      .map((args) => args.map((a) => String(a)).join(" "))
      .join("\n");
  }

  it("instância conectada SEM proxy vinculado é contada e logada", async () => {
    adminState = makeAdmin({
      proxies: [],
      instances: [
        { account_id: "acct-1", instance_name: "inst-1", proxy_id: null },
        { account_id: "acct-2", instance_name: "inst-2", proxy_id: "proxy-a" },
      ],
    });

    const json = await (await callHealth()).json();

    expect(json.instancesConnected).toBe(2);
    expect(json.instancesWithoutProxy).toBe(1);
    expect(json.instancesProxyMismatch).toBe(0);
    expect(loggedText()).toContain("SEM PROXY");
    expect(loggedText()).toContain("inst-1");
    // Não adianta perguntar o proxy de quem o CRM já sabe que não tem.
    expect(findProxy).toHaveBeenCalledTimes(1);
    expect(findProxy).toHaveBeenCalledWith("inst-2");
  });

  it("instância vinculada que a Evolution não confirma vira divergência", async () => {
    vi.mocked(findProxy).mockResolvedValue({ configured: false, host: null });
    adminState = makeAdmin({
      proxies: [],
      instances: [
        { account_id: "acct-2", instance_name: "inst-2", proxy_id: "proxy-a" },
      ],
    });

    const json = await (await callHealth()).json();

    expect(json.instancesProxyMismatch).toBe(1);
    expect(json.instancesWithoutProxy).toBe(0);
    expect(loggedText()).toContain("DIVERGENCIA");
    expect(loggedText()).toContain("inst-2");
  });

  it("falha ao consultar a Evolution conta como divergência, não como confirmada", async () => {
    vi.mocked(findProxy).mockRejectedValue(new Error("connect ETIMEDOUT"));
    adminState = makeAdmin({
      proxies: [],
      instances: [
        { account_id: "acct-2", instance_name: "inst-2", proxy_id: "proxy-a" },
      ],
    });

    const json = await (await callHealth()).json();

    expect(json.instancesProxyMismatch).toBe(1);
  });

  it("frota confirmada não sinaliza nada", async () => {
    adminState = makeAdmin({
      proxies: [],
      instances: [
        { account_id: "acct-2", instance_name: "inst-2", proxy_id: "proxy-a" },
        { account_id: "acct-3", instance_name: "inst-3", proxy_id: "proxy-b" },
      ],
    });

    const json = await (await callHealth()).json();

    expect(json.instancesConnected).toBe(2);
    expect(json.instancesWithoutProxy).toBe(0);
    expect(json.instancesProxyMismatch).toBe(0);
    expect(json.instanceProxyCheckEnabled).toBe(true);
  });

  it("Evolution não configurada: a confirmação fica desligada e visível na resposta", async () => {
    vi.mocked(isEvolutionConfigured).mockReturnValue(false);
    adminState = makeAdmin({
      proxies: [],
      instances: [
        { account_id: "acct-1", instance_name: "inst-1", proxy_id: null },
        { account_id: "acct-2", instance_name: "inst-2", proxy_id: "proxy-a" },
      ],
    });

    const json = await (await callHealth()).json();

    expect(json.instanceProxyCheckEnabled).toBe(false);
    expect(findProxy).not.toHaveBeenCalled();
    // O sinal que não depende da Evolution continua funcionando.
    expect(json.instancesWithoutProxy).toBe(1);
  });

  it("a varredura por instância não desativa proxy nem altera instância", async () => {
    vi.mocked(findProxy).mockResolvedValue({ configured: false, host: null });
    adminState = makeAdmin({
      proxies: [],
      instances: [
        { account_id: "acct-1", instance_name: "inst-1", proxy_id: null },
        { account_id: "acct-2", instance_name: "inst-2", proxy_id: "proxy-a" },
      ],
    });

    await callHealth();

    expect(adminState.updates).toHaveLength(0);
  });

  it("sem o segredo do cron, nem a varredura por instância roda", async () => {
    adminState = makeAdmin({
      proxies: [],
      instances: [
        { account_id: "acct-1", instance_name: "inst-1", proxy_id: null },
      ],
    });

    const res = await GET(
      new Request("https://crm.example.com/api/proxies/health"),
    );

    expect(res.status).toBe(401);
    expect(findProxy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Review final, item 6: um echo de IP fora do ar não pode derrubar o pool
// inteiro.
//
// checkProxyExitIp depende de um echo único (api.ipify.org). Se ele cair ou
// aplicar rate limit, TODOS os proxies falham em todo tick. A 15 minutos e
// com o limiar de 10 falhas, o pool inteiro fica `disabled` em duas horas e
// meia. Daí ninguém conecta, e proxy `disabled` sai da varredura, então nada
// se recupera sem PATCH manual um a um.
//
// Mitigação: falha universal (todas falharam, com mais de um proxy) é sinal
// de problema do checador, não dos proxies, e a execução é descartada.
// ---------------------------------------------------------------------------
describe("GET /api/proxies/health: falha universal é descartada", () => {
  const ORIGINAL_CRON = process.env.AUTOMATION_CRON_SECRET;
  const ORIGINAL_VPS = process.env.VPS_PUBLIC_IP;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  const FALHA = {
    ok: false as const,
    exitIp: null,
    latencyMs: 30,
    error: "getaddrinfo ENOTFOUND api.ipify.org",
  };
  const SUCESSO = {
    ok: true as const,
    exitIp: "198.51.100.7",
    latencyMs: 120,
  };

  beforeEach(() => {
    process.env.AUTOMATION_CRON_SECRET = CRON_SECRET;
    process.env.VPS_PUBLIC_IP = "31.97.249.95";
    vi.mocked(isEvolutionConfigured).mockReturnValue(true);
    vi.mocked(findProxy).mockResolvedValue({
      configured: true,
      host: "203.0.113.10",
    });
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    if (ORIGINAL_CRON === undefined) {
      delete process.env.AUTOMATION_CRON_SECRET;
    } else {
      process.env.AUTOMATION_CRON_SECRET = ORIGINAL_CRON;
    }
    if (ORIGINAL_VPS === undefined) {
      delete process.env.VPS_PUBLIC_IP;
    } else {
      process.env.VPS_PUBLIC_IP = ORIGINAL_VPS;
    }
  });

  it("propriedade central: todas falharam com mais de um proxy, ninguém é penalizado", async () => {
    vi.mocked(checkProxyExitIp).mockResolvedValue(FALHA);
    adminState = makeAdmin({
      proxies: [
        { id: "p-1", status: "active", consecutive_failures: 9 },
        { id: "p-2", status: "active", consecutive_failures: 9 },
        { id: "p-3", status: "active", consecutive_failures: 9 },
      ],
    });

    const json = await (await callHealth()).json();

    // Sem o descarte, os três iriam a 10 falhas e virariam `disabled`
    // na mesma execução, e proxy disabled sai da varredura: o pool não
    // se recuperaria sozinho nunca mais.
    expect(adminState.updates).toHaveLength(0);
    expect(json.checksDiscarded).toBe(true);
    expect(json.checked).toBe(3);
  });

  it("com um proxy só, a falha vale: não dá para distinguir o checador do proxy", async () => {
    vi.mocked(checkProxyExitIp).mockResolvedValue(FALHA);
    adminState = makeAdmin({
      proxies: [{ id: "p-1", status: "active", consecutive_failures: 0 }],
    });

    const json = await (await callHealth()).json();

    expect(json.checksDiscarded).toBe(false);
    expect(adminState.updates).toHaveLength(1);
    expect(adminState.updates[0].payload.consecutive_failures).toBe(1);
  });

  it("falha parcial não é descartada: quem falhou é penalizado, quem passou não", async () => {
    vi.mocked(checkProxyExitIp)
      .mockResolvedValueOnce(SUCESSO)
      .mockResolvedValueOnce(FALHA);
    adminState = makeAdmin({
      proxies: [
        { id: "p-1", status: "active", consecutive_failures: 0 },
        { id: "p-2", status: "active", consecutive_failures: 0 },
      ],
    });

    const json = await (await callHealth()).json();

    expect(json.checksDiscarded).toBe(false);
    expect(adminState.updates).toHaveLength(2);
    expect(adminState.updates[0].payload.consecutive_failures).toBe(0);
    expect(adminState.updates[1].payload.consecutive_failures).toBe(1);
  });

  it("a varredura por instância continua rodando numa execução descartada", async () => {
    vi.mocked(checkProxyExitIp).mockResolvedValue(FALHA);
    adminState = makeAdmin({
      proxies: [
        { id: "p-1", status: "active", consecutive_failures: 0 },
        { id: "p-2", status: "active", consecutive_failures: 0 },
      ],
      instances: [
        { account_id: "acct-1", instance_name: "inst-1", proxy_id: null },
      ],
    });

    const json = await (await callHealth()).json();

    expect(json.checksDiscarded).toBe(true);
    // Os dois sinais são independentes: o echo fora do ar não pode
    // apagar o aviso de instância servindo sem proxy.
    expect(json.instancesWithoutProxy).toBe(1);
  });

  it("registra o descarte no log do servidor", async () => {
    vi.mocked(checkProxyExitIp).mockResolvedValue(FALHA);
    adminState = makeAdmin({
      proxies: [
        { id: "p-1", status: "active", consecutive_failures: 0 },
        { id: "p-2", status: "active", consecutive_failures: 0 },
      ],
    });

    await callHealth();

    const logged = (errorSpy.mock.calls as unknown[][])
      .map((args) => args.map((a) => String(a)).join(" "))
      .join("\n");
    expect(logged).toContain("EXECUCAO DESCARTADA");
    expect(logged).toContain("api.ipify.org");
  });

  it("pool vazio não conta como falha universal", async () => {
    adminState = makeAdmin({ proxies: [] });

    const json = await (await callHealth()).json();

    expect(json.checked).toBe(0);
    expect(json.checksDiscarded).toBe(false);
  });
});

describe("GET /api/proxies/health: gate do cron", () => {
  const ORIGINAL_CRON = process.env.AUTOMATION_CRON_SECRET;

  beforeEach(() => {
    process.env.AUTOMATION_CRON_SECRET = CRON_SECRET;
  });

  afterEach(() => {
    if (ORIGINAL_CRON === undefined) {
      delete process.env.AUTOMATION_CRON_SECRET;
    } else {
      process.env.AUTOMATION_CRON_SECRET = ORIGINAL_CRON;
    }
  });

  it("sem o segredo na requisição, recusa antes de qualquer checagem", async () => {
    adminState = makeAdmin({
      proxies: [],
      instances: [
        { account_id: "acct-1", instance_name: "inst-1", proxy_id: null },
      ],
    });

    const res = await GET(
      new Request("https://crm.example.com/api/proxies/health"),
    );

    expect(res.status).toBe(401);
    expect(findProxy).not.toHaveBeenCalled();
  });
});
