-- ============================================================
-- 038_delete_workspace_rpc.sql — excluir cliente (workspace)
--
-- Permite a agência excluir um workspace de cliente. SECURITY DEFINER
-- porque accounts não tem policy de DELETE para o cliente (criação e
-- remoção passam por RPC controlada).
--
-- Regras:
--   - só o DONO (owner_user_id) exclui;
--   - NÃO pode excluir a própria conta "home" (a conta pessoal da
--     agência, profiles.account_id) — evita a agência se apagar;
--   - o DELETE em accounts cascateia contatos, conversas, funis,
--     evolution_instances, etc. (ON DELETE CASCADE). O
--     active_account_id de quem estava nela vira NULL (ON DELETE SET
--     NULL) e o getCurrentAccount cai de volta na home.
--
-- A instância na Evolution (servidor) é apagada pela rota da API ANTES
-- de chamar isto (senão perderíamos o instance_name no cascade).
-- ============================================================
CREATE OR REPLACE FUNCTION public.delete_workspace(
  p_account_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_owner UUID;
  v_home UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT owner_user_id INTO v_owner FROM accounts WHERE id = p_account_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Workspace not found' USING ERRCODE = '22023';
  END IF;
  IF v_owner <> v_uid THEN
    RAISE EXCEPTION 'Só o dono pode excluir este cliente' USING ERRCODE = '42501';
  END IF;

  SELECT account_id INTO v_home FROM profiles WHERE user_id = v_uid;
  IF p_account_id = v_home THEN
    RAISE EXCEPTION 'Não é possível excluir a sua conta principal' USING ERRCODE = '23514';
  END IF;

  DELETE FROM accounts WHERE id = p_account_id;
END;
$$;

ALTER FUNCTION public.delete_workspace(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.delete_workspace(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_workspace(UUID) TO authenticated;
