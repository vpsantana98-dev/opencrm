-- ============================================================
-- 032_create_workspace_rpc.sql — agency "create client workspace"
--
-- Part of the multi-tenant agency model (Phase 4). Lets an authed
-- user spin up a NEW account (a client workspace) and become its
-- owner in one atomic step. Accounts have no client-side INSERT
-- policy (creation was trigger/RPC-only since 017), so this
-- SECURITY DEFINER RPC is the sanctioned path — mirroring the
-- invitation RPCs in 018/019.
--
-- The caller becomes 'owner' of the new workspace via account_members
-- (the 031 source of truth). Their active workspace is NOT changed
-- here; the API route switches to it explicitly so the redirect is
-- controlled client-side.
--
-- Idempotent to re-create (CREATE OR REPLACE); each CALL creates a
-- new workspace by design.
-- ============================================================
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

  RETURN v_account_id;
END;
$$;

ALTER FUNCTION public.create_workspace(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_workspace(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_workspace(TEXT) TO authenticated;
