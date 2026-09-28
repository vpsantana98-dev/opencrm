import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isHostAllowed,
  parseAllowedHosts,
  resolveBaseUrl,
  resolveConfiguredBaseUrl,
} from "./base-url";

// ---------------------------------------------------------------------------
// `base-url.ts` é o módulo que decide em qual header confiar para montar uma
// URL auto-referencial. É onde mora o risco (host forjado, esquema forjado,
// URL configurada errada) para os três chamadores atuais (convites,
// connect e connect-public da Evolution). Estes testes existem para travar
// esse risco diretamente, em vez de só via teste de integração das rotas.
// ---------------------------------------------------------------------------

function req(
  headers: Record<string, string> = {},
  url = "https://localhost/api/x",
) {
  return new Request(url, { headers });
}

describe("resolveBaseUrl / resolveConfiguredBaseUrl: NEXT_PUBLIC_SITE_URL", () => {
  const ORIGINAL = process.env.NEXT_PUBLIC_SITE_URL;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL;
    errorSpy.mockRestore();
  });

  it("NEXT_PUBLIC_SITE_URL vence o header, mesmo quando o header aponta para outro host", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://crm.example.com";
    const request = req({ "x-forwarded-host": "attacker-controlled.tld" });

    expect(resolveBaseUrl(request, null)).toBe("https://crm.example.com");
  });

  it("remove barra final e barras múltiplas", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://crm.example.com/";
    expect(resolveBaseUrl(req(), null)).toBe("https://crm.example.com");

    process.env.NEXT_PUBLIC_SITE_URL = "https://crm.example.com///";
    expect(resolveBaseUrl(req(), null)).toBe("https://crm.example.com");
  });

  it("trata a env só com espaço como ausente (some tudo no trim)", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "   ";

    // resolveConfiguredBaseUrl nunca olha header nenhum: sem env válida,
    // é sempre null.
    expect(resolveConfiguredBaseUrl()).toBeNull();

    // resolveBaseUrl cai para o header, exatamente como se a env não
    // existisse.
    const request = req({ host: "crm.example.com" });
    expect(resolveBaseUrl(request, null)).toBe("https://crm.example.com");
  });

  it("aceita a env com espaço em volta de um valor válido (trim, não rejeição)", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "  https://crm.example.com  ";
    expect(resolveBaseUrl(req(), null)).toBe("https://crm.example.com");
    expect(resolveConfiguredBaseUrl()).toBe("https://crm.example.com");
  });

  it("rejeita valor sem esquema (não parseia como URL) e loga erro", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "crm.example.com";

    expect(resolveConfiguredBaseUrl()).toBeNull();
    expect(errorSpy).toHaveBeenCalled();

    // resolveBaseUrl cai para o header nesse caso.
    const request = req({ host: "crm.example.com" });
    expect(resolveBaseUrl(request, null)).toBe("https://crm.example.com");
  });

  it("rejeita lixo que nem chega a parsear como URL e loga erro", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "not a url at all";

    expect(resolveConfiguredBaseUrl()).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("rejeita esquema que não seja http/https (ex.: ftp) e loga erro", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "ftp://crm.example.com";

    expect(resolveConfiguredBaseUrl()).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("resolveConfiguredBaseUrl devolve null sem a env, e nunca olha pra headers", () => {
    // Sem NEXT_PUBLIC_SITE_URL (beforeEach já garante isso). Não existe
    // parâmetro de request nesta função: o teste documenta isso, mesmo
    // que houvesse um Host/X-Forwarded-Host "válido" em algum request por
    // perto, a função não tem como enxergá-lo.
    expect(resolveConfiguredBaseUrl()).toBeNull();
  });
});

