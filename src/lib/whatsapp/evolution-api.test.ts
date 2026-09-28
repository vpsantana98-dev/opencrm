import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EvolutionProxyConfig } from "@/lib/whatsapp/proxy-pool";
import {
  createInstance,
  findProxy,
  setSafeInstanceSettings,
  setInstanceWebhook,
  setProxy,
} from "./evolution-api";

// ---------------------------------------------------------------------------
// Task 5 (correção pós-review): os testes de rota (connect/route.test.ts,
// connect-public/route.test.ts) mockam o módulo evolution-api INTEIRO, então
// nunca observam o que de fato sai no fio para a Evolution. Isso deixa
// passar regressões graves: remover os campos proxyHost/proxyPort/etc do
// corpo de /instance/create, ou pedir o QR (/instance/connect) ANTES de
// aplicar o proxy (/proxy/set) no caminho 403/409, não quebra nenhum teste
// de rota — o mock de createInstance nem chega a rodar esse código.
//
// Este arquivo testa evolution-api.ts no nível do fio: mocka só `fetch`
// (padrão já usado em meta-api.test.ts) e verifica o corpo e a ORDEM real
// das chamadas HTTP, que é onde a garantia "nunca conecta sem proxy"
// realmente vive.
// ---------------------------------------------------------------------------

