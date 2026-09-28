-- ============================================================
-- 052_lock_profile_privileged_columns.sql — trava colunas de
-- tenancy/privilégio de `profiles` contra escrita do próprio usuário.
--
-- A policy `profiles_update` (017_account_sharing.sql) só checa
-- `auth.uid() = user_id`, sem restrição de COLUNA — o usuário pode
-- trocar o próprio `account_id` pelo cliente do browser. Duas rotas
-- (automations, flows) confiavam nesse valor para escrever com
-- service role, o que abre escrita cross-tenant (ver plano de
-- finalização, Fase 4, Passo 4.1).
--
-- Este trigger fecha a brecha na camada de dados: qualquer UPDATE em
-- profiles que altere uma coluna privilegiada só é aceito quando o
-- autor é o service role (rotas server-side já validam posse antes
-- de escrever essas colunas — ver `getCurrentAccount`/`setActiveAccount`
-- em src/lib/auth/account.ts).
-- ============================================================

CREATE OR REPLACE FUNCTION public.guard_profile_privileged_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  claims text := current_setting('request.jwt.claims', true);
BEGIN
  -- Conexão DIRETA ao banco (psql, migration, reparo do DBA): o PostgREST
  -- é quem preenche `request.jwt.claims`, então a ausência dela significa
  -- que a escrita não veio da API — e quem tem credencial do banco já é
  -- confiável. Sem esta saída, uma migration como a 046 (que faz
  -- `UPDATE profiles SET is_internal = TRUE`) falharia. Verificado em dev.
  IF claims IS NULL OR claims = '' THEN
    RETURN NEW;
  END IF;

  -- service_role escreve livre (rotas server-side já validam posse).
  IF claims::jsonb->>'role' = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF NEW.account_id IS DISTINCT FROM OLD.account_id
     OR NEW.active_account_id IS DISTINCT FROM OLD.active_account_id
     OR NEW.account_role IS DISTINCT FROM OLD.account_role
     OR NEW.is_internal IS DISTINCT FROM OLD.is_internal
     OR NEW.is_client_login IS DISTINCT FROM OLD.is_client_login
     OR NEW.agency_owner_id IS DISTINCT FROM OLD.agency_owner_id
  THEN
    RAISE EXCEPTION 'coluna privilegiada de profiles nao pode ser alterada pelo usuario';
  END IF;
  RETURN NEW;
END $$;

ALTER FUNCTION public.guard_profile_privileged_columns() OWNER TO postgres;

DROP TRIGGER IF EXISTS guard_profile_privileged_columns ON profiles;
CREATE TRIGGER guard_profile_privileged_columns
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privileged_columns();
