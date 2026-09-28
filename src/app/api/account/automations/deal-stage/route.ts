import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { runAutomationsForTrigger } from "@/lib/automations/engine";

// POST /api/account/automations/deal-stage  { dealId, stageId }
// Chamado pela tela de funil quando um negócio muda de etapa. Dispara as
// automações com gatilho "deal_stage_changed" configuradas para este
// estágio (envia a mensagem/template pro contato do negócio). Silencioso
// e best-effort — não atrapalha o mover do negócio.
export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const admin = supabaseAdmin();
    const body = (await request.json().catch(() => ({}))) as {
      dealId?: string;
      stageId?: string;
    };
    if (!body.dealId || !body.stageId) {
      return NextResponse.json({ ok: false });
    }

    // Confere que o negócio é deste cliente (tenancy) e pega o contato.
    const { data: deal } = await admin
      .from("deals")
      .select("id, account_id, contact_id")
      .eq("id", body.dealId)
      .maybeSingle();
    if (!deal || deal.account_id !== ctx.accountId || !deal.contact_id) {
      return NextResponse.json({ ok: false });
    }

    // Fire-and-forget: o engine resolve a conversa pelo contato e nunca
    // lança. O triggerMatches filtra pelas automações do estágio certo.
    void runAutomationsForTrigger({
      accountId: ctx.accountId,
      triggerType: "deal_stage_changed",
      contactId: deal.contact_id as string,
      context: { stage_id: body.stageId },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
