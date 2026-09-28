import { cookies } from 'next/headers';

import { getCurrentAccount } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/auth/admin-client';
import { encrypt } from '@/lib/whatsapp/encryption';
import { getAgencyContext } from '@/lib/meta-business/context';
import {
  getMetaIdentity,
  META_GRAPH_VERSION,
} from '@/lib/meta-business/client';

const STATE_COOKIE = 'fz_meta_oauth_state';

function popupResponse(ok: boolean, message: string, status = 200) {
  const payload = JSON.stringify({
    type: 'fz-meta-oauth',
    ok,
    message,
  }).replace(/</g, '\\u003c');
  return new Response(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Meta Ads</title></head><body><p>${ok ? 'Conta conectada. Esta janela pode ser fechada.' : 'Não foi possível conectar a conta.'}</p><script>window.opener?.postMessage(${payload}, window.location.origin);window.close();</script></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const expected = cookieStore.get(STATE_COOKIE)?.value;
    cookieStore.delete(STATE_COOKIE);
    if (!code || !state || !expected || state !== expected) {
      return popupResponse(false, 'Estado OAuth inválido', 400);
    }

    const appId = process.env.META_APP_ID?.trim();
    const appSecret = process.env.META_APP_SECRET?.trim();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '');
    if (!appId || !appSecret || !siteUrl) {
      return popupResponse(false, 'OAuth da Meta não configurado', 503);
    }

    const ctx = await getCurrentAccount();
    const agency = await getAgencyContext(ctx);
    const redirectUri = `${siteUrl}/api/account/meta-business/oauth/callback`;
    const exchange = new URL(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`
    );
    exchange.searchParams.set('client_id', appId);
    exchange.searchParams.set('client_secret', appSecret);
    exchange.searchParams.set('redirect_uri', redirectUri);
    exchange.searchParams.set('code', code);
    const exchangeRes = await fetch(exchange, { cache: 'no-store' });
    const exchangeBody = (await exchangeRes.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: { message?: string };
    };
    if (!exchangeRes.ok || !exchangeBody.access_token) {
      return popupResponse(
        false,
        exchangeBody.error?.message ?? 'A Meta recusou a conexão',
        400
      );
    }

    const longLived = new URL(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`
    );
    longLived.searchParams.set('grant_type', 'fb_exchange_token');
    longLived.searchParams.set('client_id', appId);
    longLived.searchParams.set('client_secret', appSecret);
    longLived.searchParams.set('fb_exchange_token', exchangeBody.access_token);
    const longRes = await fetch(longLived, { cache: 'no-store' });
    const longBody = (await longRes.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
    };
    const token = longBody.access_token ?? exchangeBody.access_token;
    const expiresIn = longBody.expires_in ?? exchangeBody.expires_in;
    const identity = await getMetaIdentity(token);

    const { error } = await supabaseAdmin()
      .from('meta_agency_connections')
      .upsert(
        {
          agency_account_id: agency.agencyAccountId,
          connected_by: ctx.userId,
          meta_user_id: identity.id,
          meta_user_name: identity.name,
          access_token: encrypt(token),
          token_expires_at: expiresIn
            ? new Date(Date.now() + expiresIn * 1000).toISOString()
            : null,
          scopes: [
            'ads_management',
            'ads_read',
            'business_management',
            'pages_show_list',
            'pages_read_engagement',
          ],
        },
        { onConflict: 'agency_account_id' }
      );
    if (error) throw error;
    return popupResponse(true, 'Conta Meta conectada');
  } catch (err) {
    console.error('[meta-business oauth callback]', err);
    return popupResponse(false, 'Não foi possível concluir a conexão', 500);
  }
}
