import type { SupabaseClient } from '@supabase/supabase-js';

import { isDeliverableUrl } from '@/lib/webhooks/ssrf';

export async function dispatchClientLeadWebhook(
  db: SupabaseClient,
  accountId: string,
  event: 'lead.created' | 'lead.updated',
  data: Record<string, unknown>
): Promise<void> {
  try {
    const { data: options } = await db
      .from('client_setup_options')
      .select('lead_created_webhook_url, lead_updated_webhook_url')
      .eq('account_id', accountId)
      .maybeSingle();
    const target =
      event === 'lead.created'
        ? options?.lead_created_webhook_url
        : options?.lead_updated_webhook_url;
    if (!target || !(await isDeliverableUrl(target))) return;
    await fetch(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event,
        occurred_at: new Date().toISOString(),
        account_id: accountId,
        data,
      }),
      redirect: 'manual',
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    console.warn('[client options webhook] delivery failed', err);
  }
}
