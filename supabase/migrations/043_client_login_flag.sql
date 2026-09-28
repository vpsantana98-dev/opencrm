-- ============================================================
-- 043_client_login_flag.sql — login "de cliente" (portal scoped)
--
-- Marca um usuário como login de CLIENTE (não da agência). A agência cria
-- esse login (via /api/account/client-access) já vinculado só ao workspace
-- do cliente e com este flag. O app usa o flag para ESCONDER as telas de
-- agência (hub Clientes, seletor de workspace, "Novo cliente") — dando ao
-- cliente a sensação de um CRM só dele.
--
-- Importante: isto é só cosmético/UX. O isolamento de verdade é o RLS por
-- account_members (o cliente só é membro do workspace dele, então só vê os
-- dados dele). Nenhuma segurança depende deste flag.
-- ============================================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_client_login BOOLEAN NOT NULL DEFAULT FALSE;
