import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { attributeLeadToLink } from './attribution';

type Row = Record<string, unknown>;

/** Fake mínimo do SupabaseClient cobrindo só as chains usadas. */
function fakeDb(opts: {
  links?: Row[];
  click?: Row | null;
  explode?: boolean;
}) {
  const calls: { update: Row[]; rpc: [string, Row][] } = {
    update: [],
    rpc: [],
  };
  const db = {
    from(table: string) {
      if (opts.explode) throw new Error('boom');
      if (table === 'tracking_links') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ data: opts.links ?? [], error: null }),
            }),
          }),
        };
      }
      if (table === 'link_clicks') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: opts.click ?? null, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'contacts') {
        return {
          update: (values: Row) => {
            calls.update.push(values);
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      }
      throw new Error(`tabela inesperada: ${table}`);
    },
    rpc(name: string, args: Row) {
      calls.rpc.push([name, args]);
      return Promise.resolve({ error: null });
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

const LINK = {
  id: 'link-1',
  message: 'Olá! Vi seu anúncio e gostaria de saber mais...',
  utm_source: 'instagram',
  utm_medium: null,
  utm_campaign: null,
  utm_term: null,
  utm_content: null,
};

describe('attributeLeadToLink', () => {
  it('atribui contato novo com UTMs do último clique', async () => {
    const { db, calls } = fakeDb({
      links: [LINK],
      click: { utm_source: 'googleads', utm_campaign: 'promo' },
    });
    await attributeLeadToLink(db, 'acc-1', 'contact-1', LINK.message, true);
    expect(calls.update).toEqual([
      expect.objectContaining({
        source_link_id: 'link-1',
        source_utm: { utm_source: 'googleads', utm_campaign: 'promo' },
      }),
    ]);
    expect(calls.rpc).toEqual([
      ['increment_link_conversations', { p_link_id: 'link-1' }],
    ]);
  });

  it('cai nos UTMs padrão do link quando o clique não trouxe UTM', async () => {
    const { db, calls } = fakeDb({ links: [LINK], click: { utm_source: null } });
    await attributeLeadToLink(db, 'acc-1', 'contact-1', LINK.message, true);
    expect(calls.update[0]).toEqual(
      expect.objectContaining({ source_utm: { utm_source: 'instagram' } })
    );
  });

  it('normaliza espaços e maiúsculas no matching', async () => {
    const { db, calls } = fakeDb({ links: [LINK], click: null });
    await attributeLeadToLink(
      db,
      'acc-1',
      'contact-1',
      '  olá! vi seu ANÚNCIO e gostaria de saber mais...  ',
      true
    );
    expect(calls.update).toHaveLength(1);
  });

  it('não faz nada para contato já existente', async () => {
    const { db, calls } = fakeDb({ links: [LINK] });
    await attributeLeadToLink(db, 'acc-1', 'contact-1', LINK.message, false);
    expect(calls.update).toHaveLength(0);
    expect(calls.rpc).toHaveLength(0);
  });

  it('não faz nada quando o texto não casa com nenhum link', async () => {
    const { db, calls } = fakeDb({ links: [LINK] });
    await attributeLeadToLink(db, 'acc-1', 'contact-1', 'oi, tudo bem?', true);
    expect(calls.update).toHaveLength(0);
    expect(calls.rpc).toHaveLength(0);
  });

  it('nunca lança, mesmo com o banco explodindo', async () => {
    const { db } = fakeDb({ explode: true });
    await expect(
      attributeLeadToLink(db, 'acc-1', 'contact-1', 'qualquer', true)
    ).resolves.toBeUndefined();
  });
});
