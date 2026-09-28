import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/auth/admin-client';
import { checkRateLimit } from '@/lib/rate-limit';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_KEYS = [
  'gclid',
  'gbraid',
  'wbraid',
  'fbclid',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
];

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });
}

export async function POST(request: Request) {
  const headers = { 'access-control-allow-origin': '*' };
  try {
    const forwarded = request.headers.get('x-forwarded-for');
    const ip = forwarded?.split(',')[0].trim() ||
      request.headers.get('x-real-ip')?.trim() ||
      'unknown';
    const limit = checkRateLimit(`agency-pixel:${ip}`, {
      limit: 180,
      windowMs: 60_000,
    });
    if (!limit.success) {
      return NextResponse.json({ ok: false }, { status: 429, headers });
    }
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const accountId = typeof body.clientId === 'string' ? body.clientId : '';
    if (!UUID.test(accountId)) {
      return NextResponse.json({ ok: false }, { status: 400, headers });
    }
    const admin = supabaseAdmin();
    const { data: options } = await admin
      .from('client_setup_options')
      .select('pixel_enabled')
      .eq('account_id', accountId)
      .maybeSingle();
    if (!options || options.pixel_enabled === false) {
      return NextResponse.json({ ok: true }, { headers });
    }
    const incoming =
      body.attribution && typeof body.attribution === 'object'
        ? (body.attribution as Record<string, unknown>)
        : {};
    const attribution = Object.fromEntries(
      ALLOWED_KEYS.flatMap((key) => {
        const value = incoming[key];
        return typeof value === 'string' && value.trim()
          ? [[key, value.trim().slice(0, 500)]]
          : [];
      })
    );
    const [visitResult, optionsResult] = await Promise.all([
      admin.from('agency_pixel_visits').insert({
        account_id: accountId,
        visitor_id:
          typeof body.visitorId === 'string'
            ? body.visitorId.slice(0, 100)
            : crypto.randomUUID(),
        page_url:
          typeof body.pageUrl === 'string' ? body.pageUrl.slice(0, 2000) : '',
        referrer:
          typeof body.referrer === 'string'
            ? body.referrer.slice(0, 2000)
            : null,
        attribution,
      }),
      admin
        .from('client_setup_options')
        .upsert(
          {
            account_id: accountId,
            pixel_last_seen_at: new Date().toISOString(),
          },
          { onConflict: 'account_id' }
        ),
    ]);
    if (visitResult.error || optionsResult.error) {
      throw visitResult.error ?? optionsResult.error;
    }
    return NextResponse.json({ ok: true }, { headers });
  } catch (err) {
    console.error('[pixel collect]', err);
    return NextResponse.json({ ok: false }, { status: 500, headers });
  }
}
