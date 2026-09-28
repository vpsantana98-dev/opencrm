import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { recordPurchase } from "@/lib/meta-ads/record";
import { recordGooglePurchase } from "@/lib/google-ads/record";

// POST /api/account/meta-ads/conversion  { dealId, stageId }
// Chamado pela tela de funil quando um negócio muda de etapa. Dispara o
// evento Purchase pra Meta (CAPI) e/ou Google Ads, cada um se o estágio
// bater com o configurado no respectivo provedor. Silencioso quando não
// se aplica.
export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const admin = supabaseAdmin();
    const body = (await request.json().catch(() => ({}))) as {
      dealId?: string;
      stageId?: string;
    };
    if (!body.dealId || !body.stageId) {
      return NextResponse.json({ fired: false });
    }

    // Confere que o negócio é deste cliente (tenancy) e pega valor+contato.
    const { data: deal } = await admin
      .from("deals")
      .select("id, account_id, contact_id, value")
      .eq("id", body.dealId)
      .maybeSingle();
    if (!deal || deal.account_id !== ctx.accountId) {
      return NextResponse.json({ fired: false });
    }

    let phone: string | null = null;
    let ctwaClid: string | null = null;
    let gclid: string | null = null;
    if (deal.contact_id) {
      const { data: contact } = await admin
        .from("contacts")
        .select("phone, ctwa_clid, gclid")
        .eq("id", deal.contact_id)
        .maybeSingle();
      phone = (contact?.phone as string) ?? null;
      ctwaClid = (contact?.ctwa_clid as string) ?? null;
      gclid = (contact?.gclid as string) ?? null;
    }

    const contactId = (deal.contact_id as string) ?? null;
    const dealId = deal.id as string;
    const value = (deal.value as number) ?? null;
    let fired = false;

    // Meta (CAPI)
    const { data: meta } = await admin
      .from("meta_ads_config")
      .select("purchase_stage_id, enabled")
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (meta?.enabled && meta.purchase_stage_id === body.stageId) {
      const r = await recordPurchase(admin, ctx.accountId, {
        contactId,
        dealId,
        phone,
        ctwaClid,
        value,
      });
      fired = fired || r.fired;
    }

    // Google Ads (a tabela pode não existir ainda -> data null -> pula)
    const { data: g } = await admin
      .from("google_ads_config")
      .select("purchase_stage_id, enabled")
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (g?.enabled && g.purchase_stage_id === body.stageId) {
      await recordGooglePurchase(admin, ctx.accountId, {
        contactId,
        dealId,
        phone,
        gclid,
        value,
      });
      fired = true;
    }

    return NextResponse.json({ fired });
  } catch (err) {
    return toErrorResponse(err);
  }
}
