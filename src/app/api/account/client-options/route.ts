import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { normalizeWebhookUrl } from '@/lib/webhooks/endpoints';

const DEFAULT_MESSAGE = 'Olá, gostaria de mais informações';

export async function GET() {
  try {
    const ctx = await requireRole('admin');
    const [{ data: options }, { data: meta }] = await Promise.all([
      ctx.supabase
        .from('client_setup_options')
        .select(
          'default_message, lead_created_webhook_url, lead_updated_webhook_url, webhook_stage_changes_only, portal_enabled, pixel_enabled, pixel_site_url, pixel_last_seen_at, pixel_verified_at'
        )
        .eq('account_id', ctx.accountId)
        .maybeSingle(),
      ctx.supabase
        .from('meta_ads_config')
        .select('action_source')
        .eq('account_id', ctx.accountId)
        .maybeSingle(),
    ]);
    return NextResponse.json({
      options: {
        default_message: options?.default_message ?? DEFAULT_MESSAGE,
        lead_created_webhook_url: options?.lead_created_webhook_url ?? '',
        lead_updated_webhook_url: options?.lead_updated_webhook_url ?? '',
        webhook_stage_changes_only:
          options?.webhook_stage_changes_only ?? false,
        portal_enabled: options?.portal_enabled ?? false,
        pixel_enabled: options?.pixel_enabled ?? true,
        pixel_site_url: options?.pixel_site_url ?? '',
        pixel_last_seen_at: options?.pixel_last_seen_at ?? null,
        pixel_verified_at: options?.pixel_verified_at ?? null,
        action_source: meta?.action_source ?? 'business_messaging',
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
    const [{ data: currentOptions }, { data: currentMeta }] = await Promise.all([
      ctx.supabase
        .from('client_setup_options')
        .select(
          'default_message, lead_created_webhook_url, lead_updated_webhook_url, webhook_stage_changes_only, portal_enabled, pixel_enabled, pixel_site_url'
        )
        .eq('account_id', ctx.accountId)
        .maybeSingle(),
      ctx.supabase
        .from('meta_ads_config')
        .select('action_source')
        .eq('account_id', ctx.accountId)
        .maybeSingle(),
    ]);
    const normalizeOptionalWebhook = (value: unknown) => {
      if (typeof value !== 'string' || !value.trim()) return null;
      return normalizeWebhookUrl(value);
    };
    const leadCreated = has('lead_created_webhook_url')
      ? normalizeOptionalWebhook(body.lead_created_webhook_url)
      : currentOptions?.lead_created_webhook_url ?? null;
    const leadUpdated = has('lead_updated_webhook_url')
      ? normalizeOptionalWebhook(body.lead_updated_webhook_url)
      : currentOptions?.lead_updated_webhook_url ?? null;
    if (
      (has('lead_created_webhook_url') &&
        typeof body.lead_created_webhook_url === 'string' &&
        body.lead_created_webhook_url.trim() &&
        !leadCreated) ||
      (has('lead_updated_webhook_url') &&
        typeof body.lead_updated_webhook_url === 'string' &&
        body.lead_updated_webhook_url.trim() &&
        !leadUpdated)
    ) {
      return NextResponse.json(
        { error: 'Os webhooks precisam usar uma URL HTTPS válida' },
        { status: 400 }
      );
    }
    let pixelSiteUrl: string | null = currentOptions?.pixel_site_url ?? null;
    if (has('pixel_site_url') && !body.pixel_site_url) {
      pixelSiteUrl = null;
    } else if (
      has('pixel_site_url') &&
      typeof body.pixel_site_url === 'string' &&
      body.pixel_site_url.trim()
    ) {
      try {
        const parsed = new URL(body.pixel_site_url.trim());
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
        pixelSiteUrl = parsed.toString();
      } catch {
        return NextResponse.json(
          { error: 'Informe uma URL válida para o site do cliente' },
          { status: 400 }
        );
      }
    }
    const defaultMessage =
      has('default_message') && typeof body.default_message === 'string'
        ? body.default_message.trim().slice(0, 1000)
        : currentOptions?.default_message ?? DEFAULT_MESSAGE;
    const actionSource = has('action_source')
      ? body.action_source === 'website'
        ? 'website'
        : 'business_messaging'
      : currentMeta?.action_source ?? 'business_messaging';

    const [{ error: optionsError }, { error: metaError }] = await Promise.all([
      ctx.supabase.from('client_setup_options').upsert(
        {
          account_id: ctx.accountId,
          default_message: defaultMessage || DEFAULT_MESSAGE,
          lead_created_webhook_url: leadCreated,
          lead_updated_webhook_url: leadUpdated,
          webhook_stage_changes_only: has('webhook_stage_changes_only')
            ? body.webhook_stage_changes_only === true
            : currentOptions?.webhook_stage_changes_only ?? false,
          portal_enabled: has('portal_enabled')
            ? body.portal_enabled === true
            : currentOptions?.portal_enabled ?? false,
          pixel_enabled: has('pixel_enabled')
            ? body.pixel_enabled !== false
            : currentOptions?.pixel_enabled ?? true,
          pixel_site_url: pixelSiteUrl,
        },
        { onConflict: 'account_id' }
      ),
      ctx.supabase
        .from('meta_ads_config')
        .upsert(
          { account_id: ctx.accountId, action_source: actionSource },
          { onConflict: 'account_id' }
        ),
    ]);
    if (optionsError || metaError) throw optionsError ?? metaError;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
