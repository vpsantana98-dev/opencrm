import { decrypt } from '@/lib/whatsapp/encryption';

export const META_GRAPH_VERSION = 'v25.0';
const GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

export interface MetaConnectionRow {
  agency_account_id: string;
  meta_user_id: string;
  meta_user_name: string | null;
  access_token: string;
  token_expires_at: string | null;
}

export interface MetaAdAccount {
  id: string;
  account_id: string;
  name: string;
  account_status?: number;
  business?: { id: string; name: string };
}

export interface MetaPage {
  id: string;
  name: string;
  tasks?: string[];
}

export interface MetaPixel {
  id: string;
  name: string;
}

async function graphGet<T>(
  path: string,
  token: string,
  params: Record<string, string>
): Promise<T> {
  const url = new URL(`${GRAPH_BASE}/${path}`);
  Object.entries(params).forEach(([key, value]) =>
    url.searchParams.set(key, value)
  );
  url.searchParams.set('access_token', token);
  const res = await fetch(url, { cache: 'no-store' });
  const body = (await res.json().catch(() => ({}))) as T & {
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(body.error?.message ?? `Meta respondeu HTTP ${res.status}`);
  }
  return body;
}

export function connectionToken(row: MetaConnectionRow): string {
  return decrypt(row.access_token);
}

export async function getMetaIdentity(token: string) {
  return graphGet<{ id: string; name: string }>('me', token, {
    fields: 'id,name',
  });
}

export async function getMetaAssets(token: string) {
  const [accounts, pages] = await Promise.all([
    graphGet<{ data?: MetaAdAccount[] }>('me/adaccounts', token, {
      fields: 'id,account_id,name,account_status,business{id,name}',
      limit: '200',
    }),
    graphGet<{ data?: MetaPage[] }>('me/accounts', token, {
      fields: 'id,name,tasks',
      limit: '200',
    }),
  ]);
  return { adAccounts: accounts.data ?? [], pages: pages.data ?? [] };
}

export async function getMetaPixels(token: string, adAccountId: string) {
  const normalized = adAccountId.startsWith('act_')
    ? adAccountId
    : `act_${adAccountId}`;
  const body = await graphGet<{ data?: MetaPixel[] }>(
    `${normalized}/adspixels`,
    token,
    { fields: 'id,name', limit: '200' }
  );
  return body.data ?? [];
}
