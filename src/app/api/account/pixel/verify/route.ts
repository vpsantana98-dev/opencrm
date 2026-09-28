import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { isDeliverableUrl } from '@/lib/webhooks/ssrf';

export async function POST() {
  try {
    const ctx = await requireRole('admin');
    const { data: config } = await ctx.supabase
      .from('client_setup_options')
      .select('pixel_site_url, pixel_last_seen_at')
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!config?.pixel_site_url) {
      return NextResponse.json(
        { error: 'Salve primeiro a URL do site do cliente' },
        { status: 400 }
      );
    }

    let verified =
      Boolean(config.pixel_last_seen_at) &&
      Date.now() - new Date(config.pixel_last_seen_at).getTime() < 15 * 60_000;
    if (!verified && (await isDeliverableUrl(config.pixel_site_url))) {
      const res = await fetch(config.pixel_site_url, {
        cache: 'no-store',
        redirect: 'manual',
        signal: AbortSignal.timeout(7_000),
      });
      const html = res.ok ? await res.text() : '';
      verified =
        html.includes('/pixel.js') &&
        html.includes(`data-client-id="${ctx.accountId}"`);
    }
    if (!verified) {
      return NextResponse.json(
        {
          verified: false,
          error:
            'O Pixel OpenCRM ainda não foi encontrado. Publique o site e abra uma página antes de verificar novamente.',
        },
        { status: 200 }
      );
    }
    await ctx.supabase
      .from('client_setup_options')
      .update({ pixel_verified_at: new Date().toISOString() })
      .eq('account_id', ctx.accountId);
    return NextResponse.json({ verified: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
