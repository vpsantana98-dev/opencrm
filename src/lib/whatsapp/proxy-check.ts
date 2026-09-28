/**
 * Verificação do IP de saída de um proxy.
 *
 * Serve a dois propósitos:
 *   1. Saúde: o proxy responde e em quanto tempo.
 *   2. Vazamento: o IP de saída tem que ser DIFERENTE do IP da VPS.
 *      Se a Evolution fizer fallback para conexão direta quando um
 *      proxy cai, é aqui que descobrimos, em minutos, em vez de
 *      descobrir quando o número for banido.
 */

import { isIP } from "node:net";

import { ProxyAgent, fetch as undiciFetch } from "undici";

import type { EvolutionProxyConfig } from "@/lib/whatsapp/proxy-pool";

/** Serviço de echo de IP. Texto puro, sem JSON para parsear. */
const ECHO_URL = "https://api.ipify.org";

/**
 * Formata o host para entrar numa URL de proxy.
 *
 * Endereço IPv6 em URL PRECISA de colchetes: `http://[2804:abc::1]:8080`.
 * Sem eles o `new URL()` (e portanto o ProxyAgent do undici) lança
 * `ERR_INVALID_URL`, porque os dois-pontos do endereço se confundem com o
 * separador da porta.
 *
 * Isso deixou de ser detalhe teórico: os proxies residenciais brasileiros
 * vendidos para WhatsApp (Evolution/Baileys) são majoritariamente IPv6
 * dedicado, justamente porque IPv4 é escasso.
 *
 * O host é guardado no banco em forma canônica (sem colchetes) — quem
 * precisa deles é só a URL. `setProxy` manda host e porta em campos
 * separados para a Evolution, e lá o valor cru é o correto.
 *
 * Idempotente: um host já entre colchetes passa sem duplicar.
 */
export function formatHostForUrl(host: string): string {
  const h = host.trim();
  if (h.startsWith("[") && h.endsWith("]")) return h;
  return isIP(h) === 6 ? `[${h}]` : h;
}

/**
 * Operação inversa de {@link formatHostForUrl}: deixa o host na forma
 * canônica para gravar no banco (IPv6 SEM colchetes).
 *
 * Existe porque o operador tende a colar o endereço do jeito que o painel
 * do provedor mostra, e alguns mostram `[2804:abc::1]`. Guardar as duas
 * formas no banco faria a mesma máquina virar duas linhas diferentes e
 * quebraria a comparação de IP de saída na detecção de vazamento.
 */
export function normalizeProxyHost(host: string): string {
  const h = host.trim();
  if (h.startsWith("[") && h.endsWith("]")) {
    const inner = h.slice(1, -1);
    // Só desembrulha se o miolo for mesmo um IPv6 — assim um valor
    // estranho não é silenciosamente mutilado.
    if (isIP(inner) === 6) return inner;
  }
  return h;
}

export interface ProxyCheckResult {
  ok: boolean;
  exitIp: string | null;
  latencyMs: number;
  error?: string;
}

/**
 * @param echoUrl Injetável só para teste (aponta pra um echo local em
 *   memória). Em produção, sempre `ECHO_URL`.
 */
export async function checkProxyExitIp(
  config: EvolutionProxyConfig,
  timeoutMs = 10_000,
  echoUrl: string = ECHO_URL,
): Promise<ProxyCheckResult> {
  const auth =
    config.username || config.password
      ? `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@`
      : "";
  const uri = `${config.protocol === "socks5" ? "socks5" : "http"}://${auth}${formatHostForUrl(config.host)}:${config.port}`;

  const started = Date.now();
  // `proxyTunnel: true` força CONNECT mesmo quando o alvo não é https.
  // Sem isso o undici só tuneliza quando o alvo é https e faz um
  // forward HTTP/1.1 simples quando não é (RFC 9112 §3.2.2). Em
  // produção o alvo (ECHO_URL) já é https, então isso não muda nada
  // no comportamento real; só deixa o checker robusto a qualquer URL
  // de echo configurada (inclusive a de teste, que é http local).
  const agent = new ProxyAgent({ uri, proxyTunnel: true });

  try {
    // IMPORTANTE: usa o `fetch` exportado pelo próprio pacote `undici`
    // (não o `fetch` global do Node). O `fetch` global embute sua
    // própria cópia interna do undici, numa major diferente da
    // instalada via npm (`process.versions.undici` vs a versão do
    // pacote): passar um `ProxyAgent` de uma instância da lib pro
    // `fetch` de outra falha SEMPRE com "UND_ERR_INVALID_ARG: invalid
    // onRequestStart method", mesmo com o proxy saudável. Ver o teste
    // de regressão em proxy-check.test.ts, que sobe um proxy real e
    // falha se essa incompatibilidade voltar.
    const res = await undiciFetch(echoUrl, {
      dispatcher: agent,
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    const latencyMs = Date.now() - started;

    if (!res.ok) {
      return {
        ok: false,
        exitIp: null,
        latencyMs,
        error: `echo respondeu HTTP ${res.status}`,
      };
    }

    const body = (await res.text()).trim();

    // Só aceita como IP de saída algo que de fato pareça um IP. Sem
    // isso, uma página de erro do provedor, um captive portal ou uma
    // resposta corrompida vira "proxy saudável", com lixo gravado em
    // last_exit_ip.
    if (!isIP(body)) {
      return {
        ok: false,
        exitIp: null,
        latencyMs,
        error: `echo devolveu conteúdo que não parece um IP: "${body.slice(0, 120)}"`,
      };
    }

    return { ok: true, exitIp: body, latencyMs };
  } catch (err) {
    return {
      ok: false,
      exitIp: null,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await agent.close().catch(() => {});
  }
}
