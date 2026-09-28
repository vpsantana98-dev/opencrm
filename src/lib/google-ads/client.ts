// ============================================================
// Cliente da Google Ads API (conversões offline). SERVER-ONLY.
//
// Envia conversões pela Google Ads API (uploadClickConversions com
// Enhanced Conversions for Leads): quando não há gclid, casa pelo
// telefone com hash (userIdentifiers). Espelha o capi.ts do Meta.
//
// Credenciais cifradas no banco (google_ads_config). OAuth: troca o
// refresh_token por um access_token a cada chamada (simples; sem cache
// pra não guardar token vivo).
//
// ⚠️ Precisa das credenciais reais (developer token + OAuth) pra validar.
// O contrato exato da API (versão/campos) pode pedir ajuste no 1º teste.
// ============================================================

import crypto from "crypto";

import { decrypt } from "@/lib/whatsapp/encryption";

const API_VERSION = "v18";

export interface GoogleAdsConfigRow {
  account_id: string;
  customer_id: string | null;
  login_customer_id: string | null;
  developer_token: string | null; // cifrado
  oauth_client_id: string | null; // cifrado
  oauth_client_secret: string | null; // cifrado
  oauth_refresh_token: string | null; // cifrado
  conversion_action_lead: string | null;
  conversion_action_purchase: string | null;
  purchase_currency: string;
  lead_enabled: boolean;
  purchase_stage_id: string | null;
  enabled: boolean;
}

function hashPhone(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, "");
  const e164 = digits.startsWith("+") ? digits : `+${digits}`;
  return crypto.createHash("sha256").update(e164.trim().toLowerCase()).digest("hex");
}

/** Formato exigido pela Google: "yyyy-MM-dd HH:mm:ss+00:00". */
function conversionDateTime(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+00:00`
  );
}

async function getAccessToken(config: GoogleAdsConfigRow): Promise<string | null> {
  if (
    !config.oauth_client_id ||
    !config.oauth_client_secret ||
    !config.oauth_refresh_token
  ) {
    return null;
  }
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: decrypt(config.oauth_client_id),
        client_secret: decrypt(config.oauth_client_secret),
        refresh_token: decrypt(config.oauth_refresh_token),
        grant_type: "refresh_token",
      }),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as {
      access_token?: string;
    } | null;
    return body?.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * Testa as credenciais (OAuth + developer token) sem enviar conversão:
 * lista as contas acessíveis. Verifica que o refresh token e o developer
 * token funcionam. Não valida o conversion_action específico.
 */
export async function testGoogleAdsConnection(
  config: GoogleAdsConfigRow,
): Promise<{ ok: boolean; status: number; body: unknown; error?: string }> {
  if (!config.developer_token) {
    return { ok: false, status: 0, body: null, error: "developer token ausente" };
  }
  const accessToken = await getAccessToken(config);
  if (!accessToken) {
    return {
      ok: false,
      status: 0,
      body: null,
      error: "OAuth falhou (client id / secret / refresh token)",
    };
  }
  try {
    let devToken: string;
    try {
      devToken = decrypt(config.developer_token);
    } catch {
      return { ok: false, status: 0, body: null, error: "developer token inválido" };
    }
    const res = await fetch(
      `https://googleads.googleapis.com/${API_VERSION}/customers:listAccessibleCustomers`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": devToken,
        },
        cache: "no-store",
      },
    );
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

export interface GoogleConversionInput {
  conversionAction: string; // resource name
  phone?: string | null;
  gclid?: string | null;
  value?: number | null;
  currency?: string | null;
}

export interface GoogleResult {
  ok: boolean;
  status: number;
  body: unknown;
  error?: string;
}

export async function sendGoogleConversion(
  config: GoogleAdsConfigRow,
  input: GoogleConversionInput,
): Promise<GoogleResult> {
  if (!config.customer_id || !config.developer_token || !input.conversionAction) {
    return { ok: false, status: 0, body: null, error: "Config incompleta" };
  }
  const accessToken = await getAccessToken(config);
  if (!accessToken) {
    return { ok: false, status: 0, body: null, error: "OAuth falhou (refresh token)" };
  }

  const conversion: Record<string, unknown> = {
    conversionAction: input.conversionAction,
    conversionDateTime: conversionDateTime(),
  };
  if (input.gclid) conversion.gclid = input.gclid;
  if (input.phone) {
    conversion.userIdentifiers = [{ hashedPhoneNumber: hashPhone(input.phone) }];
  }
  if (typeof input.value === "number") {
    conversion.conversionValue = input.value;
    conversion.currencyCode = input.currency ?? config.purchase_currency ?? "BRL";
  }

  const customerId = config.customer_id.replace(/[^0-9]/g, "");
  const url = `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}:uploadClickConversions`;

  try {
    let devToken: string;
    try {
      devToken = decrypt(config.developer_token);
    } catch {
      return { ok: false, status: 0, body: null, error: "developer token inválido" };
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": devToken,
      "Content-Type": "application/json",
    };
    if (config.login_customer_id) {
      headers["login-customer-id"] = config.login_customer_id.replace(/[^0-9]/g, "");
    }
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ conversions: [conversion], partialFailure: true }),
      cache: "no-store",
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const msg =
        (body as { error?: { message?: string } } | null)?.error?.message ??
        `HTTP ${res.status}`;
      return { ok: false, status: res.status, body, error: msg };
    }
    // partialFailure: a Google pode devolver 200 com erro parcial no corpo.
    const partial = (body as { partialFailureError?: { message?: string } } | null)
      ?.partialFailureError;
    if (partial) {
      return { ok: false, status: res.status, body, error: partial.message ?? "falha parcial" };
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
