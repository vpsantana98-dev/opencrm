import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import {
  testGoogleAdsConnection,
  type GoogleAdsConfigRow,
} from "@/lib/google-ads/client";

// POST /api/account/google-ads/test  (admin+)
// Verifica as credenciais (OAuth + developer token) da config SALVA,
// listando as contas acessíveis. Não envia conversão.
export async function POST() {
  try {
    const ctx = await requireRole("admin");
    const admin = supabaseAdmin();

    const { data: cfg } = await admin
      .from("google_ads_config")
      .select(
        "account_id, customer_id, login_customer_id, developer_token, oauth_client_id, oauth_client_secret, oauth_refresh_token, conversion_action_lead, conversion_action_purchase, purchase_currency, lead_enabled, purchase_stage_id, enabled",
      )
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (!cfg?.developer_token || !cfg?.oauth_refresh_token) {
      return NextResponse.json(
        { error: "Preencha o developer token e o OAuth (client id/secret/refresh) e salve antes de testar." },
        { status: 400 },
      );
    }

    const res = await testGoogleAdsConnection(cfg as GoogleAdsConfigRow);
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: res.error ?? "Falha ao validar credenciais", body: res.body },
        { status: 200 },
      );
    }
    return NextResponse.json({ ok: true, body: res.body });
  } catch (err) {
    return toErrorResponse(err);
  }
}
