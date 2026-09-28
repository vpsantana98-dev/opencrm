/**
 * Seleção de proxy para uma instância Evolution.
 *
 * Função pura, sem I/O: recebe os candidatos já carregados e devolve
 * o escolhido. A camada de dados vive em `proxy-pool.ts`.
 *
 * Regra, nesta ordem:
 *   1. Proxy `active` com vaga e região casando com o DDD do número.
 *   2. Proxy `active` com vaga, menos carregado.
 *   3. null.
 *
 * O null é significativo: o chamador DEVE falhar em vez de conectar
 * sem proxy. Conectar pelo IP da VPS contamina os outros números que
 * saem por lá.
 */

import { sanitizePhoneForMeta } from "@/lib/whatsapp/phone-utils";

export type ProxyStatus = "active" | "degraded" | "disabled";

export interface ProxyCandidate {
  id: string;
  /** 'BR-SP', 'BR-RJ'. Null quando o proxy não tem geo definida. */
  region: string | null;
  maxInstances: number;
  currentInstances: number;
  status: ProxyStatus;
}

/**
 * DDD para UF. Cobre os 67 DDDs em uso no Brasil.
 */
const DDD_TO_UF: Record<string, string> = {
  "11": "SP",
  "12": "SP",
  "13": "SP",
  "14": "SP",
  "15": "SP",
  "16": "SP",
  "17": "SP",
  "18": "SP",
  "19": "SP",
  "21": "RJ",
  "22": "RJ",
  "24": "RJ",
  "27": "ES",
  "28": "ES",
  "31": "MG",
  "32": "MG",
  "33": "MG",
  "34": "MG",
  "35": "MG",
  "37": "MG",
  "38": "MG",
  "41": "PR",
  "42": "PR",
  "43": "PR",
  "44": "PR",
  "45": "PR",
  "46": "PR",
  "47": "SC",
  "48": "SC",
  "49": "SC",
  "51": "RS",
  "53": "RS",
  "54": "RS",
  "55": "RS",
  "61": "DF",
  "62": "GO",
  "64": "GO",
  "63": "TO",
  "65": "MT",
  "66": "MT",
  "67": "MS",
  "68": "AC",
  "69": "RO",
  "71": "BA",
  "73": "BA",
  "74": "BA",
  "75": "BA",
  "77": "BA",
  "79": "SE",
  "81": "PE",
  "87": "PE",
  "82": "AL",
  "83": "PB",
  "84": "RN",
  "85": "CE",
  "88": "CE",
  "86": "PI",
  "89": "PI",
  "91": "PA",
  "93": "PA",
  "94": "PA",
  "92": "AM",
  "97": "AM",
  "95": "RR",
  "96": "AP",
  "98": "MA",
  "99": "MA",
};

/**
 * Extrai o DDD de um telefone brasileiro. Retorna null se não for do
 * Brasil ou for curto demais.
 *
 * Normaliza a entrada removendo tudo que não é dígito (`+`, espaços,
 * hífen, parênteses) ANTES de checar o prefixo "55". Isso importa
 * porque a convenção de telefone do resto do app é E.164 COM o `+`
 * (ver `+${jid...}` em webhook/[secret]/route.ts), enquanto este
 * módulo antes exigia dígitos puros sem `+`. Sem a normalização, quem
 * popular `evolution_instances.phone` no formato do app (`+55...`)
 * desligaria a afinidade regional do proxy em silêncio, sem erro
 * nenhum: `startsWith("55")` nunca bateria. A normalização usa a mesma
 * regra de `sanitizePhoneForMeta` (`phone-utils.ts`), para as duas
 * convenções do app ficarem consistentes.
 *
 * O menor celular brasileiro em E.164 tem 12 dígitos (55 + DDD de 2 +
 * 8 do assinante, forma legada sem o 9).
 */
export function extractDdd(phone: string): string | null {
  const sanitized = sanitizePhoneForMeta(phone);
  if (!sanitized.startsWith("55")) return null;
  if (sanitized.length < 12) return null;
  return sanitized.slice(2, 4);
}

export function dddToUf(ddd: string): string | null {
  return DDD_TO_UF[ddd] ?? null;
}

function hasCapacity(p: ProxyCandidate): boolean {
  return p.status === "active" && p.currentInstances < p.maxInstances;
}

function leastLoaded(pool: ProxyCandidate[]): ProxyCandidate | null {
  if (pool.length === 0) return null;
  return pool.reduce((best, p) =>
    p.currentInstances < best.currentInstances ? p : best,
  );
}

export function selectProxy(
  candidates: ProxyCandidate[],
  opts: { phone?: string | null } = {},
): ProxyCandidate | null {
  const available = candidates.filter(hasCapacity);
  if (available.length === 0) return null;

  const ddd = opts.phone ? extractDdd(opts.phone) : null;
  const uf = ddd ? dddToUf(ddd) : null;

  if (uf) {
    const sameRegion = available.filter((p) => p.region === `BR-${uf}`);
    const picked = leastLoaded(sameRegion);
    if (picked) return picked;
  }

  return leastLoaded(available);
}