const PROXY: EvolutionProxyConfig = {
  host: "203.0.113.10",
  port: 8080,
  protocol: "http",
  username: "proxy-user",
  password: "proxy-pass",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parseBody(init?: RequestInit): Record<string, unknown> | null {
  if (!init?.body) return null;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

describe("createInstance / setProxy: o proxy no fio", () => {
  const ORIGINAL_URL = process.env.EVOLUTION_API_URL;
  const ORIGINAL_KEY = process.env.EVOLUTION_API_KEY;

  beforeEach(() => {
    process.env.EVOLUTION_API_URL = "https://evolution.example.com";
    process.env.EVOLUTION_API_KEY = "test-api-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (ORIGINAL_URL === undefined) {
      delete process.env.EVOLUTION_API_URL;
    } else {
      process.env.EVOLUTION_API_URL = ORIGINAL_URL;
    }
    if (ORIGINAL_KEY === undefined) {
      delete process.env.EVOLUTION_API_KEY;
    } else {
      process.env.EVOLUTION_API_KEY = ORIGINAL_KEY;
    }
  });

  it("o corpo de POST /instance/create inclui os cinco campos de proxy, com proxyPort como STRING", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> | null }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, body: parseBody(init) });
        if (url.endsWith("/instance/create")) return jsonResponse({}, 201);
        if (url.includes("/proxy/set/")) return jsonResponse({ enabled: true });
        if (url.includes("/settings/set/")) return jsonResponse({ settings: {} });
        if (url.includes("/webhook/set/")) return jsonResponse({ success: true });
        if (url.includes("/instance/connect/")) {
          return jsonResponse({ base64: "data:image/png;base64,QVo=" });
        }
        return jsonResponse({}, 404);
      }),
    );

    await createInstance("inst-1", "https://crm.example.com/webhook", PROXY);

    const createCall = calls.find((c) => c.url.endsWith("/instance/create"));
    expect(createCall).toBeDefined();
    const body = createCall!.body!;
    expect(body.proxyHost).toBe(PROXY.host);
    expect(body.proxyPort).toBe(String(PROXY.port));
    expect(typeof body.proxyPort).toBe("string");
    expect(body.proxyProtocol).toBe(PROXY.protocol);
    expect(body.proxyUsername).toBe(PROXY.username);
    expect(body.proxyPassword).toBe(PROXY.password);
  });

  it("no caminho de sucesso (criação 201), chama /proxy/set/ ANTES de /instance/connect/", async () => {
    const order: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/instance/create")) {
          order.push("create");
          return jsonResponse({}, 201);
        }
        if (url.includes("/proxy/set/")) {
          order.push("proxy/set");
          return jsonResponse({ enabled: true });
        }
        if (url.includes("/settings/set/")) {
          order.push("settings/set");
          return jsonResponse({ settings: {} });
        }
        if (url.includes("/webhook/set/")) {
          order.push("webhook/set");
          return jsonResponse({ success: true });
        }
        if (url.includes("/instance/connect/")) {
          order.push("instance/connect");
          return jsonResponse({ base64: "data:image/png;base64,QVo=" });
        }
        return jsonResponse({}, 404);
      }),
    );

    await createInstance("inst-1", "https://crm.example.com/webhook", PROXY);

    expect(order).toEqual([
      "create",
      "proxy/set",
      "settings/set",
      "webhook/set",
      "instance/connect",
    ]);
  });

  it("no caminho 409 (instância já existe), chama /proxy/set/ ANTES de /instance/connect/", async () => {
    const order: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/instance/create")) {
          order.push("create");
          return jsonResponse({ message: "already exists" }, 409);
        }
        if (url.includes("/proxy/set/")) {
          order.push("proxy/set");
          return jsonResponse({ enabled: true });
        }
        if (url.includes("/settings/set/")) {
          order.push("settings/set");
          return jsonResponse({ settings: {} });
        }
        if (url.includes("/webhook/set/")) {
          order.push("webhook/set");
          return jsonResponse({ success: true });
        }
        if (url.includes("/instance/connect/")) {
          order.push("instance/connect");
          return jsonResponse({ base64: "data:image/png;base64,QVo=" });
        }
        return jsonResponse({}, 404);
      }),
    );

    await createInstance("inst-1", "https://crm.example.com/webhook", PROXY);

    expect(order).toEqual([
      "create",
      "proxy/set",
      "settings/set",
      "webhook/set",
      "instance/connect",
    ]);
  });

  it("no caminho 403 (instância já existe, variante), chama /proxy/set/ ANTES de /instance/connect/", async () => {
    const order: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/instance/create")) {
          order.push("create");
          return jsonResponse({ message: "forbidden" }, 403);
        }
        if (url.includes("/proxy/set/")) {
          order.push("proxy/set");
          return jsonResponse({ enabled: true });
        }
        if (url.includes("/settings/set/")) {
          order.push("settings/set");
          return jsonResponse({ settings: {} });
        }
        if (url.includes("/webhook/set/")) {
          order.push("webhook/set");
          return jsonResponse({ success: true });
        }
        if (url.includes("/instance/connect/")) {
          order.push("instance/connect");
          return jsonResponse({ base64: "data:image/png;base64,QVo=" });
        }
        return jsonResponse({}, 404);
      }),
    );

    await createInstance("inst-1", "https://crm.example.com/webhook", PROXY);

    expect(order).toEqual([
      "create",
      "proxy/set",
      "settings/set",
      "webhook/set",
      "instance/connect",
    ]);
  });

  it("com proxy null: cria sem campos de proxy, NAO chama /proxy/set e segue para o connect", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls: Array<{ url: string; body: Record<string, unknown> | null }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, body: parseBody(init) });
        if (url.endsWith("/instance/create")) return jsonResponse({}, 201);
        if (url.includes("/proxy/set/")) return jsonResponse({ enabled: true });
        if (url.includes("/settings/set/")) return jsonResponse({ settings: {} });
        if (url.includes("/webhook/set/")) return jsonResponse({ success: true });
        if (url.includes("/instance/connect/")) {
          return jsonResponse({ base64: "data:image/png;base64,QVo=" });
        }
        return jsonResponse({}, 404);
      }),
    );

    const qr = await createInstance(
      "inst-1",
      "https://crm.example.com/webhook",
      null,
    );

    expect(calls.some((c) => c.url.endsWith("/instance/create"))).toBe(true);
    expect(calls.some((c) => c.url.includes("/proxy/set/"))).toBe(false);
    expect(calls.some((c) => c.url.includes("/instance/connect/inst-1"))).toBe(
      true,
    );

    const createCall = calls.find((c) => c.url.endsWith("/instance/create"))!;
    expect(createCall.body!.proxyHost).toBeUndefined();

    expect(qr.base64).toBeTruthy();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("SEM proxy"));
    warn.mockRestore();
  });

  it("setProxy envia um corpo PLANO (sem aninhar sob 'proxy'), com port STRING", async () => {
    let captured: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        captured = parseBody(init);
        return jsonResponse({ enabled: true });
      }),
    );

    await setProxy("inst-1", PROXY);

    expect(captured).not.toBeNull();
    expect(captured).not.toHaveProperty("proxy");
    // toEqual compara VALOR: se port viesse número (8080), já divergiria
    // de "8080" abaixo, então esta asserção também prova que é string.
    expect(captured).toEqual({
      enabled: true,
      host: PROXY.host,
      port: String(PROXY.port),
      protocol: PROXY.protocol,
      username: PROXY.username,
      password: PROXY.password,
    });
  });

  it("setInstanceWebhook ativa os eventos usados pelo CRM", async () => {
    let capturedUrl = "";
    let captured: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        captured = parseBody(init);
        return jsonResponse({ success: true });
      }),
    );

    await setInstanceWebhook("inst-1", "https://crm.example.com/webhook");

    expect(capturedUrl).toBe(
      "https://evolution.example.com/webhook/set/inst-1",
    );
    // Este expect afirmava o corpo ACHATADO — o formato que a Evolution
    // v2 recusa com HTTP 400. O teste passava porque o mock devolve
    // sucesso para qualquer coisa, então ele travava o bug em vez de
    // pegá-lo. Corrigido para o formato que o servidor real aceita.
    expect(captured).toEqual({
      webhook: {
        enabled: true,
        url: "https://crm.example.com/webhook",
        headers: {},
        byEvents: false,
        base64: false,
        events: [
          "MESSAGES_UPSERT",
          "MESSAGES_UPDATE",
          "CONNECTION_UPDATE",
        ],
      },
    });
  });

  // A ordem das tentativas era o inverso do certo: mandava o corpo
  // achatado primeiro e o "novo" depois — só que o "novo" também era
  // achatado, então os dois batiam no mesmo 400. Agora o aninhado (v2)
  // vai primeiro e o achatado (v1) fica como rede para instalações
  // antigas.
  it("setInstanceWebhook cai para o formato legado quando a v2 recusa", async () => {
    const bodies: Array<Record<string, unknown> | null> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        bodies.push(parseBody(init));
        return bodies.length === 1
          ? jsonResponse({ message: "invalid payload" }, 400)
          : jsonResponse({ success: true });
      }),
    );

    await setInstanceWebhook("inst-1", "https://crm.example.com/webhook");

    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toHaveProperty("webhook");
    expect(bodies[1]).toEqual({
      enabled: true,
      url: "https://crm.example.com/webhook",
      webhookByEvents: false,
      webhookBase64: false,
      events: [
        "MESSAGES_UPSERT",
        "MESSAGES_UPDATE",
        "CONNECTION_UPDATE",
      ],
    });
  });

  it("aplica configurações não invasivas antes da conexão", async () => {
    let capturedUrl = "";
    let captured: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        captured = parseBody(init);
        return jsonResponse({ settings: captured });
      }),
    );

    await setSafeInstanceSettings("inst-1");

    expect(capturedUrl).toBe(
      "https://evolution.example.com/settings/set/inst-1",
    );
    expect(captured).toEqual({
      rejectCall: false,
      msgCall: "",
      groupsIgnore: false,
      alwaysOnline: false,
      readMessages: false,
      readStatus: false,
      syncFullHistory: false,
      wavoipToken: "",
    });
  });
});

