// ============================================================
// Dispara e registra eventos de conversão Meta (Lead / Purchase).
// SERVER-ONLY. Best-effort: qualquer falha é logada em
// meta_conversion_events e NUNCA lança (não pode derrubar o webhook
// nem o fluxo do funil).
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { sendConversion, type MetaAdsConfigRow } from "@/lib/meta-ads/capi";

async function loadConfig(
  admin: SupabaseClient,
  accountId: string,
): Promise<MetaAdsConfigRow | null> {
  const { data } = await admin
    .from("meta_ads_config")
    .select(
      "account_id, pixel_id, capi_token, test_event_code, action_source, lead_enabled, purchase_stage_id, purchase_currency, enabled",
    )
    .eq("account_id", accountId)
    .maybeSingle();
  return (data as MetaAdsConfigRow | null) ?? null;
}

async function logEvent(
  admin: SupabaseClient,
  row: {
    account_id: string;
    contact_id: string | null;
    event_name: string;
    event_id: string;
    status: string;
    error?: string | null;
  },
) {
  await admin.from("meta_conversion_events").insert(row);
}

/** Evento de Lead — chamado quando um lead novo escreve (inbound). */
export async function recordLead(
  admin: SupabaseClient,
  accountId: string,
  opts: { contactId: string; phone?: string | null; ctwaClid?: string | null },
): Promise<void> {
  try {
    const config = await loadConfig(admin, accountId);
    if (!config || !config.enabled || !config.lead_enabled) return;
    if (!config.pixel_id || !config.capi_token) return;

    const eventId = `lead_${opts.contactId}`;
    const res = await sendConversion(config, {
      eventName: "Lead",
      eventId,
      phone: opts.phone,
      ctwaClid: opts.ctwaClid,
    });
    await logEvent(admin, {
      account_id: accountId,
      contact_id: opts.contactId,
      event_name: "Lead",
      event_id: eventId,
      status: res.ok ? "sent" : "failed",
      error: res.ok ? null : (res.error ?? "erro"),
    });
  } catch (err) {
    console.error("[meta-ads] recordLead error:", err);
  }
}

/** Evento de Purchase — chamado ao mover um negócio pro estágio "compra". */
export async function recordPurchase(
  admin: SupabaseClient,
  accountId: string,
  opts: {
    contactId: string | null;
    dealId: string;
    phone?: string | null;
    ctwaClid?: string | null;
    value?: number | null;
    currency?: string | null;
  },
): Promise<{ fired: boolean; error?: string }> {
  try {
    const config = await loadConfig(admin, accountId);
    if (!config || !config.enabled) return { fired: false };
    if (!config.pixel_id || !config.capi_token) return { fired: false };

    const eventId = `purchase_${opts.dealId}`;
    const res = await sendConversion(config, {
      eventName: "Purchase",
      eventId,
      phone: opts.phone,
      ctwaClid: opts.ctwaClid,
      value: opts.value,
      currency: opts.currency ?? config.purchase_currency,
    });
    await logEvent(admin, {
      account_id: accountId,
      contact_id: opts.contactId,
      event_name: "Purchase",
      event_id: eventId,
      status: res.ok ? "sent" : "failed",
      error: res.ok ? null : (res.error ?? "erro"),
    });
    return { fired: res.ok, error: res.ok ? undefined : res.error };
  } catch (err) {
    console.error("[meta-ads] recordPurchase error:", err);
    return { fired: false, error: "erro interno" };
  }
}
