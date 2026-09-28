import { NextResponse } from "next/server";

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { encrypt } from "@/lib/whatsapp/encryption";

// GET /api/account/meta-ads
// Config de rastreamento Meta do cliente ativo (sem o token em claro),
// + estágios de funil para o seletor de "compra" + últimos eventos.
export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const db = ctx.supabase;

    const [{ data: cfg }, { data: pipelines }, { data: stages }, { data: events }] =
      await Promise.all([
        db
          .from("meta_ads_config")
          .select(
            "pixel_id, capi_token, test_event_code, action_source, lead_enabled, purchase_stage_id, purchase_currency, enabled",
          )
          .eq("account_id", ctx.accountId)
          .maybeSingle(),
        db.from("pipelines").select("id, name"),
        db.from("pipeline_stages").select("id, name, pipeline_id, position"),
        db
          .from("meta_conversion_events")
          .select("id, event_name, status, error, created_at")
          .eq("account_id", ctx.accountId)
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
        pixel_id: cfg?.pixel_id ?? "",
        test_event_code: cfg?.test_event_code ?? "",
        action_source: cfg?.action_source ?? "business_messaging",
        lead_enabled: cfg?.lead_enabled ?? true,
        purchase_stage_id: cfg?.purchase_stage_id ?? "",
        purchase_currency: cfg?.purchase_currency ?? "BRL",
        enabled: cfg?.enabled ?? true,
        hasToken: !!cfg?.capi_token,
      },
      stages: stageOptions,
      events: events ?? [],
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/account/meta-ads  (só admin+)
// Salva a config. O token só é regravado se vier preenchido; vazio =
// mantém o atual (não apaga sem querer).
export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const body = (await request.json().catch(() => ({}))) as {
      pixel_id?: string;
      capi_token?: string;
      test_event_code?: string;
      action_source?: string;
      lead_enabled?: boolean;
      purchase_stage_id?: string | null;
      purchase_currency?: string;
      enabled?: boolean;
    };

    const row: Record<string, unknown> = {
      account_id: ctx.accountId,
      pixel_id: (body.pixel_id ?? "").trim() || null,
      test_event_code: (body.test_event_code ?? "").trim() || null,
      action_source:
        body.action_source === "website" ? "website" : "business_messaging",
      lead_enabled: body.lead_enabled !== false,
      purchase_stage_id: body.purchase_stage_id || null,
      purchase_currency: (body.purchase_currency ?? "BRL").trim() || "BRL",
      enabled: body.enabled !== false,
    };
    // Só regrava o token se veio algo (cifra); vazio mantém o atual.
    if (typeof body.capi_token === "string" && body.capi_token.trim()) {
      row.capi_token = encrypt(body.capi_token.trim());
    }

    const { error } = await ctx.supabase
      .from("meta_ads_config")
      .upsert(row, { onConflict: "account_id" });
    if (error) {
      console.error("[meta-ads] upsert error:", error);
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
