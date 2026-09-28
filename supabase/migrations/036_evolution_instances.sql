-- ============================================================
-- 036_evolution_instances.sql — WhatsApp via Evolution (não-oficial)
--
-- Primeiro passo do provedor Evolution (QR code). Cada conta (cliente)
-- pode ter UMA instância Evolution (uma conexão de WhatsApp Web). A
-- Evolution dedicada ao CRM é global (uma API serve todas as
-- instâncias); aqui guardamos, por conta, o nome da instância e o
-- status da conexão.
--
-- Não mexe em whatsapp_config (Meta) — os dois provedores coexistem.
-- A escolha de provedor por conta fica implícita: se existe uma
-- evolution_instances conectada, o cliente usa Evolution; senão, Meta.
--
-- Idempotente.
-- ============================================================
CREATE TABLE IF NOT EXISTS evolution_instances (
  account_id    UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  instance_name TEXT NOT NULL UNIQUE,
  -- created | connecting | connected | disconnected
  status        TEXT NOT NULL DEFAULT 'created',
  phone         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE evolution_instances ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON evolution_instances;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON evolution_instances
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_evolution_instances_name
  ON evolution_instances(instance_name);

-- RLS: leitura escopada à conta ativa (como as demais views); escrita
-- por admin+ do dono. O webhook da Evolution roda com service role e
-- ignora RLS para atualizar status/telefone.
DROP POLICY IF EXISTS evolution_instances_select ON evolution_instances;
CREATE POLICY evolution_instances_select ON evolution_instances FOR SELECT
  USING (in_active_account(account_id));

DROP POLICY IF EXISTS evolution_instances_insert ON evolution_instances;
CREATE POLICY evolution_instances_insert ON evolution_instances FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS evolution_instances_update ON evolution_instances;
CREATE POLICY evolution_instances_update ON evolution_instances FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS evolution_instances_delete ON evolution_instances;
CREATE POLICY evolution_instances_delete ON evolution_instances FOR DELETE
  USING (is_account_member(account_id, 'admin'));
