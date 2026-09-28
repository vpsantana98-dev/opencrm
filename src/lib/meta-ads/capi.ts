// ============================================================
// Cliente da API de Conversão da Meta (CAPI). SERVER-ONLY.
//
// Envia eventos de conversão server-to-server pro Pixel do cliente:
//   POST https://graph.facebook.com/v21.0/{pixel_id}/events
//
// O token vem cifrado no banco (meta_ads_config.capi_token) e é
// decifrado só aqui, no servidor. Nunca exponha pixel_id+token juntos
// ao cliente.
//
// Atribuição Click-to-WhatsApp (CTWA): quando temos o ctwa_clid (só
// vem pelo número oficial da Meta), mandamos em user_data + usamos
// action_source 'business_messaging'. Sem ele, o evento ainda conta,
// mas a Meta casa por dados (telefone) — atribuição mais fraca.
// ============================================================

import crypto from "crypto";

import { decrypt } from "@/lib/whatsapp/encryption";

const GRAPH_VERSION = "v21.0";

export interface MetaAdsConfigRow {
  account_id: string;
  pixel_id: string | null;
  capi_token: string | null; // cifrado
  test_event_code: string | null;
  action_source: string;
  lead_enabled: boolean;
  purchase_stage_id: string | null;
  purchase_currency: string;
  enabled: boolean;
}

/** SHA-256 (hex) do valor normalizado, como a Meta exige em user_data. */
function hashPii(value: string): string {
  return crypto
    .createHash("sha256")
    .update(value.trim().toLowerCase())
    .digest("hex");
}

/** Só dígitos, para o telefone (a Meta pede sem "+" nem símbolos). */
function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9]/g, "");
}

export interface ConversionInput {
  eventName: "Lead" | "Purchase" | "Contact" | string;
  /** id estável para dedupe na Meta (ex.: lead_<contactId>). */
  eventId: string;
  eventTimeSec?: number;
  phone?: string | null;
  ctwaClid?: string | null;
  value?: number | null;
  currency?: string | null;
  /** sobrescreve o action_source da config, se preciso. */
  actionSource?: string;
}

export interface CapiResult {
  ok: boolean;
  status: number;
  body: unknown;
  error?: string;
}

/**
 * Dispara um evento de conversão pra Meta CAPI usando a config do
 * cliente. Retorna o resultado (não lança) para o chamador logar.
 */
export async function sendConversion(
  config: MetaAdsConfigRow,
  input: ConversionInput,
): Promise<CapiResult> {
  if (!config.pixel_id || !config.capi_token) {
    return { ok: false, status: 0, body: null, error: "Pixel/token ausente" };
  }

  let token: string;
  try {
    token = decrypt(config.capi_token);
  } catch {
    return { ok: false, status: 0, body: null, error: "Token inválido (falha ao decifrar)" };
  }

  const actionSource = input.actionSource ?? config.action_source ?? "website";

  const userData: Record<string, unknown> = {};
  if (input.phone) userData.ph = [hashPii(normalizePhone(input.phone))];
  // ctwa_clid vai em claro (é um id de clique, não PII).
  if (input.ctwaClid) userData.ctwa_clid = input.ctwaClid;

  const customData: Record<string, unknown> = {};
  if (typeof input.value === "number") {
    customData.value = input.value;
    customData.currency = input.currency ?? config.purchase_currency ?? "BRL";
  }

  const event: Record<string, unknown> = {
    event_name: input.eventName,
    event_time: input.eventTimeSec ?? Math.floor(Date.now() / 1000),
    action_source: actionSource,
    event_id: input.eventId,
    user_data: userData,
  };
  if (Object.keys(customData).length > 0) event.custom_data = customData;

  const payload: Record<string, unknown> = { data: [event] };
  if (config.test_event_code) payload.test_event_code = config.test_event_code;

  try {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${config.pixel_id}/events?access_token=${encodeURIComponent(
      token,
    )}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const msg =
        (body as { error?: { message?: string } } | null)?.error?.message ??
        `HTTP ${res.status}`;
      return { ok: false, status: res.status, body, error: msg };
    }
    return { ok: true, status: res.status, body };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: null,
      error: err instanceof Error ? err.message : "Erro de rede",
    };
  }
}
