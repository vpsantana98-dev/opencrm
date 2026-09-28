// ============================================================
// Dispara e registra conversões Google Ads (Lead / Purchase).
// SERVER-ONLY. Best-effort: nunca lança (não pode derrubar o webhook
// nem o fluxo do funil). Loga em meta_conversion_events com provider
// 'google'.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  sendGoogleConversion,
  type GoogleAdsConfigRow,
} from "@/lib/google-ads/client";

async function loadConfig(
  admin: SupabaseClient,
  accountId: string,
): Promise<GoogleAdsConfigRow | null> {
  const { data } = await admin
    .from("google_ads_config")
    .select(
      "account_id, customer_id, login_customer_id, developer_token, oauth_client_id, oauth_client_secret, oauth_refresh_token, conversion_action_lead, conversion_action_purchase, purchase_currency, lead_enabled, purchase_stage_id, enabled",
    )
    .eq("account_id", accountId)
    .maybeSingle();
  return (data as GoogleAdsConfigRow | null) ?? null;
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
  await admin
    .from("meta_conversion_events")
    .insert({ ...row, provider: "google" });
}

export async function recordGoogleLead(
  admin: SupabaseClient,
  accountId: string,
  opts: { contactId: string; phone?: string | null; gclid?: string | null },
): Promise<void> {
  try {
    const config = await loadConfig(admin, accountId);
    if (!config || !config.enabled || !config.lead_enabled) return;
    if (!config.customer_id || !config.conversion_action_lead) return;

    const eventId = `glead_${opts.contactId}`;
    const res = await sendGoogleConversion(config, {
      conversionAction: config.conversion_action_lead,
      phone: opts.phone,
      gclid: opts.gclid,
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
    console.error("[google-ads] recordLead error:", err);
  }
}

export async function recordGooglePurchase(
  admin: SupabaseClient,
  accountId: string,
  opts: {
    contactId: string | null;
    dealId: string;
    phone?: string | null;
    gclid?: string | null;
    value?: number | null;
    currency?: string | null;
  },
): Promise<void> {
  try {
    const config = await loadConfig(admin, accountId);
    if (!config || !config.enabled) return;
    if (!config.customer_id || !config.conversion_action_purchase) return;

    const eventId = `gpurchase_${opts.dealId}`;
    const res = await sendGoogleConversion(config, {
      conversionAction: config.conversion_action_purchase,
      phone: opts.phone,
      gclid: opts.gclid,
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
  } catch (err) {
    console.error("[google-ads] recordPurchase error:", err);
  }
}
