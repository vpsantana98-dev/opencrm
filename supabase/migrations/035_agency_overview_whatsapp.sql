-- ============================================================
-- 035_agency_overview_whatsapp.sql — add WhatsApp status per client
--
-- The "Clientes" hub page needs to show, per client, whether that
-- client's WhatsApp is connected — the whole point of the agency
-- model is each client having its own number. Extends agency_overview
-- (034) with a `whatsapp_connected` flag.
--
-- Return type changes (new column), so DROP + CREATE rather than
-- CREATE OR REPLACE. Still SECURITY DEFINER + membership-scoped —
-- never leaks another agency's data.
-- ============================================================
DROP FUNCTION IF EXISTS public.agency_overview();

CREATE FUNCTION public.agency_overview()
RETURNS TABLE (
  account_id UUID,
  account_name TEXT,
  contacts BIGINT,
  open_conversations BIGINT,
  open_deals BIGINT,
  open_deal_value NUMERIC,
  whatsapp_connected BOOLEAN
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
       WHERE d.account_id = a.id AND d.status = 'open'),
    EXISTS (
      SELECT 1 FROM whatsapp_config w
      WHERE w.account_id = a.id AND w.status = 'connected'
    )
  FROM accounts a
  JOIN account_members m ON m.account_id = a.id
  WHERE m.user_id = auth.uid()
  ORDER BY a.name;
$$;

ALTER FUNCTION public.agency_overview() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.agency_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agency_overview() TO authenticated;
