import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { ehPlaceholder, resolveConversationByPhone } from './resolve-conversation';
import { SendMessageError } from './send-message';

// ------------------------------------------------------------
// Chainable Supabase stub, scripted per table. Terminal methods
// (like/maybeSingle/single) resolve to configured data; the builder
// itself is thenable so an awaited `update().eq()` resolves cleanly.
// ------------------------------------------------------------
type ContactRow = { id: string; phone: string; name?: string | null };

interface Script {
  config?: { user_id: string } | null; // whatsapp_config.maybeSingle
  contactCandidates?: ContactRow[]; // contacts .like (same every call)
  /** Per-call `.like` results — overrides contactCandidates. Lets a
   *  test simulate "miss, then hit" for the unique-race path. */
  contactCandidatesByCall?: ContactRow[][];
  insertedContactId?: string; // contacts insert -> single
  insertContactError?: { code?: string } | null;
  existingConversation?: { id: string } | null; // conversations select.maybeSingle
  insertedConversationId?: string; // conversations insert -> single
}

function makeDb(script: Script): SupabaseClient {
  let table = '';
  let mode: 'select' | 'insert' | 'update' = 'select';
  let likeCalls = 0;

  const builder: Record<string, unknown> = {
    select: () => builder,
    insert: () => {
      mode = 'insert';
      return builder;
    },
    update: () => {
      mode = 'update';
      return builder;
    },
    eq: () => builder,
    // `.limit()` é terminal aqui: a checagem "a conta tem algum número?"
    // deixou de usar `.maybeSingle()` porque agora uma conta pode ter
    // VÁRIOS, e o maybeSingle erra com mais de uma linha. Devolve lista.
    limit: () => Promise.resolve({ data: [], error: null }),
    like: () => {
      const data = script.contactCandidatesByCall
        ? (script.contactCandidatesByCall[likeCalls] ?? [])
        : (script.contactCandidates ?? []);
      likeCalls++;
      return Promise.resolve({ data, error: null });
    },
    maybeSingle: () => {
      if (table === 'whatsapp_config')
        return Promise.resolve({ data: script.config ?? null, error: null });
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

  return {
    from: (t: string) => {
      table = t;
      mode = 'select';
      return builder;
    },
  } as unknown as SupabaseClient;
}

describe('resolveConversationByPhone', () => {
  it('rejects an invalid phone before any DB call', async () => {
    const db = {
      from() {
        throw new Error('should not query');
      },
    } as unknown as SupabaseClient;
    await expect(
      resolveConversationByPhone(db, 'acct', 'not-a-phone')
    ).rejects.toBeInstanceOf(SendMessageError);
  });

  it('fails with whatsapp_not_configured when no config owner exists', async () => {
    const db = makeDb({ config: null });
    await resolveConversationByPhone(db, 'acct', '+14155550123').catch(
      (e: SendMessageError) => {
        expect(e.code).toBe('whatsapp_not_configured');
        expect(e.status).toBe(400);
      }
    );
    await expect(
      resolveConversationByPhone(db, 'acct', '+14155550123')
    ).rejects.toBeInstanceOf(SendMessageError);
  });

  it('returns the existing contact + conversation without creating', async () => {
    const db = makeDb({
      config: { user_id: 'owner-1' },
      contactCandidates: [{ id: 'c1', phone: '14155550123' }],
      existingConversation: { id: 'cv1' },
    });
    const res = await resolveConversationByPhone(
      db,
      'acct',
      '+1 (415) 555-0123'
    );
    expect(res).toEqual({
      conversationId: 'cv1',
      contactId: 'c1',
      contactCreated: false,
    });
  });

  it('creates contact + conversation when none exist', async () => {
    const db = makeDb({
      config: { user_id: 'owner-1' },
      contactCandidates: [],
      insertedContactId: 'c2',
      existingConversation: null,
      insertedConversationId: 'cv2',
    });
    const res = await resolveConversationByPhone(
      db,
      'acct',
      '+14155550199',
      'Jane'
    );
    expect(res).toEqual({
      conversationId: 'cv2',
      contactId: 'c2',
      contactCreated: true,
    });
  });

  it('re-resolves an existing contact when the insert loses a unique race', async () => {
    // First lookup misses (→ we attempt an insert), the insert hits a
    // 23505 unique violation, and the post-race re-lookup now returns
    // the row a concurrent writer created.
    const db = makeDb({
      config: { user_id: 'owner-1' },
      contactCandidatesByCall: [[], [{ id: 'c-raced', phone: '14155550123' }]],
      insertContactError: { code: '23505' },
      existingConversation: { id: 'cv-raced' },
    });
    const res = await resolveConversationByPhone(db, 'acct', '+14155550123');
    expect(res.contactId).toBe('c-raced');
    expect(res.contactCreated).toBe(false);
    expect(res.conversationId).toBe('cv-raced');
  });
});

// ---------------------------------------------------------------------------
// Regressão de produção: o nome do contato era sobrescrito a cada mensagem
// recebida. Como `pushName` é o nome que a PESSOA escolheu para si, o nome
// dado no CRM sumia sozinho — um contato salvo como "Vinícius" virou
// "Psicóloga Sarah Vitoria" entre um print e o outro.
//
// A regra agora: só preenche enquanto for placeholder (o próprio telefone).
// ---------------------------------------------------------------------------
describe("ehPlaceholder", () => {
  it("nome vazio ou ausente e placeholder", () => {
    expect(ehPlaceholder(null, "5531999998888")).toBe(true);
    expect(ehPlaceholder("", "5531999998888")).toBe(true);
    expect(ehPlaceholder("   ", "5531999998888")).toBe(true);
  });

  it("nome igual ao telefone e placeholder", () => {
    expect(ehPlaceholder("5531999998888", "5531999998888")).toBe(true);
  });

  it("telefone formatado tambem conta como placeholder", () => {
    // Versoes antigas gravavam com mascara; comparar so digitos evita
    // tratar um placeholder como nome escolhido pelo usuario.
    expect(ehPlaceholder("+55 (31) 99999-8888", "5531999998888")).toBe(true);
  });

  it("nome de verdade NAO e placeholder", () => {
    expect(ehPlaceholder("Vinícius", "5531999998888")).toBe(false);
    expect(ehPlaceholder("Psicóloga Sarah Vitoria", "5531999998888")).toBe(false);
  });

  it("nome com numeros que NAO sao o telefone e nome de verdade", () => {
    // "Loja 24h" tem digitos, mas nao e o telefone.
    expect(ehPlaceholder("Loja 24h", "5531999998888")).toBe(false);
  });

  it("outro telefone qualquer nao e placeholder deste contato", () => {
    expect(ehPlaceholder("5511888887777", "5531999998888")).toBe(false);
  });
});
