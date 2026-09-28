-- ============================================================
-- 049_conversation_card_fields.sql — campos do card do cliente (modo ag�ncia)
--
-- Fase 2c. Enriquecem o painel do ClickUp no inbox:
--   conversations.health    → saúde da conta, campo do CRM (o ClickUp não
--                             tem esse conceito nativo). Valores livres,
--                             a UI usa: 'estavel' | 'monitoramento' | 'churn'.
--   conversations.cs_owner  → responsável (CS). Por padrão o painel mostra
--                             os assignees das tarefas do ClickUp; se este
--                             override estiver preenchido, ele prevalece
--                             (é o "editável no CRM").
--
-- Aditivo e idempotente.
-- ============================================================
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS health TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS cs_owner TEXT;
