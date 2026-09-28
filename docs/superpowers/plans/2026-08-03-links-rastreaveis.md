# Links Rastreáveis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Links curtos públicos `/t/<código>` que redirecionam para o WhatsApp com mensagem pré-preenchida, capturando UTMs do clique, contando cliques e atribuindo conversas geradas ao link pela mensagem-assinatura. Página de gestão com cards + tabela + modal, no estilo Trizup.

**Spec:** `docs/superpowers/specs/2026-08-03-links-rastreaveis-design.md` (ler antes de começar).

**Architecture:** Tabelas `tracking_links` + `link_clicks` (migration 041) com RPCs atômicas para incremento; rota pública GET `/t/[code]` (service role) que registra o clique e redireciona para `wa.me`; helper de atribuição chamado nos webhooks Evolution e Meta quando um contato NOVO chega com o texto da mensagem-assinatura; página client-side no padrão broadcasts (supabase client + RLS).

**Tech Stack:** Next.js 16.2.6 App Router, React 19, Supabase (RLS + RPC plpgsql), shadcn/ui, Vitest.

## Global Constraints

- **Next.js 16.2.6 tem breaking changes** (AGENTS.md): docs canônicas em `node_modules/next/dist/docs/`. Em route handlers, `params` é `Promise` e precisa de `await` (padrão já usado em `src/app/api/whatsapp/evolution/webhook/[secret]/route.ts:44-59`).
- **Strings visíveis ao usuário em PT-BR, SEM travessão (—)**: use dois-pontos, vírgula ou parênteses.
- **Migrations**: arquivo idempotente (`IF NOT EXISTS` / `DROP ... IF EXISTS`), aplicado manualmente via `psql` no container do Postgres da VPS, cada arquivo em transação única (`-1`). Não há banco local: o dev roda contra o Supabase da VPS, então **aplicar a migration é pré-requisito para testar de verdade** (ver `docs/infra.md`).
- **Commits**: mensagem em PT-BR no padrão `feat:`/`docs:`, terminando com `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Gates finais**: `npm run typecheck`, `npm test` (baseline: 5 falhas pré-existentes de locale/timezone da máquina não contam), `npm run build`.
- Branch de trabalho: `feat/links-rastreaveis` (já criada, spec commitado). NÃO commitar os arquivos WIP alheios: `src/components/settings/whatsapp-config.tsx` e `docs/superpowers/specs/2026-07-31-whatsapp-config-recolhivel-design.md` aparecem modificados na árvore e são de outra feature. Use sempre `git add <caminhos específicos>`.

---

### Task 1: Migration 041 (tabelas, RLS, RPCs, colunas do contato)

**Files:**
- Create: `supabase/migrations/041_tracking_links.sql`

**Interfaces:**
- Produces: tabelas `tracking_links` e `link_clicks`; colunas `contacts.source_link_id` e `contacts.source_utm`; RPC `register_link_click(p_code TEXT, p_utm JSONB) RETURNS TABLE(phone TEXT, message TEXT)`; RPC `increment_link_conversations(p_link_id UUID) RETURNS VOID`.

- [ ] **Step 1: Escrever a migration**

```sql
-- ============================================================
-- 041_tracking_links.sql — Links Rastreáveis (estilo Trizup)
--
-- Links curtos públicos /t/<code> que redirecionam para o WhatsApp
-- com mensagem pré-preenchida. Um clique = um registro em link_clicks
-- (com os UTMs capturados da URL) + incremento do agregado no link.
-- A "mensagem padrão" é a assinatura de atribuição: a primeira
-- mensagem de um contato NOVO que casar com ela atribui a conversa ao
-- link (contacts.source_link_id + snapshot contacts.source_utm).
--
-- Escrita de link_clicks e as RPCs são só do servidor (service role);
-- usuários apenas leem. Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS tracking_links (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  code                TEXT NOT NULL UNIQUE,
  phone               TEXT NOT NULL,
  message             TEXT NOT NULL,
  utm_source          TEXT,
  utm_medium          TEXT,
  utm_campaign        TEXT,
  utm_term            TEXT,
  utm_content         TEXT,
  active              BOOLEAN NOT NULL DEFAULT true,
  clicks_count        INTEGER NOT NULL DEFAULT 0,
  conversations_count INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at ON tracking_links;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON tracking_links
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_tracking_links_account
  ON tracking_links(account_id);

-- A assinatura de atribuição nunca pode ser ambígua entre links ATIVOS
-- da mesma conta (o matching da atribuição usa lower(trim())).
CREATE UNIQUE INDEX IF NOT EXISTS uq_tracking_links_active_message
  ON tracking_links (account_id, lower(trim(message))) WHERE active;

ALTER TABLE tracking_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tracking_links_select ON tracking_links;
CREATE POLICY tracking_links_select ON tracking_links FOR SELECT
  USING (in_active_account(account_id));

DROP POLICY IF EXISTS tracking_links_insert ON tracking_links;
CREATE POLICY tracking_links_insert ON tracking_links FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS tracking_links_update ON tracking_links;
CREATE POLICY tracking_links_update ON tracking_links FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS tracking_links_delete ON tracking_links;
CREATE POLICY tracking_links_delete ON tracking_links FOR DELETE
  USING (is_account_member(account_id, 'agent'));

-- Um registro por clique, com os UTMs da URL do clique (quando vieram).
CREATE TABLE IF NOT EXISTS link_clicks (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  link_id      UUID NOT NULL REFERENCES tracking_links(id) ON DELETE CASCADE,
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  utm_source   TEXT,
  utm_medium   TEXT,
  utm_campaign TEXT,
  utm_term     TEXT,
  utm_content  TEXT,
  clicked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- "Último clique" da atribuição e base do gráfico da fase 2.
CREATE INDEX IF NOT EXISTS idx_link_clicks_link_time
  ON link_clicks(link_id, clicked_at DESC);

ALTER TABLE link_clicks ENABLE ROW LEVEL SECURITY;

-- Só leitura para usuários; INSERT é exclusivo do service role (a RPC
-- abaixo), então NÃO há policy de INSERT/UPDATE/DELETE de propósito.
DROP POLICY IF EXISTS link_clicks_select ON link_clicks;
CREATE POLICY link_clicks_select ON link_clicks FOR SELECT
  USING (in_active_account(account_id));

-- Origem do lead no contato. O snapshot source_utm sobrevive à
-- exclusão do link e a qualquer limpeza futura de link_clicks.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS
  source_link_id UUID REFERENCES tracking_links(id) ON DELETE SET NULL;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS source_utm JSONB;
CREATE INDEX IF NOT EXISTS idx_contacts_source_link
  ON contacts(source_link_id);

-- Registra um clique: valida código+ativo, insere o clique com os UTMs
-- sanitizados (só os 5 utm_* conhecidos chegam aqui; trunca em 255) e
-- incrementa o agregado, tudo numa ida. Retorna vazio se não achou.
CREATE OR REPLACE FUNCTION public.register_link_click(
  p_code TEXT,
  p_utm  JSONB DEFAULT NULL
) RETURNS TABLE(phone TEXT, message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link tracking_links%ROWTYPE;
BEGIN
  SELECT * INTO v_link
    FROM tracking_links t
   WHERE t.code = p_code AND t.active;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  INSERT INTO link_clicks
    (link_id, account_id, utm_source, utm_medium, utm_campaign, utm_term, utm_content)
  VALUES (
    v_link.id,
    v_link.account_id,
    NULLIF(left(trim(p_utm->>'utm_source'),   255), ''),
    NULLIF(left(trim(p_utm->>'utm_medium'),   255), ''),
    NULLIF(left(trim(p_utm->>'utm_campaign'), 255), ''),
    NULLIF(left(trim(p_utm->>'utm_term'),     255), ''),
    NULLIF(left(trim(p_utm->>'utm_content'),  255), '')
  );

  UPDATE tracking_links SET clicks_count = clicks_count + 1
   WHERE id = v_link.id;

  RETURN QUERY SELECT v_link.phone, v_link.message;
END;
$$;

ALTER FUNCTION public.register_link_click(TEXT, JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.register_link_click(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_link_click(TEXT, JSONB) TO service_role;

-- Incremento atômico usado pela atribuição (webhooks, service role).
CREATE OR REPLACE FUNCTION public.increment_link_conversations(
  p_link_id UUID
) RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE tracking_links SET conversations_count = conversations_count + 1
   WHERE id = p_link_id;
$$;

ALTER FUNCTION public.increment_link_conversations(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.increment_link_conversations(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_link_conversations(UUID) TO service_role;
```

- [ ] **Step 2: Revisar contra o padrão do repo**

Compare com `supabase/migrations/036_evolution_instances.sql` (RLS) e `038_delete_workspace_rpc.sql` (RPC SECURITY DEFINER + REVOKE/GRANT). Confira: idempotência, trigger `set_updated_at`, políticas com `DROP POLICY IF EXISTS` antes.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/041_tracking_links.sql
git commit -m "feat: migration dos links rastreaveis (tabelas, RLS e RPCs)"
```

- [ ] **Step 4: Aplicar a migration na VPS (necessário antes dos testes de ponta a ponta)**

Seguir `docs/infra.md`: `psql` no container do Postgres do projeto `opencrm-supabase`, arquivo em transação única (`-1`). Se não tiver acesso à VPS nesta sessão, marque este step como pendente e avise o usuário: as Tasks 2 a 5 e 7 não dependem dela para os testes unitários, mas o smoke test manual (Task 12) depende.

---

### Task 2: Geração de código curto (`generateLinkCode`)

**Files:**
- Create: `src/lib/tracking-links/code.ts`
- Test: `src/lib/tracking-links/code.test.ts`

**Interfaces:**
- Produces: `generateLinkCode(): string` (8 chars base62), `LINK_CODE_LENGTH = 8`. Usa `globalThis.crypto.getRandomValues` (funciona no browser E no Node 20+), porque o modal gera o código no cliente.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// src/lib/tracking-links/code.test.ts
import { describe, expect, it } from 'vitest';

import { generateLinkCode, LINK_CODE_LENGTH } from './code';

describe('generateLinkCode', () => {
  it('gera código com 8 caracteres', () => {
    expect(generateLinkCode()).toHaveLength(LINK_CODE_LENGTH);
  });

  it('usa somente o alfabeto base62', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateLinkCode()).toMatch(/^[A-Za-z0-9]{8}$/);
    }
  });

  it('não repete em uma amostra pequena', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateLinkCode()));
    expect(seen.size).toBe(200);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/tracking-links/code.test.ts`
Expected: FAIL (módulo `./code` não existe).

- [ ] **Step 3: Implementar**

```ts
// src/lib/tracking-links/code.ts
// ============================================================
// Código curto dos links rastreáveis (/t/<code>), estilo SgK5PPPw.
// Base62, aleatoriedade criptográfica com rejection sampling (sem
// viés do módulo). Roda no browser (modal) e no Node (testes):
// globalThis.crypto existe nos dois.
// ============================================================

const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export const LINK_CODE_LENGTH = 8;

// Maior múltiplo de 62 abaixo de 256; bytes acima são descartados
// para a distribuição ficar uniforme.
const MAX_UNBIASED = 248;

export function generateLinkCode(): string {
  let out = '';
  while (out.length < LINK_CODE_LENGTH) {
    const bytes = new Uint8Array(LINK_CODE_LENGTH * 2);
    globalThis.crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (out.length >= LINK_CODE_LENGTH) break;
      if (b < MAX_UNBIASED) out += ALPHABET[b % ALPHABET.length];
    }
  }
  return out;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/tracking-links/code.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tracking-links/code.ts src/lib/tracking-links/code.test.ts
git commit -m "feat: geracao de codigo curto dos links rastreaveis"
```

---

### Task 3: Sanitização de UTMs (`extractUtmParams` / `pickUtm`)

**Files:**
- Create: `src/lib/tracking-links/utm.ts`
- Test: `src/lib/tracking-links/utm.test.ts`

**Interfaces:**
- Produces: `UTM_KEYS` (as 5 chaves), `type UtmKey`, `type UtmParams = Partial<Record<UtmKey, string>>`, `extractUtmParams(searchParams: URLSearchParams): UtmParams | null`, `pickUtm(row: Partial<Record<UtmKey, string | null>> | null | undefined): UtmParams | null`.
- `extractUtmParams` é usada pela rota `/t/[code]` (Task 6); `pickUtm` pela atribuição (Task 5).

- [ ] **Step 1: Escrever o teste que falha**

```ts
// src/lib/tracking-links/utm.test.ts
import { describe, expect, it } from 'vitest';

import { extractUtmParams, pickUtm } from './utm';

describe('extractUtmParams', () => {
  it('extrai só os 5 utm_* conhecidos e ignora o resto', () => {
    const sp = new URLSearchParams(
      'utm_source=googleads&utm_campaign=promo&foo=bar&gclid=abc'
    );
    expect(extractUtmParams(sp)).toEqual({
      utm_source: 'googleads',
      utm_campaign: 'promo',
    });
  });

  it('retorna null quando não há nenhum UTM', () => {
    expect(extractUtmParams(new URLSearchParams('foo=bar'))).toBeNull();
    expect(extractUtmParams(new URLSearchParams(''))).toBeNull();
  });

  it('apara espaços e descarta valores vazios', () => {
    const sp = new URLSearchParams('utm_source=%20%20&utm_medium=%20social%20');
    expect(extractUtmParams(sp)).toEqual({ utm_medium: 'social' });
  });

  it('trunca valores em 255 caracteres', () => {
    const long = 'x'.repeat(300);
    const sp = new URLSearchParams(`utm_term=${long}`);
    expect(extractUtmParams(sp)).toEqual({ utm_term: 'x'.repeat(255) });
  });
});

describe('pickUtm', () => {
  it('extrai o subconjunto não vazio de um row do banco', () => {
    expect(
      pickUtm({ utm_source: 'meta', utm_medium: null, utm_term: '  ' })
    ).toEqual({ utm_source: 'meta' });
  });

  it('retorna null para row nulo ou sem valores', () => {
    expect(pickUtm(null)).toBeNull();
    expect(pickUtm({ utm_source: null })).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/tracking-links/utm.test.ts`
Expected: FAIL (módulo `./utm` não existe).

- [ ] **Step 3: Implementar**

```ts
// src/lib/tracking-links/utm.ts
// ============================================================
// UTMs dos links rastreáveis. extractUtmParams sanitiza a query do
// clique (/t/<code>?utm_...): só os 5 parâmetros conhecidos, valores
// aparados e truncados. pickUtm normaliza um row (link_clicks ou os
// padrões do tracking_links) no mesmo formato de snapshot que vai
// para contacts.source_utm.
// ============================================================

export const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
] as const;

export type UtmKey = (typeof UTM_KEYS)[number];
export type UtmParams = Partial<Record<UtmKey, string>>;

const MAX_VALUE_LENGTH = 255;

export function extractUtmParams(
  searchParams: URLSearchParams
): UtmParams | null {
  const out: UtmParams = {};
  let any = false;
  for (const key of UTM_KEYS) {
    const raw = searchParams.get(key);
    if (raw == null) continue;
    const value = raw.trim().slice(0, MAX_VALUE_LENGTH);
    if (!value) continue;
    out[key] = value;
    any = true;
  }
  return any ? out : null;
}

export function pickUtm(
  row: Partial<Record<UtmKey, string | null>> | null | undefined
): UtmParams | null {
  if (!row) return null;
  const out: UtmParams = {};
  let any = false;
  for (const key of UTM_KEYS) {
    const raw = row[key];
    if (typeof raw !== 'string') continue;
    const value = raw.trim().slice(0, MAX_VALUE_LENGTH);
    if (!value) continue;
    out[key] = value;
    any = true;
  }
  return any ? out : null;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/tracking-links/utm.test.ts`
Expected: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tracking-links/utm.ts src/lib/tracking-links/utm.test.ts
git commit -m "feat: sanitizacao de UTMs dos links rastreaveis"
```

---

### Task 4: URL do WhatsApp (`buildWaMeUrl`)

**Files:**
- Create: `src/lib/tracking-links/wa-link.ts`
- Test: `src/lib/tracking-links/wa-link.test.ts`

**Interfaces:**
- Produces: `buildWaMeUrl(phone: string, message: string): string`. Usada pela rota `/t/[code]` (Task 6).

- [ ] **Step 1: Escrever o teste que falha**

```ts
// src/lib/tracking-links/wa-link.test.ts
import { describe, expect, it } from 'vitest';

import { buildWaMeUrl } from './wa-link';

describe('buildWaMeUrl', () => {
  it('monta wa.me com dígitos do telefone e mensagem codificada', () => {
    expect(buildWaMeUrl('+5531999998888', 'Olá! Vi seu anúncio')).toBe(
      'https://wa.me/5531999998888?text=Ol%C3%A1!%20Vi%20seu%20an%C3%BAncio'
    );
  });

  it('remove qualquer formatação do telefone', () => {
    expect(buildWaMeUrl('+55 (31) 99999-8888', 'oi')).toBe(
      'https://wa.me/5531999998888?text=oi'
    );
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/tracking-links/wa-link.test.ts`
Expected: FAIL (módulo `./wa-link` não existe).

- [ ] **Step 3: Implementar**

```ts
// src/lib/tracking-links/wa-link.ts
// Link de click-to-chat do WhatsApp: wa.me aceita só dígitos no
// caminho e a mensagem em ?text= (URL-encoded).
export function buildWaMeUrl(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/tracking-links/wa-link.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tracking-links/wa-link.ts src/lib/tracking-links/wa-link.test.ts
git commit -m "feat: montagem da URL wa.me dos links rastreaveis"
```

---

### Task 5: Atribuição de conversas (`attributeLeadToLink`)

**Files:**
- Create: `src/lib/tracking-links/attribution.ts`
- Test: `src/lib/tracking-links/attribution.test.ts`

**Interfaces:**
- Consumes: `pickUtm`, `UtmParams` de `./utm` (Task 3).
- Produces: `attributeLeadToLink(db: SupabaseClient, accountId: string, contactId: string, text: string, contactCreated: boolean): Promise<void>`. Chamada pelos webhooks (Task 8). NUNCA lança.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// src/lib/tracking-links/attribution.test.ts
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/tracking-links/attribution.test.ts`
Expected: FAIL (módulo `./attribution` não existe).

- [ ] **Step 3: Implementar**

```ts
// src/lib/tracking-links/attribution.ts
// ============================================================
// Atribuição de "Conversas Geradas" aos links rastreáveis.
//
// A mensagem padrão do link é a ASSINATURA: quando um contato NOVO
// chega pelo webhook e a primeira mensagem casa com ela (trim +
// case-insensitive, o mesmo critério do índice único parcial da
// migration 041), o lead é atribuído ao link.
//
// UTMs efetivos: os do clique mais recente do link; se esse clique
// não trouxe nenhum utm_* (ou não há cliques), caem os padrões
// configurados no link. O snapshot vai em contacts.source_utm.
//
// Limitação aceita (spec): a associação lead-clique é por "último
// clique". Campanhas simultâneas no MESMO link podem trocar UTMs
// entre leads próximos no tempo; para precisão, um link por campanha.
//
// NUNCA lança: roda dentro dos webhooks e não pode derrubar o
// processamento da mensagem.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { pickUtm, type UtmKey } from '@/lib/tracking-links/utm';

type UtmRow = Partial<Record<UtmKey, string | null>>;

export async function attributeLeadToLink(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  text: string,
  contactCreated: boolean
): Promise<void> {
  if (!contactCreated) return;
  const normalized = text.trim().toLowerCase();
  if (!normalized) return;

  try {
    const { data: links } = await db
      .from('tracking_links')
      .select(
        'id, message, utm_source, utm_medium, utm_campaign, utm_term, utm_content'
      )
      .eq('account_id', accountId)
      .eq('active', true);

    const match = (links ?? []).find(
      (l: { message: string }) =>
        l.message.trim().toLowerCase() === normalized
    );
    if (!match) return;

    const { data: click } = await db
      .from('link_clicks')
      .select('utm_source, utm_medium, utm_campaign, utm_term, utm_content')
      .eq('link_id', match.id)
      .order('clicked_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const utm = pickUtm(click as UtmRow | null) ?? pickUtm(match as UtmRow);

    const { error: updateError } = await db
      .from('contacts')
      .update({
        source_link_id: match.id,
        source_utm: utm,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contactId);
    if (updateError) {
      console.error('[tracking-links] atribuição (update):', updateError);
      return;
    }

    const { error: rpcError } = await db.rpc('increment_link_conversations', {
      p_link_id: match.id,
    });
    if (rpcError) {
      console.error('[tracking-links] atribuição (rpc):', rpcError);
    }
  } catch (err) {
    console.error('[tracking-links] atribuição:', err);
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/tracking-links/attribution.test.ts`
Expected: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tracking-links/attribution.ts src/lib/tracking-links/attribution.test.ts
git commit -m "feat: atribuicao de conversas por assinatura da mensagem"
```

---

### Task 6: Rota pública de redirect `/t/[code]`

**Files:**
- Create: `src/app/t/[code]/route.ts`

**Interfaces:**
- Consumes: `extractUtmParams` (Task 3), `buildWaMeUrl` (Task 4), RPC `register_link_click` (Task 1), `supabaseAdmin` de `@/lib/automations/admin-client`.

- [ ] **Step 1: Implementar a rota**

```ts
// src/app/t/[code]/route.ts
// ============================================================
// GET /t/<code> — redirect público dos links rastreáveis.
//
// Sem login (o middleware só protege os paths listados). Captura os
// utm_* da query, registra o clique via RPC atômica (service role) e
// redireciona para o wa.me com a mensagem pré-preenchida. Código
// inexistente ou link desativado: 404 sem contar clique.
// ============================================================

import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { extractUtmParams } from '@/lib/tracking-links/utm';
import { buildWaMeUrl } from '@/lib/tracking-links/wa-link';

function notFound(): NextResponse {
  return new NextResponse('Link não encontrado', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    if (!code) return notFound();

    const utm = extractUtmParams(new URL(request.url).searchParams);

    const { data, error } = await supabaseAdmin().rpc('register_link_click', {
      p_code: code,
      p_utm: utm,
    });
    if (error) {
      console.error('[t/redirect] register_link_click:', error);
      return notFound();
    }

    const row = (Array.isArray(data) ? data[0] : data) as
      | { phone?: string; message?: string }
      | undefined;
    if (!row?.phone || !row?.message) return notFound();

    return NextResponse.redirect(buildWaMeUrl(row.phone, row.message), 302);
  } catch (err) {
    console.error('[t/redirect] fatal:', err);
    return notFound();
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: limpo (as falhas seriam só as pré-existentes, se houver).

- [ ] **Step 3: Verificação manual (se a migration já estiver aplicada e houver dev server)**

Com `npm run dev` e um link criado direto no banco (ou após a Task 10): abrir `http://localhost:3000/t/<code>?utm_source=teste` em aba anônima; conferir redirect para `wa.me` e o registro em `link_clicks`. Se ainda não der, adiar para o smoke da Task 12.

- [ ] **Step 4: Commit**

```bash
git add "src/app/t/[code]/route.ts"
git commit -m "feat: rota publica /t/<code> com captura de UTM e redirect wa.me"
```

---

### Task 7: Telefone da instância Evolution (gap fix)

**Files:**
- Modify: `src/lib/whatsapp/evolution-api.ts` (adicionar `phoneFromJid` + `fetchInstanceInfo` no fim do arquivo)
- Create: `src/lib/whatsapp/capture-instance-phone.ts`
- Test: `src/lib/whatsapp/capture-instance-phone.test.ts`
- Modify: `src/app/api/whatsapp/evolution/status/route.ts`
- Modify: `src/app/api/whatsapp/evolution/status-public/route.ts`
- Modify: `src/app/api/whatsapp/evolution/webhook/[secret]/route.ts` (branch `connection.update`, linhas 86-99)

**Interfaces:**
- Produces: `phoneFromJid(jid: string | null | undefined): string | null` e `fetchInstanceInfo(instanceName: string): Promise<{ phone: string | null }>` em `evolution-api.ts`; `captureInstancePhone(db: SupabaseClient, accountId: string, instanceName: string): Promise<void>` (nunca lança) em `capture-instance-phone.ts`.

- [ ] **Step 1: Escrever o teste que falha (helper de captura + phoneFromJid)**

```ts
// src/lib/whatsapp/capture-instance-phone.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { captureInstancePhone } from '@/lib/whatsapp/capture-instance-phone';
import { phoneFromJid } from '@/lib/whatsapp/evolution-api';

// Mock pelo MESMO especificador que o código fonte usa (alias @/),
// para o vitest casar o mock com o módulo importado por
// capture-instance-phone.ts. phoneFromJid segue real via
// importOriginal.
vi.mock('@/lib/whatsapp/evolution-api', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/whatsapp/evolution-api')>();
  return { ...original, fetchInstanceInfo: vi.fn() };
});

import { fetchInstanceInfo } from '@/lib/whatsapp/evolution-api';

function fakeDb(existingPhone: string | null) {
  const updates: Record<string, unknown>[] = [];
  const db = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: { phone: existingPhone }, error: null }),
        }),
      }),
      update: (values: Record<string, unknown>) => {
        updates.push(values);
        return { eq: () => Promise.resolve({ error: null }) };
      },
    }),
  };
  return { db: db as unknown as SupabaseClient, updates };
}

describe('phoneFromJid', () => {
  it('extrai E.164 de um jid do WhatsApp', () => {
    expect(phoneFromJid('5531999998888@s.whatsapp.net')).toBe('+5531999998888');
    expect(phoneFromJid('5531999998888:17@s.whatsapp.net')).toBe(
      '+5531999998888'
    );
  });

  it('retorna null para jid vazio ou curto demais', () => {
    expect(phoneFromJid(null)).toBeNull();
    expect(phoneFromJid('abc@s.whatsapp.net')).toBeNull();
  });
});

describe('captureInstancePhone', () => {
  beforeEach(() => vi.mocked(fetchInstanceInfo).mockReset());

  it('grava o telefone quando a coluna está vazia', async () => {
    vi.mocked(fetchInstanceInfo).mockResolvedValue({ phone: '+5531999998888' });
    const { db, updates } = fakeDb(null);
    await captureInstancePhone(db, 'acc-1', 'inst-1');
    expect(updates).toEqual([{ phone: '+5531999998888' }]);
  });

  it('não faz nada quando já há telefone', async () => {
    const { db, updates } = fakeDb('+5531988887777');
    await captureInstancePhone(db, 'acc-1', 'inst-1');
    expect(fetchInstanceInfo).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('nunca lança quando a busca falha', async () => {
    vi.mocked(fetchInstanceInfo).mockRejectedValue(new Error('rede caiu'));
    const { db, updates } = fakeDb(null);
    await expect(
      captureInstancePhone(db, 'acc-1', 'inst-1')
    ).resolves.toBeUndefined();
    expect(updates).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/whatsapp/capture-instance-phone.test.ts`
Expected: FAIL (`capture-instance-phone` não existe; `phoneFromJid` não exportada).

- [ ] **Step 3: Implementar `phoneFromJid` + `fetchInstanceInfo` em `evolution-api.ts`**

Acrescentar ao FIM de `src/lib/whatsapp/evolution-api.ts`:

```ts
/**
 * Extrai o telefone E.164 de um JID do WhatsApp
 * (ex.: "5531999998888:17@s.whatsapp.net" → "+5531999998888").
 */
export function phoneFromJid(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const digits = jid.split('@')[0].split(':')[0].replace(/\D/g, '');
  return digits.length >= 8 ? `+${digits}` : null;
}

/**
 * Busca os dados da instância na Evolution (`GET /instance/
 * fetchInstances`) e devolve o telefone do número conectado
 * (ownerJid). Versões diferentes da Evolution devolvem o dono como
 * `ownerJid` (v2) ou aninhado em `instance.owner` (v1) — tentamos os
 * dois. `phone: null` quando a API falha ou o campo não veio.
 */
export async function fetchInstanceInfo(
  instanceName: string,
): Promise<{ phone: string | null }> {
  const { ok, data } = await call(
    `/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`,
  );
  if (!ok) return { phone: null };
  const list = Array.isArray(data) ? data : [data];
  for (const item of list) {
    const d = (item ?? {}) as {
      ownerJid?: string;
      instance?: { owner?: string };
    };
    const phone = phoneFromJid(d.ownerJid ?? d.instance?.owner);
    if (phone) return { phone };
  }
  return { phone: null };
}
```

- [ ] **Step 4: Implementar o helper de captura**

```ts
// src/lib/whatsapp/capture-instance-phone.ts
// ============================================================
// Grava evolution_instances.phone quando a instância conecta.
//
// A coluna existia desde a migration 036 mas nunca era escrita, o que
// deixava o select de números dos Links Rastreáveis vazio e mantinha
// morta a preferência de proxy por DDD (fase 1 do anti-ban). Chamado
// nos três pontos em que o estado vira "connected": rota de status,
// rota status-public e webhook connection.update.
//
// Best-effort: falha de rede/API só loga; nunca quebra o chamador.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchInstanceInfo } from '@/lib/whatsapp/evolution-api';

export async function captureInstancePhone(
  db: SupabaseClient,
  accountId: string,
  instanceName: string,
): Promise<void> {
  try {
    const { data: row } = await db
      .from('evolution_instances')
      .select('phone')
      .eq('account_id', accountId)
      .maybeSingle();
    if (!row) return;
    if (typeof row.phone === 'string' && row.phone.trim()) return;

    const { phone } = await fetchInstanceInfo(instanceName);
    if (!phone) return;

    await db
      .from('evolution_instances')
      .update({ phone })
      .eq('account_id', accountId);
  } catch (err) {
    console.error('[capture-instance-phone]', err);
  }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run src/lib/whatsapp/capture-instance-phone.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 6: Chamar nos três pontos de conexão**

Em `src/app/api/whatsapp/evolution/status/route.ts`: importar `captureInstancePhone` e, logo APÓS o bloco `if (nextStatus !== row.status) {...}` (linha ~42), adicionar:

```ts
    if (connected) {
      await captureInstancePhone(
        ctx.supabase,
        ctx.accountId,
        row.instance_name as string,
      );
    }
```

Em `src/app/api/whatsapp/evolution/status-public/route.ts`: importar `captureInstancePhone` e, logo APÓS o `await admin.from("evolution_instances").update({ status: nextStatus })...` (linha ~39), adicionar:

```ts
    if (connected) {
      await captureInstancePhone(
        admin,
        inst.account_id as string,
        inst.instance_name as string,
      );
    }
```

Em `src/app/api/whatsapp/evolution/webhook/[secret]/route.ts`, no branch `connection.update` (linha 86-99), logo APÓS o `update({ status })` e ANTES do `return`:

```ts
      if (status === "connected") {
        await captureInstancePhone(db, accountId, body.instance);
      }
```

(A observação da RLS: `ctx.supabase` na rota autenticada atualiza via policy `evolution_instances_update`, que exige admin. Como o polling de status pode rodar como agente, se o update falhar em silêncio não há dano; o webhook e a rota pública usam service role e cobrem o caso. Não tratar como erro.)

- [ ] **Step 7: Typecheck + testes**

Run: `npm run typecheck && npx vitest run src/lib/whatsapp`
Expected: typecheck limpo; testes novos PASS, antigos no baseline.

- [ ] **Step 8: Commit**

```bash
git add src/lib/whatsapp/evolution-api.ts src/lib/whatsapp/capture-instance-phone.ts src/lib/whatsapp/capture-instance-phone.test.ts src/app/api/whatsapp/evolution/status/route.ts src/app/api/whatsapp/evolution/status-public/route.ts "src/app/api/whatsapp/evolution/webhook/[secret]/route.ts"
git commit -m "feat: grava o telefone da instancia Evolution ao conectar"
```

---

### Task 8: Chamar a atribuição nos dois webhooks

**Files:**
- Modify: `src/app/api/whatsapp/evolution/webhook/[secret]/route.ts` (branch `messages.upsert`, linhas ~140-146)
- Modify: `src/app/api/whatsapp/webhook/route.ts` (função `processMessage`, linhas ~614-617)

**Interfaces:**
- Consumes: `attributeLeadToLink(db, accountId, contactId, text, contactCreated)` (Task 5); `resolveConversationByPhone` já retorna `{ conversationId, contactId, contactCreated }`; no webhook Meta, `contactOutcome.wasCreated` e `contentText` já existem no escopo.

- [ ] **Step 1: Webhook Evolution**

Em `src/app/api/whatsapp/evolution/webhook/[secret]/route.ts`, importar:

```ts
import { attributeLeadToLink } from "@/lib/tracking-links/attribution";
```

E logo APÓS o `const conv = await resolveConversationByPhone(db, accountId, phone, name);` (linha ~140-145), adicionar:

```ts
          // Atribuição de origem (Links Rastreáveis): só age quando o
          // contato acabou de ser criado e o texto casa com a
          // mensagem-assinatura de um link ativo. Nunca lança.
          await attributeLeadToLink(
            db,
            accountId,
            conv.contactId,
            text,
            conv.contactCreated,
          );
```

- [ ] **Step 2: Webhook Meta**

Em `src/app/api/whatsapp/webhook/route.ts`, importar:

```ts
import { attributeLeadToLink } from '@/lib/tracking-links/attribution'
```

E em `processMessage`, logo APÓS o destructuring de `parseMessageContent` (linhas ~615-617: `const { contentText, mediaUrl, mediaType, interactiveReplyId } = await parseMessageContent(message, accessToken)`), adicionar:

```ts
  // Atribuição de origem (Links Rastreáveis): contato novo cuja
  // primeira mensagem casa com a mensagem-assinatura de um link
  // ativo. Nunca lança.
  await attributeLeadToLink(
    supabaseAdmin(),
    accountId,
    contactRecord.id,
    contentText ?? '',
    contactOutcome.wasCreated
  )
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: limpo.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/whatsapp/evolution/webhook/[secret]/route.ts" src/app/api/whatsapp/webhook/route.ts
git commit -m "feat: atribuicao de links rastreaveis nos webhooks Evolution e Meta"
```

---

### Task 9: Tipos, sidebar, middleware e página (shell + cards + tabela + empty state)

**Files:**
- Modify: `src/types/index.ts` (adicionar `TrackingLink`; estender `Contact`)
- Modify: `src/components/layout/sidebar.tsx` (item após "Funis", linha ~101)
- Modify: `src/middleware.ts` (adicionar `/tracking-links` a `protectedPaths`, linha 73)
- Create: `src/app/(dashboard)/tracking-links/page.tsx`

**Interfaces:**
- Produces: `TrackingLink` em `@/types`; página que lista links, calcula os 4 cards e renderiza a tabela. Estado e callbacks do modal/interações ficam prontos como stubs tipados que a Task 10/11 preenche (`modalOpen`, `editing`, `onToggleActive`, `onDelete`, `onCopy`).

- [ ] **Step 1: Tipos**

Em `src/types/index.ts`, adicionar após a interface `Contact` (linha ~106):

```ts
export interface TrackingLink {
  id: string;
  account_id: string;
  user_id: string;
  name: string;
  code: string;
  phone: string;
  message: string;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
  active: boolean;
  clicks_count: number;
  conversations_count: number;
  created_at: string;
  updated_at: string;
}
```

E DENTRO de `Contact` (antes de `tags?: Tag[];`), adicionar:

```ts
  /** Link rastreável que originou o lead (migration 041). */
  source_link_id?: string | null;
  /** Snapshot dos UTMs efetivos no momento da atribuição. */
  source_utm?: Record<string, string> | null;
```

- [ ] **Step 2: Sidebar e middleware**

Em `src/components/layout/sidebar.tsx`: adicionar `Link2` ao import de `lucide-react` e, após a linha `{ href: "/pipelines", label: "Funis", icon: GitBranch },` (linha ~101), inserir:

```ts
  { href: "/tracking-links", label: "Links Rastreáveis", icon: Link2 },
```

Em `src/middleware.ts` linha 73, adicionar `'/tracking-links'` ao array:

```ts
  const protectedPaths = ['/dashboard', '/inbox', '/contacts', '/pipelines', '/broadcasts', '/automations', '/settings', '/tracking-links']
```

- [ ] **Step 3: Página**

```tsx
// src/app/(dashboard)/tracking-links/page.tsx
'use client';

// ============================================================
// Links Rastreáveis: links curtos /t/<code> que abrem o WhatsApp com
// mensagem pré-preenchida, contando cliques e conversas geradas
// (atribuídas pela mensagem-assinatura). Padrão da página de
// Disparos: supabase client + RLS, useCan/GatedButton para escrita.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Link2,
  Loader2,
  MessagesSquare,
  MousePointerClick,
  Pencil,
  Percent,
  Plus,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import type { TrackingLink } from '@/types';
import { useCan } from '@/hooks/use-can';
import { MetricCard } from '@/components/dashboard/metric-card';
import { Button } from '@/components/ui/button';
import { GatedButton } from '@/components/ui/gated-button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { LinkFormModal } from '@/components/tracking-links/link-form-modal';
import { CopyLinkButton } from '@/components/tracking-links/copy-link-button';

function rate(conversations: number, clicks: number): string {
  if (!clicks) return '0%';
  return `${((conversations / clicks) * 100).toFixed(1)}%`;
}

export default function TrackingLinksPage() {
  const canWrite = useCan('send-messages');
  const [links, setLinks] = useState<TrackingLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TrackingLink | null>(null);
  const [deleting, setDeleting] = useState<TrackingLink | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const fetchLinks = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data, error: fetchError } = await supabase
        .from('tracking_links')
        .select('*')
        .order('created_at', { ascending: false });
      if (fetchError) throw fetchError;
      setLinks(data ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar links');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchLinks();
  }, [fetchLinks]);

  const totals = useMemo(() => {
    const clicks = links.reduce((sum, l) => sum + l.clicks_count, 0);
    const conversations = links.reduce(
      (sum, l) => sum + l.conversations_count,
      0
    );
    return { count: links.length, clicks, conversations };
  }, [links]);

  const handleToggleActive = useCallback(
    async (link: TrackingLink, active: boolean) => {
      // Otimista com rollback: o switch responde na hora.
      setLinks((prev) =>
        prev.map((l) => (l.id === link.id ? { ...l, active } : l))
      );
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from('tracking_links')
        .update({ active })
        .eq('id', link.id);
      if (updateError) {
        setLinks((prev) =>
          prev.map((l) => (l.id === link.id ? { ...l, active: !active } : l))
        );
        // Reativar pode colidir com outro link ativo de mesma mensagem.
        if (updateError.message?.includes('uq_tracking_links_active_message')) {
          toast.error(
            'Já existe um link ativo com esta mensagem. Edite a mensagem antes de reativar.'
          );
        } else {
          toast.error('Não foi possível alterar o status do link');
        }
      }
    },
    []
  );

  const handleDelete = useCallback(async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from('tracking_links')
      .delete()
      .eq('id', deleting.id);
    setDeleteBusy(false);
    if (deleteError) {
      toast.error('Não foi possível excluir o link');
      return;
    }
    setLinks((prev) => prev.filter((l) => l.id !== deleting.id));
    setDeleting(null);
    toast.success('Link excluído');
  }, [deleting]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Links Rastreáveis
          </h1>
          <p className="text-sm text-muted-foreground">
            Identifique a origem exata dos seus contatos no WhatsApp
          </p>
        </div>
        <GatedButton
          canAct={canWrite}
          gateReason="criar links rastreáveis"
          onClick={() => {
            setEditing(null);
            setModalOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          Novo Link
        </GatedButton>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Total de Links"
          value={totals.count.toLocaleString('pt-BR')}
          icon={Link2}
        />
        <MetricCard
          title="Cliques Totais"
          value={totals.clicks.toLocaleString('pt-BR')}
          icon={MousePointerClick}
        />
        <MetricCard
          title="Conversas Geradas"
          value={totals.conversations.toLocaleString('pt-BR')}
          icon={MessagesSquare}
        />
        <MetricCard
          title="Taxa de Conversão"
          value={rate(totals.conversations, totals.clicks)}
          icon={Percent}
        />
      </div>

      <div className="rounded-xl border border-border bg-card">
        <div className="border-b border-border p-5">
          <h2 className="text-lg font-semibold text-foreground">Seus Links</h2>
          <p className="text-sm text-muted-foreground">
            Gerencie e acompanhe o desempenho dos seus links rastreáveis
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 p-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Carregando links...
          </div>
        ) : error ? (
          <div className="p-12 text-center text-sm text-red-400">{error}</div>
        ) : links.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-12 text-center">
            <Link2 className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">
              Nenhum link rastreável criado ainda
            </p>
            <p className="text-sm text-muted-foreground">
              Crie seu primeiro link para começar a rastrear suas conversas
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Link</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead className="text-right">Cliques</TableHead>
                <TableHead className="text-right">Conversas</TableHead>
                <TableHead className="text-right">Taxa</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {links.map((link) => (
                <TableRow key={link.id}>
                  <TableCell className="font-medium">{link.name}</TableCell>
                  <TableCell>
                    <CopyLinkButton code={link.code} />
                  </TableCell>
                  <TableCell>
                    {link.utm_source ? (
                      <Badge variant="secondary">{link.utm_source}</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {link.clicks_count.toLocaleString('pt-BR')}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {link.conversations_count.toLocaleString('pt-BR')}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {rate(link.conversations_count, link.clicks_count)}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={link.active}
                      disabled={!canWrite}
                      onCheckedChange={(checked) =>
                        handleToggleActive(link, checked)
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={!canWrite}
                        title="Editar"
                        onClick={() => {
                          setEditing(link);
                          setModalOpen(true);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={!canWrite}
                        title="Excluir"
                        onClick={() => setDeleting(link)}
                      >
                        <Trash2 className="h-4 w-4 text-red-400" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <LinkFormModal
        open={modalOpen}
        link={editing}
        onOpenChange={setModalOpen}
        onSaved={fetchLinks}
      />

      <Dialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir link rastreável</DialogTitle>
            <DialogDescription>
              Excluir &quot;{deleting?.name}&quot;? Os contatos já atribuídos
              não são apagados, mas a referência de origem deles fica vazia.
              Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={deleteBusy}
              onClick={handleDelete}
            >
              {deleteBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

Observação: a página importa `LinkFormModal` e `CopyLinkButton` que só nascem nas Tasks 10/11. Para o typecheck passar NESTA task, crie os dois arquivos já nesta task com o conteúdo final das Tasks 10 e 11 (elas detalham o código), OU inverta a ordem executando 10 e 11 antes do commit desta. Recomendado: implementar Task 9, 10 e 11 na sequência e commitar junto no fim da 11 se o typecheck intermediário incomodar; caso contrário, um commit por task com os três arquivos nascendo aqui.

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: limpo (com os componentes das Tasks 10/11 já criados).

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/components/layout/sidebar.tsx src/middleware.ts "src/app/(dashboard)/tracking-links/page.tsx"
git commit -m "feat: pagina Links Rastreaveis (cards, tabela, empty state)"
```

---

### Task 10: Modal criar/editar (`LinkFormModal`)

**Files:**
- Create: `src/components/tracking-links/link-form-modal.tsx`

**Interfaces:**
- Consumes: `generateLinkCode` (Task 2), `isValidE164`/`sanitizePhoneForMeta` de `@/lib/whatsapp/phone-utils`, `TrackingLink` (Task 9), `useAuth` (`accountId`), `isUniqueViolation` de `@/lib/contacts/dedupe`.
- Produces: `LinkFormModal({ open, link, onOpenChange, onSaved }: { open: boolean; link: TrackingLink | null; onOpenChange: (open: boolean) => void; onSaved: () => void })` — `link` null = criar; preenchido = editar.

- [ ] **Step 1: Implementar o modal**

```tsx
// src/components/tracking-links/link-form-modal.tsx
'use client';

// ============================================================
// Modal criar/editar de Link Rastreável.
//
// Número WhatsApp: select com os números conectados da conta ativa
// (evolution_instances.phone; a config Meta não guarda número
// discável). Sem número no banco, cai num campo manual com validação
// E.164. A Mensagem Padrão é obrigatória: é a assinatura que atribui
// o lead ao link (índice único por conta entre links ativos).
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { generateLinkCode } from '@/lib/tracking-links/code';
import { isValidE164, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';
import { isUniqueViolation } from '@/lib/contacts/dedupe';
import type { TrackingLink } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface LinkFormModalProps {
  open: boolean;
  /** null = criar; preenchido = editar. */
  link: TrackingLink | null;
  onOpenChange: (open: boolean) => void;
  /** Chamado após salvar com sucesso (a página refaz o fetch). */
  onSaved: () => void;
}

interface FormState {
  name: string;
  phone: string;
  message: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_term: string;
  utm_content: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  phone: '',
  message: '',
  utm_source: '',
  utm_medium: '',
  utm_campaign: '',
  utm_term: '',
  utm_content: '',
};

/** Tentativas de regenerar o código em colisão (índice UNIQUE). */
const CODE_RETRIES = 3;

export function LinkFormModal({
  open,
  link,
  onOpenChange,
  onSaved,
}: LinkFormModalProps) {
  const { accountId } = useAuth();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [numbers, setNumbers] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // (Re)inicializa ao abrir: form do link em edição ou vazio, e busca
  // os números conectados da conta ativa.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm(
      link
        ? {
            name: link.name,
            phone: link.phone,
            message: link.message,
            utm_source: link.utm_source ?? '',
            utm_medium: link.utm_medium ?? '',
            utm_campaign: link.utm_campaign ?? '',
            utm_term: link.utm_term ?? '',
            utm_content: link.utm_content ?? '',
          }
        : EMPTY_FORM
    );

    const supabase = createClient();
    supabase
      .from('evolution_instances')
      .select('phone, status')
      .then(({ data }) => {
        const phones = (data ?? [])
          .filter((row) => row.status === 'connected' && row.phone)
          .map((row) => String(row.phone));
        setNumbers(phones);
      });
  }, [open, link]);

  const set = useCallback(
    (field: keyof FormState) => (value: string) =>
      setForm((prev) => ({ ...prev, [field]: value })),
    []
  );

  const handleSave = useCallback(async () => {
    const name = form.name.trim();
    const message = form.message.trim();
    const phoneDigits = sanitizePhoneForMeta(form.phone);
    const phone = `+${phoneDigits}`;

    if (!name || !message || !form.phone) {
      toast.error('Preencha nome, número e mensagem padrão');
      return;
    }
    if (!isValidE164(phone)) {
      toast.error('Número inválido: use o formato com DDI, ex. +5531999998888');
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const utmFields = {
      utm_source: form.utm_source.trim() || null,
      utm_medium: form.utm_medium.trim() || null,
      utm_campaign: form.utm_campaign.trim() || null,
      utm_term: form.utm_term.trim() || null,
      utm_content: form.utm_content.trim() || null,
    };

    try {
      if (link) {
        const { error } = await supabase
          .from('tracking_links')
          .update({ name, phone, message, ...utmFields })
          .eq('id', link.id);
        if (error) throw error;
      } else {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.user || !accountId) {
          toast.error('Sessão expirada: recarregue a página');
          return;
        }
        // Colisão de código é rara (62^8), mas o índice UNIQUE pode
        // rejeitar: regenera e tenta de novo até CODE_RETRIES vezes.
        let lastError: unknown = null;
        for (let attempt = 0; attempt < CODE_RETRIES; attempt++) {
          const { error } = await supabase.from('tracking_links').insert({
            account_id: accountId,
            user_id: session.user.id,
            name,
            code: generateLinkCode(),
            phone,
            message,
            ...utmFields,
            active: true,
          });
          lastError = error;
          if (!error) break;
          // Mensagem duplicada não é colisão de código: não re-tentar.
          if (error.message?.includes('uq_tracking_links_active_message')) {
            throw error;
          }
          if (!isUniqueViolation(error)) throw error;
        }
        if (lastError) throw lastError;
      }

      toast.success(link ? 'Link atualizado' : 'Link criado');
      onOpenChange(false);
      onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('uq_tracking_links_active_message')) {
        toast.error(
          'Já existe um link ativo com esta mensagem. Use uma mensagem única por link.'
        );
      } else {
        toast.error('Não foi possível salvar o link');
      }
    } finally {
      setSaving(false);
    }
  }, [form, link, accountId, onOpenChange, onSaved]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {link ? 'Editar Link Rastreável' : 'Criar Link Rastreável'}
          </DialogTitle>
          <DialogDescription>
            Crie um link para identificar a origem das conversas no WhatsApp
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="tl-name">Nome do Link *</Label>
              <Input
                id="tl-name"
                placeholder="Ex: Campanha Instagram Janeiro"
                value={form.name}
                onChange={(e) => set('name')(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Número WhatsApp *</Label>
              {numbers.length > 0 ? (
                <Select value={form.phone} onValueChange={set('phone')}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o número" />
                  </SelectTrigger>
                  <SelectContent>
                    {numbers.map((n) => (
                      <SelectItem key={n} value={n}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  placeholder="+5531999998888"
                  value={form.phone}
                  onChange={(e) => set('phone')(e.target.value)}
                />
              )}
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Parâmetros UTM</Label>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label
                  htmlFor="tl-utm-source"
                  className="text-xs text-muted-foreground"
                >
                  Source
                </Label>
                <Input
                  id="tl-utm-source"
                  placeholder="instagram"
                  value={form.utm_source}
                  onChange={(e) => set('utm_source')(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label
                  htmlFor="tl-utm-medium"
                  className="text-xs text-muted-foreground"
                >
                  Medium
                </Label>
                <Input
                  id="tl-utm-medium"
                  placeholder="social"
                  value={form.utm_medium}
                  onChange={(e) => set('utm_medium')(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label
                  htmlFor="tl-utm-campaign"
                  className="text-xs text-muted-foreground"
                >
                  Campaign
                </Label>
                <Input
                  id="tl-utm-campaign"
                  placeholder="promo_janeiro"
                  value={form.utm_campaign}
                  onChange={(e) => set('utm_campaign')(e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label
                  htmlFor="tl-utm-term"
                  className="text-xs text-muted-foreground"
                >
                  Term
                </Label>
                <Input
                  id="tl-utm-term"
                  placeholder="palavra_chave"
                  value={form.utm_term}
                  onChange={(e) => set('utm_term')(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label
                  htmlFor="tl-utm-content"
                  className="text-xs text-muted-foreground"
                >
                  Content
                </Label>
                <Input
                  id="tl-utm-content"
                  placeholder="banner_topo"
                  value={form.utm_content}
                  onChange={(e) => set('utm_content')(e.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Usados como padrão quando a URL do clique não trouxer UTMs (a
              LP repassa os da campanha automaticamente).
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="tl-message">Mensagem Padrão *</Label>
            <Textarea
              id="tl-message"
              rows={4}
              placeholder="Olá! Vi seu anúncio e gostaria de saber mais..."
              value={form.message}
              onChange={(e) => set('message')(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Obrigatória. Usada como assinatura para atribuição precisa do
              lead ao link.
            </p>
            <p className="text-xs text-muted-foreground">
              Esta mensagem será preenchida automaticamente ao abrir o
              WhatsApp
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={saving} onClick={handleSave}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {link ? 'Salvar' : 'Criar Link'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: limpo.

- [ ] **Step 3: Commit**

```bash
git add src/components/tracking-links/link-form-modal.tsx
git commit -m "feat: modal criar/editar de link rastreavel"
```

---

### Task 11: Botão copiar (`CopyLinkButton`)

**Files:**
- Create: `src/components/tracking-links/copy-link-button.tsx`

**Interfaces:**
- Produces: `CopyLinkButton({ code }: { code: string })` — mostra `/t/<code>` em estilo código e copia a URL completa (`window.location.origin + '/t/' + code`).

- [ ] **Step 1: Implementar**

```tsx
// src/components/tracking-links/copy-link-button.tsx
'use client';

import { useCallback, useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function CopyLinkButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(
      `${window.location.origin}/t/${code}`
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  return (
    <button
      onClick={handleCopy}
      title="Copiar link completo"
      className="flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors hover:bg-muted"
    >
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
        /t/{code}
      </code>
      {copied ? (
        <Check className="h-3.5 w-3.5 text-primary" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
      )}
    </button>
  );
}
```

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: limpo. (Este é o ponto em que a página da Task 9 compila inteira.)

- [ ] **Step 3: Commit**

```bash
git add src/components/tracking-links/copy-link-button.tsx
git commit -m "feat: botao de copiar link rastreavel"
```

---

### Task 12: Origem no painel do contato (Inbox)

**Files:**
- Modify: `src/components/inbox/contact-sidebar.tsx`

**Interfaces:**
- Consumes: `Contact.source_link_id` / `Contact.source_utm` (Task 9). Busca o nome do link por `source_link_id` (a RLS de `tracking_links` escopa à conta ativa).

- [ ] **Step 1: Buscar o nome do link de origem**

Em `contact-sidebar.tsx`: adicionar estado (junto dos outros `useState`, linha ~35):

```ts
  const [sourceLinkName, setSourceLinkName] = useState<string | null>(null);
```

Dentro de `fetchContactData` (após o bloco dos três fetches paralelos, linha ~70), adicionar:

```ts
    // Origem do lead (Links Rastreáveis), quando atribuída.
    if (contact.source_link_id) {
      const { data: sourceLink } = await supabase
        .from('tracking_links')
        .select('name')
        .eq('id', contact.source_link_id)
        .maybeSingle();
      setSourceLinkName(sourceLink?.name ?? null);
    } else {
      setSourceLinkName(null);
    }
```

- [ ] **Step 2: Renderizar o bloco Origem**

Adicionar `Link2` ao import de `lucide-react` (linha ~8-18). Depois da seção Tags (após o `</div>` da linha 205) e ANTES do divider da linha 207-208, inserir:

```tsx
          {(contact.source_link_id || contact.source_utm) && (
            <>
              {/* Divider */}
              <div className="my-4 border-t border-border" />

              {/* Origem (Links Rastreáveis) */}
              <div>
                <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <Link2 className="h-3 w-3" />
                  Origem
                </div>
                <div className="mt-2 space-y-1 px-1">
                  {sourceLinkName && (
                    <p className="text-sm font-medium text-foreground">
                      {sourceLinkName}
                    </p>
                  )}
                  {contact.source_utm && (
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(contact.source_utm).map(
                        ([key, value]) => (
                          <span
                            key={key}
                            className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                            title={key}
                          >
                            {key.replace('utm_', '')}: {value}
                          </span>
                        )
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: limpo.

- [ ] **Step 4: Commit**

```bash
git add src/components/inbox/contact-sidebar.tsx
git commit -m "feat: origem do lead no painel do contato (inbox)"
```

---

### Task 13: Gates finais e push

**Files:** nenhum novo.

- [ ] **Step 1: Suite completa**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck limpo; testes com as ~5 falhas pré-existentes de locale/timezone no máximo (nenhuma falha NOVA); build ok.

- [ ] **Step 2: Smoke test visual**

Com `npm run dev` (exige migration 041 aplicada, Task 1 Step 4):
1. Sidebar mostra "Links Rastreáveis" após "Funis"; página abre com empty state.
2. Criar link pelo modal; aparece na tabela com 0/0.
3. Abrir `/t/<code>?utm_source=teste` em aba anônima: redireciona para wa.me; Cliques vira 1 após recarregar.
4. Desativar no switch; `/t/<code>` responde 404.
5. Tentar criar segundo link ativo com a MESMA mensagem: erro amigável.
6. (Se houver instância Evolution conectável) conectar e conferir o número no select do modal.
7. (Se houver como simular inbound) mandar a mensagem padrão de um número novo e conferir Conversas = 1 e o bloco Origem no inbox.

Passos 6 e 7 dependem de infra externa: se não der para validar nesta sessão, reportar como pendência ao usuário, não como concluído.

- [ ] **Step 3: Push**

```bash
git push OpenCRM feat/links-rastreaveis:feat/links-rastreaveis
```

Depois seguir a skill superpowers:finishing-a-development-branch para decidir PR/merge.
