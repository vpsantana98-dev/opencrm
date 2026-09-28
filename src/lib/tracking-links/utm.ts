// ============================================================
// UTMs dos links rastreáveis. extractUtmParams sanitiza a query do
// clique (/t/<code>?utm_...): só os 5 parâmetros conhecidos, valores
// aparados e truncados. pickUtm normaliza um row (link_clicks ou os
// padrões do tracking_links) no mesmo formato de snapshot que vai
// para contacts.source_utm.
// ============================================================

export const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
] as const;

export type UtmKey = (typeof UTM_KEYS)[number];
export type UtmParams = Partial<Record<UtmKey, string>>;

const MAX_VALUE_LENGTH = 255;

export function extractUtmParams(
  searchParams: URLSearchParams
): UtmParams | null {
  const out: UtmParams = {};
  let any = false;
  for (const key of UTM_KEYS) {
    const raw = searchParams.get(key);
    if (raw == null) continue;
    const value = raw.trim().slice(0, MAX_VALUE_LENGTH);
    if (!value) continue;
    out[key] = value;
    any = true;
  }
  return any ? out : null;
}

export function pickUtm(
  row: Partial<Record<UtmKey, string | null>> | null | undefined
): UtmParams | null {
  if (!row) return null;
  const out: UtmParams = {};
  let any = false;
  for (const key of UTM_KEYS) {
    const raw = row[key];
    if (typeof raw !== 'string') continue;
    const value = raw.trim().slice(0, MAX_VALUE_LENGTH);
    if (!value) continue;
    out[key] = value;
    any = true;
  }
  return any ? out : null;
}
