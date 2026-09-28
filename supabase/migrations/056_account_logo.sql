-- ============================================================
-- 056_account_logo.sql — logo do cliente.
--
-- A tabela `accounts` só tinha id/name/owner/currency. Numa agência com
-- dezenas de clientes, a lista vira uma coluna de textos parecidos —
-- a logo é o que faz reconhecer o cliente de relance, antes de ler.
--
-- Guarda a URL pública, não o arquivo: o binário vai para o bucket
-- `avatars`, que já existe, já é público e já tem limite de 2 MB com
-- lista de tipos de imagem. Reusar evita criar um segundo bucket com
-- outra política para o mesmo tipo de conteúdo.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

COMMENT ON COLUMN accounts.logo_url IS
  'URL pública da logo do cliente (bucket avatars). NULL = usa a inicial do nome.';

-- ------------------------------------------------------------
-- `agency_overview` passa a devolver a logo.
--
-- É a fonte da tela de Clientes, que é exatamente onde a logo mais
-- serve: uma lista de cartões parecidos, onde a marca resolve o
-- reconhecimento antes da leitura. Sem incluir aqui, a coluna existiria
-- e a tela principal continuaria sem mostrá-la.
--
-- Precisa de DROP antes do CREATE: mudar a assinatura de RETURNS TABLE
-- não é permitido por CREATE OR REPLACE. O corpo é o mesmo da 041, com
-- `a.logo_url` acrescentado no fim — manter a ordem das colunas
-- existentes é obrigatório, senão o cliente que lê por posição
-- embaralha os valores.
-- ------------------------------------------------------------
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
  whatsapp_phone TEXT,
  logo_url TEXT
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
       LIMIT 1),
    a.logo_url
  FROM accounts a
  JOIN account_members m ON m.account_id = a.id
  WHERE m.user_id = auth.uid()
  ORDER BY a.name;
$$;
