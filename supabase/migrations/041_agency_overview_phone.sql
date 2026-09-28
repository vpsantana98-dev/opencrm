-- ============================================================
-- 041_agency_overview_phone.sql — número conectado no hub de clientes
--
-- A página Clientes mostrava só "WhatsApp on/off". Agora devolve também
-- o NÚMERO conectado (Evolution), pra dar pra ver/rotular qual número é
-- de qual cliente. Coluna nova: whatsapp_phone (null se não conectado ou
-- se for Meta, que não guarda o número de exibição aqui).
--
-- DROP + CREATE porque muda a assinatura de TABLE.
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
  whatsapp_connected BOOLEAN,
  whatsapp_phone TEXT
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
    (
      EXISTS (
        SELECT 1 FROM whatsapp_config w
        WHERE w.account_id = a.id AND w.status = 'connected'
      )
      OR EXISTS (
        SELECT 1 FROM evolution_instances e
        WHERE e.account_id = a.id AND e.status = 'connected'
      )
    ),
    (SELECT e.phone FROM evolution_instances e
       WHERE e.account_id = a.id AND e.status = 'connected'
       LIMIT 1)
  FROM accounts a
  JOIN account_members m ON m.account_id = a.id
  WHERE m.user_id = auth.uid()
  ORDER BY a.name;
$$;

ALTER FUNCTION public.agency_overview() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.agency_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agency_overview() TO authenticated;