// ---------------------------------------------------------------------------
// Review final, item 5: findProxy, a confirmação do lado da Evolution.
//
// É a metade que faltava da verificação de vazamento. proxy-check.ts diz que
// o PROXY responde; só o /proxy/find diz que a INSTÂNCIA do cliente está
// usando um. A spec (seção 12) registra que a versão implantada pode ignorar
// em silêncio os campos de proxy do /instance/create, e é esse silêncio que
// esta chamada quebra.
// ---------------------------------------------------------------------------
describe("findProxy: a confirmação por instância no fio", () => {
  const ORIGINAL_URL = process.env.EVOLUTION_API_URL;
  const ORIGINAL_KEY = process.env.EVOLUTION_API_KEY;

  beforeEach(() => {
    process.env.EVOLUTION_API_URL = "https://evolution.example.com";
    process.env.EVOLUTION_API_KEY = "test-api-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (ORIGINAL_URL === undefined) {
      delete process.env.EVOLUTION_API_URL;
    } else {
      process.env.EVOLUTION_API_URL = ORIGINAL_URL;
    }
    if (ORIGINAL_KEY === undefined) {
      delete process.env.EVOLUTION_API_KEY;
    } else {
      process.env.EVOLUTION_API_KEY = ORIGINAL_KEY;
    }
  });

  function stubFetch(body: unknown, status = 200) {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return jsonResponse(body, status);
      }),
    );
    return calls;
  }

  it("chama GET /proxy/find/{instance} com a apikey", async () => {
    const calls = stubFetch({ enabled: true, host: "203.0.113.10" });

    await findProxy("inst-1");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://evolution.example.com/proxy/find/inst-1",
    );
    // `call()` não passa method, então é GET; o que importa é não ter
    // virado POST por engano.
    expect(calls[0].init?.method).toBeUndefined();
    expect(new Headers(calls[0].init?.headers).get("apikey")).toBe(
      "test-api-key",
    );
  });

  it("proxy aplicado: configured true, com o host reportado", async () => {
    stubFetch({ enabled: true, host: "203.0.113.10", port: "8080" });

    await expect(findProxy("inst-1")).resolves.toEqual({
      configured: true,
      host: "203.0.113.10",
    });
  });

  it("404 (a Evolution não tem proxy para a instância): configured false", async () => {
    stubFetch({ status: 404, message: "Proxy not found" }, 404);

    await expect(findProxy("inst-1")).resolves.toEqual({
      configured: false,
      host: null,
    });
  });

  it("enabled false explícito: configured false, mesmo com host", async () => {
    stubFetch({ enabled: false, host: "203.0.113.10" });

    const result = await findProxy("inst-1");
    expect(result.configured).toBe(false);
  });

  it("resposta sem `enabled` mas com host conta como aplicado (tolerância de versão)", async () => {
    // Tratar a ausência do campo como "sem proxy" faria o detector
    // acusar a frota inteira e virar ruído. Ver o docstring de findProxy.
    stubFetch({ host: "203.0.113.10" });

    const result = await findProxy("inst-1");
    expect(result.configured).toBe(true);
  });

  it("aceita o formato aninhado sob `proxy`", async () => {
    stubFetch({ proxy: { enabled: true, host: "203.0.113.10" } });

    const result = await findProxy("inst-1");
    expect(result).toEqual({ configured: true, host: "203.0.113.10" });
  });

  it("corpo vazio: configured false", async () => {
    stubFetch({});

    const result = await findProxy("inst-1");
    expect(result).toEqual({ configured: false, host: null });
  });
});

