-- ============================================================
-- 053_client_ads_onboarding.sql
-- Conexao Meta compartilhada pela agencia, ativos escolhidos por cliente,
-- Pixel ag�ncia e configuracoes opcionais do onboarding.
-- Idempotente, uma transacao por arquivo no processo de deploy.
-- ============================================================

CREATE TABLE IF NOT EXISTS meta_agency_connections (
  agency_account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  connected_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  meta_user_id TEXT NOT NULL,
  meta_user_name TEXT,
  access_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE meta_agency_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS meta_agency_connections_no_client_access ON meta_agency_connections;
CREATE POLICY meta_agency_connections_no_client_access ON meta_agency_connections
  FOR ALL USING (false) WITH CHECK (false);
DROP TRIGGER IF EXISTS set_updated_at ON meta_agency_connections;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON meta_agency_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE meta_ads_config
  ADD COLUMN IF NOT EXISTS agency_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ad_account_id TEXT,
  ADD COLUMN IF NOT EXISTS ad_account_name TEXT,
  ADD COLUMN IF NOT EXISTS page_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS pixel_name TEXT;

CREATE TABLE IF NOT EXISTS client_setup_options (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  default_message TEXT NOT NULL DEFAULT 'Olá, gostaria de mais informações',
  lead_created_webhook_url TEXT,
  lead_updated_webhook_url TEXT,
  webhook_stage_changes_only BOOLEAN NOT NULL DEFAULT false,
  portal_enabled BOOLEAN NOT NULL DEFAULT false,
  pixel_enabled BOOLEAN NOT NULL DEFAULT true,
  pixel_site_url TEXT,
  pixel_last_seen_at TIMESTAMPTZ,
  pixel_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE client_setup_options ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_setup_options_select ON client_setup_options;
CREATE POLICY client_setup_options_select ON client_setup_options
  FOR SELECT USING (in_active_account(account_id));
DROP POLICY IF EXISTS client_setup_options_insert ON client_setup_options;
CREATE POLICY client_setup_options_insert ON client_setup_options
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS client_setup_options_update ON client_setup_options;
CREATE POLICY client_setup_options_update ON client_setup_options
  FOR UPDATE USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));
DROP TRIGGER IF EXISTS set_updated_at ON client_setup_options;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON client_setup_options
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS agency_pixel_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  visitor_id TEXT NOT NULL,
  page_url TEXT NOT NULL,
  referrer TEXT,
  attribution JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agency_pixel_visits_account_time
  ON agency_pixel_visits(account_id, created_at DESC);
ALTER TABLE agency_pixel_visits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agency_pixel_visits_select ON agency_pixel_visits;
CREATE POLICY agency_pixel_visits_select ON agency_pixel_visits
  FOR SELECT USING (in_active_account(account_id));
-- INSERT fica exclusivo do service role pela rota publica de coleta.
