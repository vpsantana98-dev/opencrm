import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { getAgencyContext } from '@/lib/meta-business/context';
import { META_GRAPH_VERSION } from '@/lib/meta-business/client';

const STATE_COOKIE = 'fz_meta_oauth_state';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    await getAgencyContext(ctx);
    const appId = process.env.META_APP_ID?.trim();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '');
    if (!appId || !process.env.META_APP_SECRET || !siteUrl) {
      return NextResponse.json(
        { error: 'OAuth da Meta não configurado no servidor' },
        { status: 503 }
      );
    }

    const state = crypto.randomBytes(32).toString('base64url');
    const cookieStore = await cookies();
    cookieStore.set(STATE_COOKIE, state, {
      httpOnly: true,
      secure: siteUrl.startsWith('https://'),
      sameSite: 'lax',
      path: '/api/account/meta-business/oauth',
      maxAge: 600,
    });

    const redirectUri = `${siteUrl}/api/account/meta-business/oauth/callback`;
    const authUrl = new URL(
      `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`
    );
    authUrl.searchParams.set('client_id', appId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set(
      'scope',
      'ads_management,ads_read,business_management,pages_show_list,pages_read_engagement'
    );

    return NextResponse.redirect(authUrl);
  } catch (err) {
    return toErrorResponse(err);
  }
}
