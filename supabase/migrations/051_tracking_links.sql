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
