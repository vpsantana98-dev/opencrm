-- ============================================================
-- 034_agency_overview_rpc.sql — cross-client agency dashboard
--
-- The per-client views are now scoped to the ACTIVE workspace (033),
-- so a normal query only ever sees one client. The agency "painel
-- geral" needs the opposite: key metrics for EVERY client the user
-- manages, side by side.
--
-- agency_overview() is SECURITY DEFINER so it can read across the
-- active-account RLS, but it is still scoped to membership — the
-- JOIN account_members WHERE user_id = auth.uid() guarantees it only
-- ever returns the caller's own client workspaces. It can never leak
-- another agency's data.
--
-- One row per client with the headline numbers; the page sums them
-- for the top-line totals and lists the per-client breakdown.
--
-- Idempotent (CREATE OR REPLACE).
-- ============================================================
CREATE OR REPLACE FUNCTION public.agency_overview()
RETURNS TABLE (
  account_id UUID,
  account_name TEXT,
  contacts BIGINT,
  open_conversations BIGINT,
  open_deals BIGINT,
  open_deal_value NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.id,
    a.name,
    (SELECT count(*) FROM contacts c WHERE c.account_id = a.id),
    (SELECT count(*) FROM conversations cv
       WHERE cv.account_id = a.id AND cv.status = 'open'),
    (SELECT count(*) FROM deals d
       WHERE d.account_id = a.id AND d.status = 'open'),
    (SELECT COALESCE(sum(d.value), 0) FROM deals d
       WHERE d.account_id = a.id AND d.status = 'open')
  FROM accounts a
  JOIN account_members m ON m.account_id = a.id
  WHERE m.user_id = auth.uid()
  ORDER BY a.name;
$$;

ALTER FUNCTION public.agency_overview() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.agency_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agency_overview() TO authenticated;
