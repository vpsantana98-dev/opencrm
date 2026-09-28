-- ============================================================
-- 050_conversation_clickup_ref.sql — conexão ClickUp por API (modo ag�ncia)
--
-- Substitui o "colar link" (clickup_list_id da 047) por uma referência
-- escolhida via API: a "operação do cliente" pode ser uma PASTA (Folder,
-- várias listas) ou uma LISTA (List). Guardamos tipo + id + nome, e o
-- card agrega as tarefas abertas conforme o tipo.
--
--   clickup_ref_type → 'folder' | 'list'
--   clickup_ref_id   → id da pasta/lista no ClickUp
--   clickup_ref_name → nome (pra mostrar sem nova ida à API)
--
-- clickup_list_id/clickup_url (047) ficam como legado — GET ainda lê
-- clickup_list_id como 'list' se a referência nova não estiver setada.
-- Aditivo e idempotente.
-- ============================================================
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS clickup_ref_type TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS clickup_ref_id TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS clickup_ref_name TEXT;
