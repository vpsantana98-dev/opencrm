-- ============================================================
-- 042_redeem_invitation_add_membership.sql — convite ADICIONA (não MOVE)
--
-- O redeem_invitation (019) era do modelo antigo (1 conta por usuário):
-- ele MOVIA o profile pra a conta do convite e APAGAVA a conta pessoal.
-- No multi-conta (031, account_members) isso é bug: um convidado perderia
-- a própria conta, e um membro não pode pertencer a várias.
--
-- Novo comportamento: ADICIONA um vínculo em account_members e deixa o
-- usuário ATIVO na conta que acabou de entrar. Não move, não apaga nada.
-- Isso destrava o acesso scoped (SDRs em vários clientes; cliente no
-- próprio workspace).
--
-- Mesma assinatura (retorna o account_id), então as rotas/telas seguem.
-- ============================================================
CREATE OR REPLACE FUNCTION public.redeem_invitation(
  p_token_hash TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM account_members
    WHERE account_id = v_inv.account_id AND user_id = v_caller_id
  ) THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  -- ADICIONA o vínculo (não move o profile, não apaga a conta pessoal).
  INSERT INTO account_members (account_id, user_id, role)
  VALUES (v_inv.account_id, v_caller_id, v_inv.role)
  ON CONFLICT (account_id, user_id) DO NOTHING;

  -- Deixa o usuário ATIVO na conta que acabou de entrar.
  UPDATE profiles
  SET active_account_id = v_inv.account_id
  WHERE user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  RETURN v_inv.account_id;
END;
$$;

ALTER FUNCTION public.redeem_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated;
