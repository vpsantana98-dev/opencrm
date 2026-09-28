-- ============================================================
-- 040_meta_ads_tracking.sql — rastreamento Meta Ads (Pixel + CAPI)
--
-- Por cliente (account): Pixel do Meta + token da API de Conversão
-- (cifrado, como o whatsapp_config). Dispara "eventos de conversão"
-- server-to-server pra Meta CAPI: Lead quando um lead novo escreve, e
-- Purchase quando o negócio chega ao estágio configurado.
--
-- Atribuição de anúncio (Click-to-WhatsApp): guardamos na contato o
-- ctwa_clid + o payload de referral, pra o evento ir com a atribuição
-- forte (só vem pelo número OFICIAL da Meta; no Evolution o evento sai
-- sem ctwa_clid, atribuição mais fraca).
--
-- Idempotente.
-- ============================================================

-- ---- Config por cliente ------------------------------------
CREATE TABLE IF NOT EXISTS meta_ads_config (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  pixel_id TEXT,
  -- token da API de Conversão, cifrado (AES-256-GCM via ENCRYPTION_KEY)
  capi_token TEXT,
  -- código de teste do Gerenciador de Eventos (opcional; ativa Test Events)
  test_event_code TEXT,
  -- 'business_messaging' (Pixel de Mensagens, p/ CTWA) ou 'website'
  action_source TEXT NOT NULL DEFAULT 'business_messaging',
  -- dispara evento de Lead quando um lead novo escreve
  lead_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  -- estágio do funil que conta como "compra"; ao mover pra ele, dispara
  -- Purchase. UUID solto (sem FK) para não acoplar ao schema de pipeline.
  purchase_stage_id UUID,
  purchase_currency TEXT NOT NULL DEFAULT 'BRL',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE meta_ads_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meta_ads_config_select ON meta_ads_config;
CREATE POLICY meta_ads_config_select ON meta_ads_config
  FOR SELECT USING (in_active_account(account_id));
DROP POLICY IF EXISTS meta_ads_config_insert ON meta_ads_config;
CREATE POLICY meta_ads_config_insert ON meta_ads_config
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS meta_ads_config_update ON meta_ads_config;
CREATE POLICY meta_ads_config_update ON meta_ads_config
  FOR UPDATE USING (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS meta_ads_config_delete ON meta_ads_config;
CREATE POLICY meta_ads_config_delete ON meta_ads_config
  FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON meta_ads_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON meta_ads_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---- Log de eventos de conversão ---------------------------
CREATE TABLE IF NOT EXISTS meta_conversion_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID,
  event_name TEXT NOT NULL,
  -- id estável do evento (dedupe na Meta): lead_<contact>, purchase_<deal>
  event_id TEXT,
  status TEXT NOT NULL DEFAULT 'sent', -- 'sent' | 'failed'
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meta_conv_events_account
  ON meta_conversion_events(account_id, created_at DESC);

ALTER TABLE meta_conversion_events ENABLE ROW LEVEL SECURITY;

-- Leitura por membros do cliente ativo; escrita só pelo service role
-- (o webhook e os endpoints gravam via admin client), então não há
-- policy de INSERT para usuários.
DROP POLICY IF EXISTS meta_conversion_events_select ON meta_conversion_events;
CREATE POLICY meta_conversion_events_select ON meta_conversion_events
  FOR SELECT USING (in_active_account(account_id));

-- ---- Atribuição de anúncio na contato ----------------------
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ctwa_clid TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ad_source_id TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ad_referral JSONB;
