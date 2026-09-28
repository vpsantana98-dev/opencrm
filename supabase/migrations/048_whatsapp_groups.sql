-- ============================================================
-- 048_whatsapp_groups.sql — grupos do WhatsApp no inbox (modo ag�ncia)
--
-- Fase 2b: cada GRUPO do WhatsApp (jid @g.us) vira um "contato" marcado
-- is_group, com a conversa normal (1 por account+contato). Assim o grupo
-- aparece no inbox como qualquer conversa e pode ser mapeado ao ClickUp.
--
--   contacts.is_group  → distingue grupo de contato 1:1.
--   contacts.wa_jid    → o jid do grupo (ex.: 12036...@g.us). phone recebe
--                        o mesmo jid só pra satisfazer o NOT NULL; a chave
--                        real do grupo é wa_jid (índice único por conta).
--   messages.sender_name → quem falou DENTRO do grupo (pushName do
--                        participante), pra thread mostrar o autor.
--
-- Aditivo e idempotente.
-- ============================================================
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_group BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS wa_jid TEXT;

-- Um contato-grupo por conta (identidade real do grupo).
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_wa_jid
  ON contacts (account_id, wa_jid)
  WHERE wa_jid IS NOT NULL;

ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_name TEXT;
