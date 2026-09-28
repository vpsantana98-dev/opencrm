-- ============================================================
-- 040_proxies.sql — pool de proxies das instâncias Evolution
--
-- Por que existe:
--   A Evolution (Baileys) conecta a partir da NOSSA VPS, então o IP
--   dela é o IP da sessão do número. Hoje todas as instâncias saem
--   pelo mesmo IP de datacenter, que é o padrão mais fácil de o
--   WhatsApp detectar. Esta tabela guarda o pool de proxies móveis
--   que cada instância usa para sair por um IP próprio.
--
-- Escopo: GLOBAL da agência, não por conta. É o que permite ratear
--   3 a 5 instâncias por IP móvel, que é o modelo de custo escolhido.
--
-- Segurança: RLS fail-closed. Ninguém lê esta tabela pelo browser,
--   nem owner. Todo acesso passa por rota server-side com service
--   role. A senha fica cifrada em AES-256-GCM com ENCRYPTION_KEY,
--   igual aos tokens da Meta.
--
-- Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS proxies (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  label                 TEXT NOT NULL,
  kind                  TEXT NOT NULL DEFAULT 'mobile'
                          CHECK (kind IN ('mobile', 'isp', 'residential')),
  protocol              TEXT NOT NULL DEFAULT 'http'
                          CHECK (protocol IN ('http', 'socks5')),
  host                  TEXT NOT NULL,
  port                  INTEGER NOT NULL CHECK (port > 0 AND port <= 65535),
  username              TEXT,
  password_encrypted    TEXT,
  -- 'BR-SP', 'BR-RJ'. Usado para casar o IP com o DDD do número.
  region                TEXT,
  max_instances         INTEGER NOT NULL DEFAULT 4 CHECK (max_instances > 0),
  status                TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'degraded', 'disabled')),
  consecutive_failures  INTEGER NOT NULL DEFAULT 0,
  last_check_at         TIMESTAMPTZ,
  last_exit_ip          TEXT,
  last_latency_ms       INTEGER,
  -- Endpoint de rotação do provedor (proxy móvel), opcional.
  rotate_url            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE proxies ENABLE ROW LEVEL SECURITY;

-- Fail-closed: nenhuma role de cliente (anon/authenticated) enxerga
-- esta tabela. O service role ignora RLS, que é como as rotas
-- server-side acessam.
DROP POLICY IF EXISTS proxies_no_client_access ON proxies;
CREATE POLICY proxies_no_client_access ON proxies
  FOR ALL USING (false) WITH CHECK (false);

DROP TRIGGER IF EXISTS set_updated_at ON proxies;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON proxies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Vínculo instância -> proxy. ON DELETE SET NULL para que remover um
-- proxy do pool não apague a instância do cliente; ela fica órfã e a
-- rota de saúde sinaliza.
ALTER TABLE evolution_instances
  ADD COLUMN IF NOT EXISTS proxy_id UUID REFERENCES proxies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_evolution_instances_proxy
  ON evolution_instances(proxy_id);
