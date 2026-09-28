-- ============================================================
-- 045_google_ads.sql — rastreamento Google Ads (conversões offline)
--
-- Espelha o meta_ads_config, mas pra Google Ads. Envia conversões pela
-- Google Ads API (Enhanced Conversions for Leads / uploadClickConversions):
-- Lead quando um lead novo escreve, Purchase quando o negócio é ganho.
--
-- Credenciais coladas na mão (como o Pixel/token do Meta): customer id,
-- developer token, e OAuth (client id/secret + refresh token). Cifrados
-- em AES-256-GCM com ENCRYPTION_KEY, mesmo esquema do resto.
--
-- Também adiciona `provider` no log de eventos, pra separar meta/google.
-- NÃO aplicar ainda (dev mode): aplicar no banco de dev ao validar.
-- ============================================================
CREATE TABLE IF NOT EXISTS google_ads_config (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  customer_id TEXT,                 -- ID da conta Google Ads (só dígitos)
  login_customer_id TEXT,           -- MCC/gerente, se houver
  developer_token TEXT,             -- cifrado
  oauth_client_id TEXT,             -- cifrado
  oauth_client_secret TEXT,         -- cifrado
  oauth_refresh_token TEXT,         -- cifrado
  conversion_action_lead TEXT,      -- resource name da ação de conversão (Lead)
  conversion_action_purchase TEXT,  -- idem (Purchase)
  purchase_currency TEXT NOT NULL DEFAULT 'BRL',
  lead_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  purchase_stage_id UUID,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE google_ads_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS google_ads_config_select ON google_ads_config;
CREATE POLICY google_ads_config_select ON google_ads_config
  FOR SELECT USING (in_active_account(account_id));
DROP POLICY IF EXISTS google_ads_config_insert ON google_ads_config;
CREATE POLICY google_ads_config_insert ON google_ads_config
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS google_ads_config_update ON google_ads_config;
CREATE POLICY google_ads_config_update ON google_ads_config
  FOR UPDATE USING (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS google_ads_config_delete ON google_ads_config;
CREATE POLICY google_ads_config_delete ON google_ads_config
  FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON google_ads_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON google_ads_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Separa meta/google no log de eventos (reusa a mesma tabela).
ALTER TABLE meta_conversion_events
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'meta';

-- gclid capturado do lead (quando vier por link rastreável do Google).
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS gclid TEXT;