describe("resolveBaseUrl: allowlist e headers (sem NEXT_PUBLIC_SITE_URL)", () => {
  const ORIGINAL = process.env.NEXT_PUBLIC_SITE_URL;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL;
  });

  it("sem allowlist, o host do header é aceito (permissivo de propósito, caminho de convites)", () => {
    const request = req({ "x-forwarded-host": "qualquer-coisa.tld" });
    expect(resolveBaseUrl(request, null)).toBe("https://qualquer-coisa.tld");
  });

  it("com allowlist, host fora da lista devolve null", () => {
    const request = req({ "x-forwarded-host": "attacker-controlled.tld" });
    expect(resolveBaseUrl(request, ["crm.example.com"])).toBeNull();
  });

  it("com allowlist, host presente na lista é aceito", () => {
    const request = req({ "x-forwarded-host": "crm.example.com" });
    expect(resolveBaseUrl(request, ["crm.example.com"])).toBe(
      "https://crm.example.com",
    );
  });

  it("X-Forwarded-Host com vírgula usa o valor MAIS À DIREITA, não o mais à esquerda", () => {
    // Probe do review: proxy que ANEXA em vez de sobrescrever o header,
    // o mais à esquerda pode ter sido escrito pelo próprio cliente.
    const request = req({
      "x-forwarded-host": "evil.tld, crm.example.com",
    });
    expect(resolveBaseUrl(request, null)).toBe("https://crm.example.com");
  });

  it("X-Forwarded-Proto só aceita http/https; qualquer outra coisa cai pro default https", () => {
    const httpReq = req({
      "x-forwarded-host": "crm.example.com",
      "x-forwarded-proto": "http",
    });
    expect(resolveBaseUrl(httpReq, null)).toBe("http://crm.example.com");

    const jsReq = req({
      "x-forwarded-host": "crm.example.com",
      "x-forwarded-proto": "javascript",
    });
    // NÃO "javascript://crm.example.com".
    expect(resolveBaseUrl(jsReq, null)).toBe("https://crm.example.com");

    const noProtoReq = req({ "x-forwarded-host": "crm.example.com" });
    expect(resolveBaseUrl(noProtoReq, null)).toBe("https://crm.example.com");
  });

  it("sem X-Forwarded-Host, cai para o Host, com o protocolo da própria requisição", () => {
    const request = req({ host: "crm.example.com" }, "https://localhost/api/x");
    expect(resolveBaseUrl(request, null)).toBe("https://crm.example.com");
  });

  it("sem X-Forwarded-Host nem Host, e sem NEXT_PUBLIC_SITE_URL, devolve null", () => {
    const request = req({});
    expect(resolveBaseUrl(request, null)).toBeNull();
  });
});

describe("parseAllowedHosts", () => {
  it("devolve null quando a env não está setada ou é vazia/só espaço", () => {
    expect(parseAllowedHosts(undefined)).toBeNull();
    expect(parseAllowedHosts("")).toBeNull();
    expect(parseAllowedHosts("   ")).toBeNull();
  });

  it("separa por vírgula, tira espaço e normaliza pra minúsculo", () => {
    expect(parseAllowedHosts(" CRM.example.com , Staging.EXAMPLE.com ")).toEqual([
      "crm.example.com",
      "staging.example.com",
    ]);
  });
});

describe("isHostAllowed", () => {
  const allowList = ["crm.example.com"];

  it("sem allowlist (null), qualquer host é aceito", () => {
    expect(isHostAllowed("qualquer-coisa.tld", null)).toBe(true);
  });

  it("host presente na lista é aceito, comparação case-insensitive", () => {
    expect(isHostAllowed("crm.example.com", allowList)).toBe(true);
    expect(isHostAllowed("CRM.EXAMPLE.COM", allowList)).toBe(true);
    expect(isHostAllowed("Crm.Example.Com", allowList)).toBe(true);
  });

  it("rejeita variantes de sufixo/prefixo que não são IGUAIS a uma entrada da lista", () => {
    // Todas as probes que o revisor testou contra a allowlist.
    expect(isHostAllowed("crm.example.com.evil.tld", allowList)).toBe(false);
    expect(isHostAllowed("crm.example.com.", allowList)).toBe(false);
    expect(isHostAllowed("crm.example.com@evil.tld", allowList)).toBe(false);
    expect(isHostAllowed("crm.example.com:8443", allowList)).toBe(false);
    expect(isHostAllowed("evil.crm.example.com", allowList)).toBe(false);
  });
});
