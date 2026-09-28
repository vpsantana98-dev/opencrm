import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { sendConversion, type MetaAdsConfigRow } from "@/lib/meta-ads/capi";

// POST /api/account/meta-ads/test  (admin+)
// Dispara um evento de teste pra Meta CAPI, usando a config SALVA. Exige
// o Código de Teste (Test Events) do Gerenciador de Eventos, para o
// evento cair na aba de testes e não na produção.
export async function POST() {
  try {
    const ctx = await requireRole("admin");
    const admin = supabaseAdmin();

    const { data: cfg } = await admin
      .from("meta_ads_config")
      .select(
        "account_id, pixel_id, capi_token, test_event_code, action_source, lead_enabled, purchase_stage_id, purchase_currency, enabled",
      )
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (!cfg?.pixel_id || !cfg?.capi_token) {
      return NextResponse.json(
        { error: "Preencha o Pixel e o token da API de Conversão e salve antes de testar." },
        { status: 400 },
      );
    }
    if (!cfg.test_event_code) {
      return NextResponse.json(
        {
          error:
            "Informe o Código de Teste (Test Events, do Gerenciador de Eventos) e salve. Sem ele o teste iria pra produção.",
        },
        { status: 400 },
      );
    }

    const res = await sendConversion(cfg as MetaAdsConfigRow, {
      eventName: "Lead",
      eventId: `test_${ctx.accountId}_${Date.now()}`,
      // telefone sintético só para o evento de teste ter um identificador;
      // cai na aba Test Events, não afeta otimização.
      phone: "+550000000000",
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: res.error ?? "A Meta recusou o evento", body: res.body },
        { status: 200 },
      );
    }
    return NextResponse.json({ ok: true, body: res.body });
  } catch (err) {
    return toErrorResponse(err);
  }
}
