-- ============================================================
-- 039_evolution_connect_token.sql — link público de conexão (Portal do Cliente)
--
-- A agência gera um link e manda para o responsável do cliente (que
-- está espalhado pelo país). O cliente abre o link SEM login e escaneia
-- o QR. O link carrega um TOKEN; guardamos só o hash (SHA-256), como nos
-- convites (019), para um vazamento do banco não render links usáveis.
-- O token em si vai na URL e é gerado/retornado uma vez pela API.
--
-- Idempotente.
-- ============================================================
ALTER TABLE evolution_instances
  ADD COLUMN IF NOT EXISTS connect_token_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_evolution_connect_token
  ON evolution_instances(connect_token_hash)
  WHERE connect_token_hash IS NOT NULL;