// ---------------------------------------------------------------------------
// Regressão: setInstanceWebhook mandava os campos SOLTOS na raiz, e a
// Evolution v2 devolvia HTTP 400 em toda reconexão de instância já
// existente ("Internal server error" na tela de conectar).
//
// O que deixou passar: os testes de ordem acima mockam /webhook/set/ como
// sempre-sucesso, então nenhum deles observa o CORPO. Estes observam.
//
// O schema real da v2.3.7 (dist/api/integrations/event/webhook/
// webhook.schema.js) é: { properties: { webhook: {...} },
// required: ["webhook"] }.
// ---------------------------------------------------------------------------
describe("setInstanceWebhook: formato do corpo", () => {
  const ORIGINAL_URL = process.env.EVOLUTION_API_URL;
  const ORIGINAL_KEY = process.env.EVOLUTION_API_KEY;

  beforeEach(() => {
    process.env.EVOLUTION_API_URL = "https://evolution.example.com";
    process.env.EVOLUTION_API_KEY = "test-api-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (ORIGINAL_URL === undefined) delete process.env.EVOLUTION_API_URL;
    else process.env.EVOLUTION_API_URL = ORIGINAL_URL;
    if (ORIGINAL_KEY === undefined) delete process.env.EVOLUTION_API_KEY;
    else process.env.EVOLUTION_API_KEY = ORIGINAL_KEY;
  });

  it("manda a config ANINHADA sob `webhook` na primeira tentativa", async () => {
    const bodies: Array<Record<string, unknown> | null> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        bodies.push(parseBody(init));
        return jsonResponse({ success: true });
      }),
    );

    await setInstanceWebhook("inst-1", "https://crm.example.com/hook");

    expect(bodies).toHaveLength(1);
    const webhook = bodies[0]?.webhook as Record<string, unknown>;
    expect(webhook).toBeDefined();
    expect(webhook.url).toBe("https://crm.example.com/hook");
    expect(webhook.enabled).toBe(true);
    // `byEvents`/`base64`, não `webhookByEvents`/`webhookBase64` — a v2
    // renomeou os dois junto com o aninhamento.
    expect(webhook.byEvents).toBe(false);
    expect(webhook.base64).toBe(false);
    expect(Array.isArray(webhook.events)).toBe(true);
  });

  it("NÃO deixa os campos soltos na raiz", async () => {
    // A raiz com `url`/`enabled` é exatamente o corpo que a v2 recusa.
    const bodies: Array<Record<string, unknown> | null> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        bodies.push(parseBody(init));
        return jsonResponse({ success: true });
      }),
    );

    await setInstanceWebhook("inst-1", "https://crm.example.com/hook");

    expect(bodies[0]).not.toHaveProperty("url");
    expect(bodies[0]).not.toHaveProperty("enabled");
    expect(Object.keys(bodies[0] ?? {})).toEqual(["webhook"]);
  });

  it("cai para o formato antigo (raiz) quando a v2 recusa", async () => {
    // Instalações da linha v1 ainda esperam os campos na raiz.
    const bodies: Array<Record<string, unknown> | null> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        bodies.push(parseBody(init));
        return bodies.length === 1
          ? jsonResponse({ message: "bad request" }, 400)
          : jsonResponse({ success: true });
      }),
    );

    await setInstanceWebhook("inst-1", "https://crm.example.com/hook");

    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toHaveProperty("webhook");
    expect(bodies[1]).toHaveProperty("url", "https://crm.example.com/hook");
    expect(bodies[1]).toHaveProperty("webhookBase64", false);
  });

  it("os dois formatos recusados: lança com o status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ message: "bad request" }, 400)),
    );

    await expect(
      setInstanceWebhook("inst-1", "https://crm.example.com/hook"),
    ).rejects.toThrow(/HTTP 400/);
  });
});

