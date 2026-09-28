-- ============================================================
-- 055_fix_profile_guard_cascade.sql — conserta o gatilho da 052, que
-- estava bloqueando as cascatas de chave estrangeira.
--
-- SINTOMA: excluir um cliente falhava com
--   "coluna privilegiada de profiles nao pode ser alterada pelo usuario"
--
-- CAUSA: `delete_workspace` faz `DELETE FROM accounts`. A constraint
-- `profiles_active_account_id_fkey` é ON DELETE SET NULL, então o
-- PRÓPRIO BANCO zera `profiles.active_account_id` de quem estava naquela
-- conta. Isso dispara o BEFORE UPDATE da 052, que via uma coluna
-- privilegiada mudando com JWT de usuário comum e abortava a transação
-- inteira — levando junto o DELETE.
--
-- O mesmo valia para `agency_owner_id`, que também é ON DELETE SET NULL:
-- apagar um usuário-agência quebraria pelo mesmo motivo. Defeito latente,
-- corrigido junto.
--
-- CORREÇÃO: permitir a transição para NULL nessas duas colunas.
--
-- Por que isso NÃO reabre a brecha que a 052 fechou: o ataque era o
-- usuário APONTAR o próprio perfil para OUTRA conta, para então escrever
-- lá com as rotas que confiavam nesse valor. Isso exige um valor
-- não-nulo. Ir para NULL só remove acesso — nunca concede. Verificado
-- também que `agency_owner_id` não participa de nenhuma RLS policy (zero
-- ocorrências em pg_policies) e que, no código, o nulo faz o usuário cair
-- de volta em si mesmo como dono.
--
-- As demais colunas (account_id, account_role, is_internal,
-- is_client_login) seguem bloqueadas para QUALQUER mudança, inclusive
-- para NULL: `is_client_login`, em particular, RESTRINGE acesso, então
-- zerá-lo seria escalada.
-- ============================================================

CREATE OR REPLACE FUNCTION public.guard_profile_privileged_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  claims text := current_setting('request.jwt.claims', true);
BEGIN
  -- Conexão DIRETA ao banco (psql, migration, reparo do DBA): o PostgREST
  -- é quem preenche `request.jwt.claims`, então a ausência dela significa
  -- que a escrita não veio da API — e quem tem credencial do banco já é
  -- confiável.
  IF claims IS NULL OR claims = '' THEN
    RETURN NEW;
  END IF;

  -- service_role escreve livre (rotas server-side já validam posse).
  IF claims::jsonb->>'role' = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF (NEW.active_account_id IS DISTINCT FROM OLD.active_account_id
        AND NEW.active_account_id IS NOT NULL)
     OR (NEW.agency_owner_id IS DISTINCT FROM OLD.agency_owner_id
        AND NEW.agency_owner_id IS NOT NULL)
     OR NEW.account_id IS DISTINCT FROM OLD.account_id
     OR NEW.account_role IS DISTINCT FROM OLD.account_role
     OR NEW.is_internal IS DISTINCT FROM OLD.is_internal
     OR NEW.is_client_login IS DISTINCT FROM OLD.is_client_login
  THEN
    RAISE EXCEPTION 'coluna privilegiada de profiles nao pode ser alterada pelo usuario';
  END IF;
  RETURN NEW;
END $$;

ALTER FUNCTION public.guard_profile_privileged_columns() OWNER TO postgres;

-- O gatilho da 052 continua válido e apontando para esta função; o
-- CREATE OR REPLACE acima já troca o corpo. Recriado mesmo assim para a
-- migration ser auto-suficiente se rodar num banco sem a 052.
DROP TRIGGER IF EXISTS guard_profile_privileged_columns ON profiles;
CREATE TRIGGER guard_profile_privileged_columns
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privileged_columns();
