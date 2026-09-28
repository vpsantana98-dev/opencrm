-- ============================================================
-- 031_multi_account_membership.sql — many-to-many membership
--
-- Foundation for the agency multi-tenant model: a single user
-- (an agency operator) can belong to MANY accounts (their client
-- workspaces) and switch between them. Until now membership was
-- one-account-per-user, held on `profiles.account_id` /
-- `profiles.account_role` (migration 017).
--
-- What this migration does
--   1. Introduces `account_members` (user ↔ account, with role) —
--      the new source of truth for membership.
--   2. Backfills it from every existing profile so behaviour is
--      unchanged: each user starts with exactly one membership.
--   3. Rewrites `is_account_member()` to read `account_members`
--      instead of `profiles`. Because EVERY table's RLS goes
--      through this one function, this single change makes the
--      whole isolation layer multi-account-aware. For a user with
--      one membership the result is byte-for-byte identical, so
--      the running app keeps working before any code change ships.
--   4. Adds `profiles.active_account_id` — the workspace the user
--      is currently operating in. Backfilled to their existing
--      account. The SERVER always re-validates membership before
--      trusting it (Phase 2 code); it's a convenience pointer, not
--      an authorization source.
--   5. Updates `handle_new_user` to also seed an `account_members`
--      row and stamp `active_account_id`.
--   6. Drops the one-account-per-owner unique index so a user can
--      own / belong to more than one account.
--
-- What this migration deliberately keeps
--   - `profiles.account_id` / `account_role` stay for backward
--     compatibility: `getCurrentAccount()` still reads them until
--     Phase 2 switches to active_account_id + account_members.
--     They now represent the user's "home" (personal) account.
--   - The invitation redeem RPC (019) still MOVES the user; the
--     switch to ADD-a-membership is Phase 5. Backfill + trigger
--     below keep account_members consistent with profiles in the
--     meantime.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- ACCOUNT_MEMBERS — the many-to-many source of truth
-- ============================================================
CREATE TABLE IF NOT EXISTS account_members (
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       account_role_enum NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_account_members_user ON account_members(user_id);
CREATE INDEX IF NOT EXISTS idx_account_members_account ON account_members(account_id);

ALTER TABLE account_members ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- BACKFILL — one membership per existing profile
--
-- Every profile row (post-017 every user has exactly one) becomes
-- an account_members row with the same role. ON CONFLICT keeps the
-- migration re-runnable.
-- ============================================================
INSERT INTO account_members (account_id, user_id, role)
SELECT p.account_id, p.user_id, p.account_role
FROM profiles p
WHERE p.account_id IS NOT NULL
  AND p.account_role IS NOT NULL
ON CONFLICT (account_id, user_id) DO NOTHING;

-- ============================================================
-- REWRITE is_account_member — read account_members
--
-- Same signature, same semantics (role hierarchy owner > admin >
-- agent > viewer). SECURITY DEFINER + owner = postgres means the
-- SELECT below bypasses account_members' own RLS, so there is no
-- recursive policy evaluation (identical trick to the 017 version
-- that read `profiles`).
-- ============================================================
CREATE OR REPLACE FUNCTION is_account_member(
  target_account_id UUID,
  min_role account_role_enum DEFAULT 'viewer'
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM account_members m
    WHERE m.user_id = auth.uid()
      AND m.account_id = target_account_id
      AND CASE m.role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
        >=
          CASE min_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
  );
$$;

ALTER FUNCTION is_account_member(UUID, account_role_enum) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION is_account_member(UUID, account_role_enum) TO authenticated, service_role;

-- ============================================================
-- RLS — account_members
--
-- A member may read the membership rows of any account they belong
-- to (so the Members tab and the "my workspaces" switcher can
-- render). All writes go through SECURITY DEFINER RPCs / the
-- service role — never a direct client mutation — so there is no
-- INSERT/UPDATE/DELETE policy.
-- ============================================================
DROP POLICY IF EXISTS account_members_select ON account_members;
CREATE POLICY account_members_select ON account_members FOR SELECT
  USING (user_id = auth.uid() OR is_account_member(account_id));

-- ============================================================
-- profiles.active_account_id — the currently-selected workspace
-- ============================================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS active_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL;

-- Backfill to the user's existing account for everyone not yet set.
UPDATE profiles
SET active_account_id = account_id
WHERE active_account_id IS NULL
  AND account_id IS NOT NULL;

-- ============================================================
-- Drop one-account-per-owner — a user may now own/belong to many
-- ============================================================
DROP INDEX IF EXISTS idx_accounts_one_per_owner;

-- ============================================================
-- SIGNUP TRIGGER — also seed account_members + active_account_id
--
-- New signups still get a fresh personal account (owner). Now we
-- also write the matching account_members row and point
-- active_account_id at it.
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_account_id UUID;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id)
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role, active_account_id)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner', v_account_id);

  INSERT INTO public.account_members (account_id, user_id, role)
  VALUES (v_account_id, NEW.id, 'owner')
  ON CONFLICT (account_id, user_id) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

-- Trigger already exists from 017; recreated defensively in case
-- this migration runs against a DB where it was dropped.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
