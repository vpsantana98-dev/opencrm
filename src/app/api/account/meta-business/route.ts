import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/auth/admin-client';
import { encrypt } from '@/lib/whatsapp/encryption';
import { getAgencyContext } from '@/lib/meta-business/context';
import {
  connectionToken,
  getMetaAssets,
  getMetaPixels,
  type MetaConnectionRow,
} from '@/lib/meta-business/client';

async function loadConnection(agencyAccountId: string) {
  const { data } = await supabaseAdmin()
    .from('meta_agency_connections')
    .select(
      'agency_account_id, meta_user_id, meta_user_name, access_token, token_expires_at'
    )
    .eq('agency_account_id', agencyAccountId)
    .maybeSingle();
  return data as MetaConnectionRow | null;
}

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const agency = await getAgencyContext(ctx);
    const connection = await loadConnection(agency.agencyAccountId);
    const { data: config } = await supabaseAdmin()
      .from('meta_ads_config')
      .select('ad_account_id, ad_account_name, page_ids, pixel_id, pixel_name')
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    const configured = Boolean(
      process.env.META_APP_ID &&
      process.env.META_APP_SECRET &&
      process.env.NEXT_PUBLIC_SITE_URL
    );
    if (!connection) {
      return NextResponse.json({ configured, connected: false, config });
    }

    const token = connectionToken(connection);
    const assets = await getMetaAssets(token);
    const requestedAdAccount = new URL(request.url).searchParams.get(
      'adAccountId'
    );
    const adAccountId = requestedAdAccount ?? config?.ad_account_id ?? null;
    const allowed = adAccountId
      ? assets.adAccounts.some(
          (item) => item.id === adAccountId || item.account_id === adAccountId
        )
      : false;
    const pixels = allowed ? await getMetaPixels(token, adAccountId!) : [];

    return NextResponse.json({
      configured,
      connected: true,
      user: {
        id: connection.meta_user_id,
        name: connection.meta_user_name,
        expiresAt: connection.token_expires_at,
      },
      ...assets,
      pixels,
      config: config ?? null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const agency = await getAgencyContext(ctx);
    const connection = await loadConnection(agency.agencyAccountId);
    if (!connection) {
      return NextResponse.json(
        { error: 'Conecte a conta Meta da agência primeiro' },
        { status: 400 }
      );
    }
    const body = (await request.json().catch(() => ({}))) as {
      adAccountId?: string;
      adAccountName?: string;
      pageIds?: string[];
      pixelId?: string;
      pixelName?: string;
    };
    const token = connectionToken(connection);
    const assets = await getMetaAssets(token);
    const account = assets.adAccounts.find(
      (item) =>
        item.id === body.adAccountId || item.account_id === body.adAccountId
    );
    if (!account) {
      return NextResponse.json(
        { error: 'Conta de anúncio não está disponível para este operador' },
        { status: 400 }
      );
    }
    const pageIds = Array.isArray(body.pageIds)
      ? body.pageIds.filter((id) => assets.pages.some((page) => page.id === id))
      : [];
    const pixels = await getMetaPixels(token, account.id);
    const pixel = pixels.find((item) => item.id === body.pixelId);
    if (!pixel) {
      return NextResponse.json(
        { error: 'Selecione um pixel disponível nessa conta de anúncio' },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin()
      .from('meta_ads_config')
      .upsert(
        {
          account_id: ctx.accountId,
          agency_account_id: agency.agencyAccountId,
          ad_account_id: account.account_id,
          ad_account_name: account.name,
          page_ids: pageIds,
          pixel_id: pixel.id,
          pixel_name: pixel.name,
          capi_token: encrypt(token),
        },
        { onConflict: 'account_id' }
      );
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE() {
  try {
    const ctx = await requireRole('admin');
    const agency = await getAgencyContext(ctx);
    if (ctx.userId !== agency.agencyOwnerId) {
      return NextResponse.json(
        { error: 'Somente o operador principal pode desconectar a Meta' },
        { status: 403 }
      );
    }
    await supabaseAdmin()
      .from('meta_agency_connections')
      .delete()
      .eq('agency_account_id', agency.agencyAccountId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
