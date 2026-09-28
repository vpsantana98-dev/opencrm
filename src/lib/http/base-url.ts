// ============================================================
// Resolução da origem pública (esquema + host, sem barra final) que uma
// requisição está usando para chegar neste app.
//
// Usado em qualquer lugar que precise montar uma URL auto-referencial
// (link de convite em /api/account/invitations, a URL do webhook da
// Evolution em /api/whatsapp/evolution/connect e connect-public) sem
// depender de um NEXT_PUBLIC_SITE_URL configurado.
//
// AMEAÇA: X-Forwarded-Host, X-Forwarded-Proto e Host são headers da
// REQUISIÇÃO, não do proxy. Atrás de um proxy reverso que sobrescreve
// esses headers (Vercel, Cloudflare, nginx bem configurado), confiar
// neles é seguro. Numa rota exposta direto, ou atrás de um proxy que
// repassa o header do cliente sem sobrescrever, quem faz a chamada
// controla o valor. Isso fica grave quando a URL derivada vira o
// DESTINO de uma chamada de saída para outro sistema: no caso do
// webhook da Evolution, é a Evolution que faz POST para a URL que a
// gente manda no /instance/create, então um Host forjado faz a
// Evolution entregar o segredo do webhook para o host que o atacante
// escolher.
//
// Duas funções de resolução, para dois níveis de risco:
//
//   - `resolveBaseUrl(request, allowList)`: para links que um HUMANO
//     copia e compartilha (convite de conta). Prioriza
//     NEXT_PUBLIC_SITE_URL; sem ela, cai para os headers da
//     requisição, protegidos por uma allowlist opcional. Errar aqui na
//     pior hipótese gera um link apontando pro host errado.
//
//   - `resolveConfiguredBaseUrl()`: para qualquer URL que vira DESTINO
//     de uma chamada de saída de um sistema externo (o webhook da
//     Evolution). Aceita SOMENTE NEXT_PUBLIC_SITE_URL, validada como
//     URL http(s) bem formada, e nunca olha para nenhum header. Sem a
//     env, devolve null: a rota chamadora deve recusar (503), nunca
//     inventar um destino a partir de algo que a própria requisição
//     controla.
//
// Outras defesas que valem para as duas funções:
//   - X-Forwarded-Proto (e o protocolo de `request.url`) só aceitam
//     "http" ou "https"; qualquer outro valor (`javascript:`, lixo,
//     ausente) cai para o default seguro "https". Sem essa checagem,
//     um X-Forwarded-Proto forjado vira literalmente o ESQUEMA da URL
//     que a Evolution usaria para entregar o webhook.
//   - X-Forwarded-Host, quando vem como lista separada por vírgula
//     (múltiplos proxies anexando em vez de sobrescrever o header),
//     usa o valor MAIS À DIREITA. Mesma convenção do X-Forwarded-For:
//     numa cadeia cliente → proxy A → proxy B → app, cada salto tende
//     a ANEXAR seu próprio valor à direita do que já veio, então o
//     mais à esquerda pode ter sido escrito pelo próprio cliente, e o
//     mais à direita é o mais próximo da infraestrutura que a gente
//     controla. Rejeitar por completo sempre que houver vírgula
//     quebraria topologias legítimas de múltiplos proxies (CDN na
//     frente de um reverse proxy) sem ganho de segurança sobre pegar
//     o valor mais à direita.
// ============================================================

const ALLOWED_PROTOCOLS = new Set(["http", "https"]);

/**
 * Sanitiza um protocolo vindo de header (ou de `request.url`): só
 * "http" e "https" são aceitos, case-insensitive. Qualquer outro valor
 * (esquema exótico tipo `javascript:`, lixo, ausente) cai para o
 * default seguro "https", em vez de virar literalmente o esquema da
 * URL montada.
 */
function sanitizeProto(candidate: string | undefined | null): string {
  const normalized = candidate?.trim().toLowerCase();
  return normalized && ALLOWED_PROTOCOLS.has(normalized) ? normalized : "https";
}

/**
 * Extrai o valor mais à direita de um header que pode vir como lista
 * separada por vírgula (ver justificativa no topo do arquivo).
 * `header.split(",")` num header sem vírgula devolve um array de um
 * elemento só, então isso também cobre o caso comum sem mudar nada.
 */
function rightmost(headerValue: string | null): string | undefined {
  if (!headerValue) return undefined;
  const parts = headerValue.split(",");
  return parts[parts.length - 1]?.trim() || undefined;
}

