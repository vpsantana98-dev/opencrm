-- ============================================================
-- 044_agency_operators.sql — operadores da agência (veem todos os clientes)
--
-- A agência cria logins de OPERADOR (membros da equipe) que enxergam e
-- operam TODOS os clientes, como o dono. Modelo:
--   - profiles.agency_owner_id: marca o usuário como operador de uma
--     agência (o user_id do dono que o criou).
--   - Ao criar um cliente novo (create_workspace), todos os operadores
--     daquele dono entram automaticamente no cliente (como admin), pra
--     não precisar re-conceder acesso a cada cliente novo.
--   - O provisionamento (POST /api/account/team-member) adiciona o
--     operador a todos os clientes ATUAIS do dono.
--
-- Isolamento segue por RLS/account_members; isto só define QUAIS contas o
-- operador é membro.
-- ============================================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS agency_owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_agency_owner
  ON profiles(agency_owner_id) WHERE agency_owner_id IS NOT NULL;

-- create_workspace agora também adiciona os operadores do dono ao cliente
-- recém-criado.
CREATE OR REPLACE FUNCTION public.create_workspace(
  p_name TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_account_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'Workspace name is required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO accounts (name, owner_user_id)
  VALUES (btrim(p_name), v_uid)
  RETURNING id INTO v_account_id;

  INSERT INTO account_members (account_id, user_id, role)
  VALUES (v_account_id, v_uid, 'owner');

  -- Operadores desta agência entram no cliente novo como admin.
  INSERT INTO account_members (account_id, user_id, role)
  SELECT v_account_id, p.user_id, 'admin'
  FROM profiles p
  WHERE p.agency_owner_id = v_uid
  ON CONFLICT (account_id, user_id) DO NOTHING;

  RETURN v_account_id;
END;
$$;

ALTER FUNCTION public.create_workspace(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_workspace(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_workspace(TEXT) TO authenticated;
