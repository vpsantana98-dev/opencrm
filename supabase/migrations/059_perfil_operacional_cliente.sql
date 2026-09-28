-- ============================================================
-- 059_perfil_operacional_cliente.sql — o que o cadastro ainda não perguntava.
--
-- Quatro respostas que a agência já tem na cabeça no momento do
-- cadastro e que o sistema descobria tarde, errado, ou nunca:
--
--   1. de que ramo é o cliente;
--   2. quem tem o celular na mão para parear o WhatsApp;
--   3. onde esse cliente anuncia;
--   4. se as conversas de grupo entram no CRM.
--
-- Todas são NULL/padrão para os clientes que já existem: nenhuma
-- mudança de comportamento para quem já está operando.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Segmento.
--
-- Texto livre, não uma lista fechada. Uma agência atende do dentista à
-- transportadora, e uma lista fixa sempre falta justo o ramo do cliente
-- novo — a pessoa acaba escolhendo "Outro" e o dado morre. A interface
-- sugere os mais comuns e aceita qualquer coisa.
-- ------------------------------------------------------------
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS segment TEXT;

COMMENT ON COLUMN accounts.segment IS
  'Ramo do cliente ("Odontologia", "Imobiliária"). Texto livre; vira filtro na tela de Clientes.';

-- ------------------------------------------------------------
-- 2. Quem conecta o WhatsApp.
--
-- Muda o caminho do assistente: com o aparelho na mão, o QR aqui é o
-- caminho curto; sem ele, o que serve é o link para mandar ao
-- responsável. Hoje o assistente oferece os dois com o mesmo peso e a
-- pessoa erra o caminho na metade das vezes.
-- ------------------------------------------------------------
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS whatsapp_owner TEXT
    CHECK (whatsapp_owner IN ('agencia', 'cliente'));

COMMENT ON COLUMN accounts.whatsapp_owner IS
  'Quem tem o celular para parear: agencia (QR na hora) ou cliente (link enviado). NULL = não perguntado.';

-- ------------------------------------------------------------
-- 3. Onde o cliente anuncia.
--
-- Array e não uma coluna por plataforma: acrescentar TikTok depois vira
-- um valor novo, não uma migration de schema. O padrão é vazio, que a
-- interface trata como "ainda não disse" e continua mostrando tudo.
-- ------------------------------------------------------------
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS ad_platforms TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN accounts.ad_platforms IS
  'Plataformas onde o cliente anuncia: {meta,google}. Vazio = não perguntado; o assistente mostra todas.';

-- ------------------------------------------------------------
-- 4. Quais conversas guardar.
--
-- 'todas' mantém o comportamento atual. 'sem_grupos' faz o webhook
-- descartar mensagem de grupo ANTES de gravar.
--
-- Não é preferência de tela: para muitos clientes os grupos são
-- conversa interna que só polui o inbox e infla o banco, e ninguém quer
-- que o time de atendimento tropece nelas.
--
-- Vale só para o que chegar DEPOIS: nada é apagado retroativamente.
-- ------------------------------------------------------------
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS conversation_scope TEXT NOT NULL DEFAULT 'todas'
    CHECK (conversation_scope IN ('todas', 'sem_grupos'));

COMMENT ON COLUMN accounts.conversation_scope IS
  'todas = grava tudo; sem_grupos = descarta mensagens de grupo na entrada. Não afeta o que já foi gravado.';

-- ------------------------------------------------------------
-- `agency_overview` passa a devolver o segmento e QUANTOS números.
--
-- O segmento é o que permite filtrar a tela de Clientes por ramo.
--
-- A contagem de números existe por causa da 058: a coluna
-- `whatsapp_phone` faz `LIMIT 1`, então um cliente com Vendas e Suporte
-- mostra um telefone só e nada indica que existe outro. Um número
-- caído passaria despercebido atrás de um número no ar.
--
-- Precisa de DROP antes do CREATE: mudar a assinatura de RETURNS TABLE
-- não é permitido por CREATE OR REPLACE. O corpo é o da 056 com duas
-- colunas no FIM — a ordem das existentes não muda, senão quem lê por
-- posição embaralha os valores.
--
-- `SET search_path = public` mantido da 055: sem ele, uma função
-- SECURITY DEFINER pode ser induzida a resolver nomes num schema
-- plantado pelo chamador.
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
  logo_url TEXT,
  segment TEXT,
  whatsapp_numbers BIGINT,
  -- Os outros três do perfil vêm junto para o assistente REABRIR
  -- preenchido na edição. Sem eles, editar um cliente mostraria as
  -- respostas padrão e um "salvar" descuidado apagaria o que foi
  -- respondido no cadastro.
  whatsapp_owner TEXT,
  ad_platforms TEXT[],
  conversation_scope TEXT
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
    -- O telefone do número PADRÃO quando ele está no ar; senão, de
    -- qualquer um conectado. Antes era só `LIMIT 1` sem ordem, o que
    -- com vários números mostrava um telefone aleatório.
    (SELECT e.phone FROM evolution_instances e
       WHERE e.account_id = a.id AND e.status = 'connected'
       ORDER BY e.is_default DESC, e.created_at
       LIMIT 1),
    a.logo_url,
    a.segment,
    (SELECT count(*) FROM evolution_instances e WHERE e.account_id = a.id),
    a.whatsapp_owner,
    a.ad_platforms,
    a.conversation_scope
  FROM accounts a
  JOIN account_members m ON m.account_id = a.id
  WHERE m.user_id = auth.uid()
  ORDER BY a.name;
$$;

ALTER FUNCTION public.agency_overview() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.agency_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agency_overview() TO authenticated;
