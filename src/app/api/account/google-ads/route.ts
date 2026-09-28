import { NextResponse } from "next/server";

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { encrypt } from "@/lib/whatsapp/encryption";

// GET /api/account/google-ads
// Config de rastreamento Google Ads do cliente ativo (sem segredos em
// claro), + estágios pro seletor de "compra" + últimos eventos google.
export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const db = ctx.supabase;

    const [{ data: cfg }, { data: pipelines }, { data: stages }, { data: events }] =
      await Promise.all([
        db
          .from("google_ads_config")
          .select(
            "customer_id, login_customer_id, developer_token, oauth_client_id, oauth_client_secret, oauth_refresh_token, conversion_action_lead, conversion_action_purchase, purchase_currency, lead_enabled, purchase_stage_id, enabled",
          )
          .eq("account_id", ctx.accountId)
          .maybeSingle(),
        db.from("pipelines").select("id, name"),
        db.from("pipeline_stages").select("id, name, pipeline_id, position"),
        db
          .from("meta_conversion_events")
          .select("id, event_name, status, error, created_at")
          .eq("account_id", ctx.accountId)
          .eq("provider", "google")
          .order("created_at", { ascending: false })
          .limit(10),
      ]);

    const pipeName = new Map(
      (pipelines ?? []).map((p) => [p.id as string, p.name as string]),
    );
    const stageOptions = (stages ?? [])
      .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
      .map((s) => ({
        id: s.id as string,
        label: `${pipeName.get(s.pipeline_id as string) ?? "Funil"} · ${s.name as string}`,
      }));

    return NextResponse.json({
      config: {
        customer_id: cfg?.customer_id ?? "",
        login_customer_id: cfg?.login_customer_id ?? "",
        conversion_action_lead: cfg?.conversion_action_lead ?? "",
        conversion_action_purchase: cfg?.conversion_action_purchase ?? "",
        purchase_currency: cfg?.purchase_currency ?? "BRL",
        lead_enabled: cfg?.lead_enabled ?? true,
        purchase_stage_id: cfg?.purchase_stage_id ?? "",
        enabled: cfg?.enabled ?? true,
        hasDeveloperToken: !!cfg?.developer_token,
        hasOAuth: !!(
          cfg?.oauth_client_id &&
          cfg?.oauth_client_secret &&
          cfg?.oauth_refresh_token
        ),
      },
      stages: stageOptions,
      events: events ?? [],
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/account/google-ads  (admin+)
// Salva a config. Segredos só regravam se vierem preenchidos.
export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const str = (k: string) =>
      typeof body[k] === "string" ? (body[k] as string).trim() : "";

    const row: Record<string, unknown> = {
      account_id: ctx.accountId,
      customer_id: str("customer_id") || null,
      login_customer_id: str("login_customer_id") || null,
      conversion_action_lead: str("conversion_action_lead") || null,
      conversion_action_purchase: str("conversion_action_purchase") || null,
      purchase_currency: str("purchase_currency") || "BRL",
      lead_enabled: body.lead_enabled !== false,
      purchase_stage_id: str("purchase_stage_id") || null,
      enabled: body.enabled !== false,
    };
    // Cifra os segredos só quando enviados (vazio = mantém o atual).
    for (const secret of [
      "developer_token",
      "oauth_client_id",
      "oauth_client_secret",
      "oauth_refresh_token",
    ]) {
      const v = str(secret);
      if (v) row[secret] = encrypt(v);
    }

    const { error } = await ctx.supabase
      .from("google_ads_config")
      .upsert(row, { onConflict: "account_id" });
    if (error) {
      console.error("[google-ads] upsert error:", error);
      return NextResponse.json(
        { error: "Não foi possível salvar a configuração" },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
