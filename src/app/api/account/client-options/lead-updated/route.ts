import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/auth/admin-client';
import { dispatchClientLeadWebhook } from '@/lib/client-options/webhooks';

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const body = (await request.json().catch(() => ({}))) as {
      dealId?: string;
      stageId?: string;
      stageChanged?: boolean;
    };
    if (!body.dealId || !body.stageId) {
      return NextResponse.json({ error: 'Dados incompletos' }, { status: 400 });
    }
    const admin = supabaseAdmin();
    const [{ data: deal }, { data: options }] = await Promise.all([
      admin
        .from('deals')
        .select('id, title, contact_id, stage_id, value, currency')
        .eq('id', body.dealId)
        .eq('account_id', ctx.accountId)
        .maybeSingle(),
      admin
        .from('client_setup_options')
        .select('webhook_stage_changes_only')
        .eq('account_id', ctx.accountId)
        .maybeSingle(),
    ]);
    if (!deal)
      return NextResponse.json(
        { error: 'Lead não encontrado' },
        { status: 404 }
      );
    if (options?.webhook_stage_changes_only && body.stageChanged !== true) {
      return NextResponse.json({ ok: true });
    }
    await dispatchClientLeadWebhook(admin, ctx.accountId, 'lead.updated', {
      deal_id: deal.id,
      contact_id: deal.contact_id,
      title: deal.title,
      stage_id: body.stageId,
      value: deal.value,
      currency: deal.currency,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
