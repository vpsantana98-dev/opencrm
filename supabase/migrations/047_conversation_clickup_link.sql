-- ============================================================
-- 047_conversation_clickup_link.sql — mapa conversa ↔ ClickUp (modo ag�ncia)
--
-- Fase 2: cada conversa (grupo do cliente OU privado) pode ser
-- sincronizada MANUALMENTE com uma Lista do ClickUp (o "card do cliente").
-- Repetível: dá pra re-mapear a qualquer momento. O painel do inbox lê
-- as tarefas dessa lista via a chave ClickUp do próprio usuário.
--
-- Guardado direto na conversa (aditivo). clickup_list_id = id da Lista;
-- clickup_url = link pro "Ver no ClickUp".
-- ============================================================
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS clickup_list_id TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS clickup_url TEXT;