/**
 * Lê `NEXT_PUBLIC_SITE_URL`, valida que é uma URL http(s) bem formada e
 * devolve sem barra final. `null` quando a env está ausente, vazia
 * após `trim()`, ou malformada (sem esquema, esquema não http(s), ou
 * não parseável como URL): nesses últimos casos loga um erro, porque
 * uma env configurada errada é um jeito silencioso demais de a
 * proteção parecer ativa sem estar.
 */
function getExplicitSiteUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_SITE_URL;
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  const candidate = trimmed.replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    console.error(
      `[base-url] NEXT_PUBLIC_SITE_URL não é uma URL válida, ignorando: "${trimmed}"`,
    );
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    console.error(
      `[base-url] NEXT_PUBLIC_SITE_URL com esquema "${parsed.protocol}" (precisa ser http ou https), ignorando: "${trimmed}"`,
    );
    return null;
  }
  return candidate;
}

/**
 * Converte o valor de uma env de allowlist (lista de hosts separada por
 * vírgula) num array normalizado, ou null se a env não estiver setada.
 */
export function parseAllowedHosts(
  envValue: string | undefined,
): readonly string[] | null {
  const raw = envValue?.trim();
  if (!raw) return null;
  const list = raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return list.length > 0 ? list : null;
}

/**
 * Sem allowlist (null), qualquer host é aceito (comportamento
 * permissivo). Com allowlist, exige presença EXATA na lista
 * (case-insensitive): não prefixo, não sufixo, não substring. Isso já
 * rejeita sozinho as variantes de ataque por sufixo/prefixo
 * (`crm.example.com.evil.tld`, `crm.example.com.`,
 * `crm.example.com@evil.tld`, host com porta quando a lista não tem
 * porta): nenhuma delas é IGUAL a uma entrada da lista.
 */
export function isHostAllowed(
  hostname: string,
  allowList: readonly string[] | null,
): boolean {
  if (!allowList) return true;
  return allowList.includes(hostname.toLowerCase());
}

/**
 * Resolve a origem pública (`esquema://host`, sem barra final) desta
 * requisição, seguindo a ordem de prioridade documentada no topo do
 * arquivo. Devolve `null` quando não foi possível derivar uma origem
 * confiável (nem NEXT_PUBLIC_SITE_URL setada, nem um host de header que
 * bata com `allowList`).
 *
 * Uso: links que um humano copia e compartilha (convite de conta). NÃO
 * use para uma URL que vira destino de chamada de saída de um sistema
 * externo; para isso, use `resolveConfiguredBaseUrl`.
 */
export function resolveBaseUrl(
  request: Request,
  allowList: readonly string[] | null,
): string | null {
  const explicit = getExplicitSiteUrl();
  if (explicit) return explicit;

  const forwardedHost = rightmost(request.headers.get("x-forwarded-host"));
  const forwardedProto = sanitizeProto(
    rightmost(request.headers.get("x-forwarded-proto")),
  );
  if (forwardedHost && isHostAllowed(forwardedHost, allowList)) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  const host = request.headers.get("host")?.trim();
  if (host && isHostAllowed(host, allowList)) {
    // O protocolo em `request.url` é o que o framework enxergou, mas
    // ainda assim passa pelo mesmo saneamento: defesa em profundidade
    // que não custa nada e não deveria mudar nenhum caso legítimo
    // (deploys Next.js só enxergam "http:" ou "https:" aqui).
    const reqProto = sanitizeProto(
      new URL(request.url).protocol.replace(":", ""),
    );
    return `${reqProto}://${host}`;
  }

  return null;
}

/**
 * Resolução ESTRITA: aceita SOMENTE `NEXT_PUBLIC_SITE_URL`, validada, e
 * nunca olha para nenhum header da requisição. Sem a env (ausente,
 * vazia, ou malformada), devolve `null`.
 *
 * Uso: qualquer URL que vira o DESTINO de uma chamada de saída
 * registrada num sistema externo (a URL do webhook que a Evolution usa
 * para entregar eventos de volta pro CRM). Aceitar um header aqui,
 * mesmo atrás de uma allowlist, reabriria exatamente a superfície que
 * essas rotas existem para fechar: um Host forjado levaria o segredo
 * do webhook para o host escolhido por quem forjou o header. O
 * chamador deve recusar (503) quando isto devolve `null`, nunca cair
 * para um header como último recurso.
 */
export function resolveConfiguredBaseUrl(): string | null {
  return getExplicitSiteUrl();
}