// ---------------------------------------------------------------------------
// Regressão: com base64 LIGADO, a Evolution embute a mídia no corpo do
// webhook. Um vídeo passa dos 10MB que o Next aceita, a requisição chega
// truncada e a mensagem some — sem erro visível para quem usa. Aconteceu
// em produção com um vídeo de grupo.
//
// Estes testes travam o desligamento nos TRÊS lugares que registram
// webhook. Ligar de novo em qualquer um reabre o mesmo buraco.
// ---------------------------------------------------------------------------
describe("base64 desligado em todo registro de webhook", () => {
  const ORIGINAL_URL = process.env.EVOLUTION_API_URL;
  const ORIGINAL_KEY = process.env.EVOLUTION_API_KEY;

  beforeEach(() => {
    process.env.EVOLUTION_API_URL = "https://evolution.example.com";
    process.env.EVOLUTION_API_KEY = "test-api-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (ORIGINAL_URL === undefined) delete process.env.EVOLUTION_API_URL;
    else process.env.EVOLUTION_API_URL = ORIGINAL_URL;
    if (ORIGINAL_KEY === undefined) delete process.env.EVOLUTION_API_KEY;
    else process.env.EVOLUTION_API_KEY = ORIGINAL_KEY;
  });

  it("setInstanceWebhook nao pede base64 em nenhum dos dois formatos", async () => {
    const bodies: Array<Record<string, unknown> | null> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        bodies.push(parseBody(init));
        // Recusa o primeiro para exercitar tambem o formato legado.
        return bodies.length === 1
          ? jsonResponse({ message: "bad" }, 400)
          : jsonResponse({ success: true });
      }),
    );

    await setInstanceWebhook("inst-1", "https://crm.example.com/hook");

    const aninhado = bodies[0]?.webhook as Record<string, unknown>;
    expect(aninhado.base64).toBe(false);
    expect(bodies[1]).toHaveProperty("webhookBase64", false);
  });

  it("o corpo de /instance/create tambem nao pede base64", async () => {
    const bodies: Array<{ url: string; body: Record<string, unknown> | null }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        bodies.push({ url, body: parseBody(init) });
        return jsonResponse({ instance: { instanceName: "inst-1" } });
      }),
    );

    await createInstance("inst-1", "https://crm.example.com/hook", null).catch(
      () => null,
    );

    const criacao = bodies.find((b) => b.url.includes("/instance/create"));
    expect(criacao).toBeDefined();
    const webhook = criacao!.body?.webhook as Record<string, unknown> | undefined;
    if (webhook) expect(webhook.base64).not.toBe(true);
  });
});
