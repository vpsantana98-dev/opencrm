-- ============================================================
-- 033_scope_reads_to_active_account.sql — per-client view scoping
--
-- After 031 a user can belong to MANY accounts (agency + clients).
-- Membership RLS (is_account_member) correctly lets them TOUCH any of
-- their accounts — that's the security boundary, and it's proven. But
-- the per-client VIEWS (inbox list, contacts, pipelines, dashboard)
-- were written to rely on RLS for scoping, so with multi-account they
-- would now show EVERY client's rows mixed together.
--
-- This migration narrows the SELECT policies of the parent data tables
-- to ALSO require the row's account to be the user's ACTIVE workspace
-- (profiles.active_account_id, resolved server-side in setActiveAccount
-- and use-auth). This is strictly MORE restrictive than membership —
-- it can never widen access, only narrow it to the selected client —
-- so the isolation proof from 031 still holds.
--
-- Scope of THIS migration (deliberately minimal + low-risk):
--   - Only the 017 PARENT data tables' *_select policies change. Parents
--     carry account_id directly, and 017 gave them per-command policies
--     (no FOR ALL), so swapping just _select is clean and can't affect
--     writes.
--   - Writes (insert/update/delete) stay membership-based: the app only
--     ever writes to the active account anyway (server context), and
--     keeping writes on is_account_member avoids touching those policies.
--   - Child tables (messages, pipeline_stages, …) and the later tables
--     (notifications, api_keys, ai_*, …) stay membership-scoped for now.
--     They're either accessed via an already-scoped parent, or a
--     follow-up. Any residual mixing there is cosmetic, never a leak.
--
-- Accounts / account_members / profiles are intentionally NOT touched —
-- the workspace switcher must still read ALL the user's memberships.
--
-- Idempotent — DROP POLICY IF EXISTS before each CREATE.
-- ============================================================

-- ------------------------------------------------------------
-- in_active_account(target): membership AND target is the active
-- workspace. COALESCE falls back to the home account so a user whose
-- active pointer is somehow null still sees their own data (defensive;
-- 031 backfills active_account_id for everyone).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION in_active_account(target_account_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_account_member(target_account_id)
     AND target_account_id = (
       SELECT COALESCE(p.active_account_id, p.account_id)
       FROM profiles p
       WHERE p.user_id = auth.uid()
     );
$$;

ALTER FUNCTION in_active_account(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION in_active_account(UUID) TO authenticated, service_role;

-- ------------------------------------------------------------
-- Swap parent-table SELECT policies: is_account_member → in_active_account
-- ------------------------------------------------------------
DROP POLICY IF EXISTS contacts_select ON contacts;
CREATE POLICY contacts_select ON contacts FOR SELECT USING (in_active_account(account_id));

DROP POLICY IF EXISTS tags_select ON tags;
CREATE POLICY tags_select ON tags FOR SELECT USING (in_active_account(account_id));

DROP POLICY IF EXISTS custom_fields_select ON custom_fields;
CREATE POLICY custom_fields_select ON custom_fields FOR SELECT USING (in_active_account(account_id));

DROP POLICY IF EXISTS contact_notes_select ON contact_notes;
CREATE POLICY contact_notes_select ON contact_notes FOR SELECT USING (in_active_account(account_id));

DROP POLICY IF EXISTS conversations_select ON conversations;
CREATE POLICY conversations_select ON conversations FOR SELECT USING (in_active_account(account_id));

DROP POLICY IF EXISTS whatsapp_config_select ON whatsapp_config;
CREATE POLICY whatsapp_config_select ON whatsapp_config FOR SELECT USING (in_active_account(account_id));

DROP POLICY IF EXISTS message_templates_select ON message_templates;
CREATE POLICY message_templates_select ON message_templates FOR SELECT USING (in_active_account(account_id));

DROP POLICY IF EXISTS pipelines_select ON pipelines;
CREATE POLICY pipelines_select ON pipelines FOR SELECT USING (in_active_account(account_id));

DROP POLICY IF EXISTS deals_select ON deals;
CREATE POLICY deals_select ON deals FOR SELECT USING (in_active_account(account_id));

DROP POLICY IF EXISTS broadcasts_select ON broadcasts;
CREATE POLICY broadcasts_select ON broadcasts FOR SELECT USING (in_active_account(account_id));

DROP POLICY IF EXISTS automations_select ON automations;
CREATE POLICY automations_select ON automations FOR SELECT USING (in_active_account(account_id));

DROP POLICY IF EXISTS automation_logs_select ON automation_logs;
CREATE POLICY automation_logs_select ON automation_logs FOR SELECT USING (in_active_account(account_id));

DROP POLICY IF EXISTS flows_select ON flows;
CREATE POLICY flows_select ON flows FOR SELECT USING (in_active_account(account_id));

DROP POLICY IF EXISTS flow_runs_select ON flow_runs;
CREATE POLICY flow_runs_select ON flow_runs FOR SELECT USING (in_active_account(account_id));
