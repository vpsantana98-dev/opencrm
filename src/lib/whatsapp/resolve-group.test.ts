import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveGroupConversation } from './resolve-group';

// ------------------------------------------------------------
// Chainable Supabase stub, scripted per table — same shape as
// resolve-conversation.test.ts. Terminal methods (maybeSingle/single)
// resolve to configured data; the builder itself is thenable so an
// awaited `update().eq()` resolves cleanly.
// ------------------------------------------------------------
interface GroupContactRow {
  id: string;
  name: string | null;
}

interface Script {
  config?: { user_id: string } | null; // whatsapp_config.maybeSingle (resolveAuditUserId)
  account?: { owner_user_id: string } | null; // accounts.maybeSingle (resolveAuditUserId fallback)
  /** Per-call result for contacts .select().maybeSingle() (findGroupContact). */
  contactLookups?: (GroupContactRow | null)[];
  insertedContactId?: string;
  insertContactError?: { code?: string } | null;
  existingConversation?: { id: string } | null;
  insertedConversationId?: string;
}

function makeDb(script: Script) {
  let table = '';
  let mode: 'select' | 'insert' | 'update' = 'select';
  let contactLookupCalls = 0;
  const updateCalls: { table: string; values: Record<string, unknown> }[] = [];

  const builder: Record<string, unknown> = {
    select: () => builder,
    insert: () => {
      mode = 'insert';
      return builder;
    },
    update: (values: Record<string, unknown>) => {
      mode = 'update';
      updateCalls.push({ table, values });
      return builder;
    },
    eq: () => builder,
    maybeSingle: () => {
      if (table === 'whatsapp_config')
        return Promise.resolve({ data: script.config ?? null, error: null });
      if (table === 'accounts')
        return Promise.resolve({ data: script.account ?? null, error: null });
      if (table === 'contacts' && mode === 'select') {
        const result = script.contactLookups?.[contactLookupCalls] ?? null;
        contactLookupCalls++;
        return Promise.resolve({ data: result, error: null });
      }
      if (table === 'conversations' && mode === 'select')
        return Promise.resolve({
          data: script.existingConversation ?? null,
          error: null,
        });
      return Promise.resolve({ data: null, error: null });
    },
    single: () => {
      if (table === 'contacts' && mode === 'insert') {
        if (script.insertContactError)
          return Promise.resolve({
            data: null,
            error: script.insertContactError,
          });
        return Promise.resolve({
          data: { id: script.insertedContactId },
          error: null,
        });
      }
      if (table === 'conversations' && mode === 'insert')
        return Promise.resolve({
          data: { id: script.insertedConversationId },
          error: null,
        });
      return Promise.resolve({ data: null, error: null });
    },
    // Thenable: `await db.from().update().eq()` lands here.
    then: (resolve: (v: { data: null; error: null }) => void) =>
      resolve({ data: null, error: null }),
  };

  const db = {
    from: (t: string) => {
      table = t;
      mode = 'select';
      return builder;
    },
  } as unknown as SupabaseClient;

  return { db, updateCalls };
}

describe('resolveGroupConversation', () => {
  it('cria contato-grupo + conversa quando o grupo é novo', async () => {
    const { db } = makeDb({
      config: { user_id: 'owner-1' },
      contactLookups: [null],
      insertedContactId: 'grp-1',
      existingConversation: null,
      insertedConversationId: 'cv-1',
    });

    const res = await resolveGroupConversation(db, 'acct', '123456@g.us', {
      subjectIfNew: async () => 'Time de Vendas',
    });

    expect(res).toEqual({
      conversationId: 'cv-1',
      contactId: 'grp-1',
      contactCreated: true,
    });
  });

  it('reusa o contato-grupo já existente sem criar de novo', async () => {
    const { db } = makeDb({
      config: { user_id: 'owner-1' },
      contactLookups: [{ id: 'grp-2', name: 'Time de Vendas' }],
      existingConversation: { id: 'cv-2' },
    });

    const res = await resolveGroupConversation(db, 'acct', '123456@g.us');

    expect(res).toEqual({
      conversationId: 'cv-2',
      contactId: 'grp-2',
      contactCreated: false,
    });
  });

  it('re-resolve pelo jid quando a criação perde uma corrida (unique violation)', async () => {
    const { db } = makeDb({
      config: { user_id: 'owner-1' },
      // 1ª busca: não achou -> tenta criar -> corrida -> 2ª busca acha.
      contactLookups: [null, { id: 'grp-raced', name: 'Grupo 654321' }],
      insertContactError: { code: '23505' },
      existingConversation: { id: 'cv-raced' },
    });

    const res = await resolveGroupConversation(db, 'acct', '654321@g.us', {
      subjectIfNew: async () => null,
    });

    expect(res).toEqual({
      conversationId: 'cv-raced',
      contactId: 'grp-raced',
      contactCreated: false,
    });
  });

  it('atualiza o nome quando o contato existente ainda tem o nome provisório', async () => {
    const { db, updateCalls } = makeDb({
      config: { user_id: 'owner-1' },
      contactLookups: [{ id: 'grp-3', name: 'Grupo 999999' }],
      existingConversation: { id: 'cv-3' },
    });

    const res = await resolveGroupConversation(db, 'acct', '999999@g.us', {
      subjectIfNew: async () => 'Suporte acme',
    });

    expect(res.contactId).toBe('grp-3');
    expect(updateCalls).toContainEqual({
      table: 'contacts',
      values: { name: 'Suporte acme' },
    });
  });

  it('não busca o nome de novo quando o contato já tem nome definitivo', async () => {
    let subjectCalls = 0;
    const { db, updateCalls } = makeDb({
      config: { user_id: 'owner-1' },
      contactLookups: [{ id: 'grp-4', name: 'Suporte acme' }],
      existingConversation: { id: 'cv-4' },
    });

    await resolveGroupConversation(db, 'acct', '111111@g.us', {
      subjectIfNew: async () => {
        subjectCalls++;
        return 'Outro nome';
      },
    });

    expect(subjectCalls).toBe(0);
    expect(updateCalls).toEqual([]);
  });
});
