-- ============================================================
-- 058_multiplas_instancias.sql — vários números de WhatsApp por cliente.
--
-- Hoje `evolution_instances` tem `account_id` como CHAVE PRIMÁRIA, ou
-- seja: um número por cliente, garantido pela estrutura. Esta migration
-- troca a chave e ensina as conversas a saber de QUAL número elas são.
--
-- Verificado antes de mexer: nenhuma outra tabela referencia
-- `evolution_instances` (zero constraints em pg_constraint apontando
-- para ela), então trocar a PK não quebra vínculo nenhum.
--
-- ATENÇÃO — leia antes de aplicar. Duas coisas diferentes quebram:
--
-- 1. GERAR QR, se o código ainda tiver `onConflict: "account_id"` no
--    /connect. `onConflict` EXIGE índice único, e é justamente esse
--    índice que a troca de chave primária abaixo remove. Isto ACONTECEU
--    em produção: a migration foi aplicada com o código antigo e o
--    Postgres passou a recusar o ON CONFLICT antes de chamar a
--    Evolution. O conserto foi trocar para `onConflict: "instance_name"`
--    (que continua UNIQUE); depois disso a parte 2 removeu o upsert
--    inteiro, e conectar virou uma escolha explícita de qual número.
--
-- 2. ENVIAR, se alguém conectar um SEGUNDO número antes da parte 2. As
--    rotas liam a instância com `.maybeSingle()` filtrando por
--    `account_id`, e `.maybeSingle()` ERRA com mais de uma linha —
--    derrubando o envio da conta inteira, não só daquele número.
--
-- (Este aviso está na terceira versão. A primeira dizia que dava para
-- aplicar sem cuidado. A segunda acertou o problema do `onConflict`. A
-- terceira — esta não, a anterior — disse que eu havia errado, porque
-- li o `main` DEPOIS do hotfix e não percebi que ele era recente. O
-- aviso original estava certo: o QR quebrou de verdade.)

-- ============================================================

-- ------------------------------------------------------------
-- 1. Chave primária própria.
--
-- `account_id` vira coluna comum, com índice — ela continua sendo o
-- filtro mais usado ("os números deste cliente").
-- ------------------------------------------------------------
ALTER TABLE evolution_instances
  ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT uuid_generate_v4();

-- Só derruba a chave se ela ainda for a ANTIGA (em `account_id`).
--
-- Correção: a versão anterior fazia `DROP CONSTRAINT IF EXISTS` direto.
-- O `IF EXISTS` só protege contra a constraint não existir — não contra
-- ela já ser a NOVA. Rodando a migration uma segunda vez, isso tentava
-- derrubar a chave em `id`, da qual `conversations.instance_id` já
-- depende, e o Postgres recusava:
--
--   cannot drop constraint evolution_instances_pkey ... because other
--   objects depend on it
--
-- Uma migration que quebra ao ser reaplicada é uma armadilha: numa hora
-- ruim, quem estiver conferindo se o banco está em dia leva um erro que
-- parece grave e não é.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.conname = 'evolution_instances_pkey'
      AND c.conrelid = 'evolution_instances'::regclass
      AND c.contype = 'p'
      AND a.attname = 'account_id'
  ) THEN
    ALTER TABLE evolution_instances DROP CONSTRAINT evolution_instances_pkey;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'evolution_instances_pkey'
      AND conrelid = 'evolution_instances'::regclass
  ) THEN
    ALTER TABLE evolution_instances ADD CONSTRAINT evolution_instances_pkey
      PRIMARY KEY (id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_evolution_instances_account
  ON evolution_instances (account_id);

-- ------------------------------------------------------------
-- 2. Um número por cliente marcado como PADRÃO.
--
-- Serve para dois momentos em que o sistema precisa escolher sozinho:
-- iniciar uma conversa nova a partir de um contato, e enviar numa
-- conversa antiga que ainda não tem número atribuído.
--
-- O índice parcial garante NO MÁXIMO um padrão por cliente. Sem ele,
-- dois padrões fariam a escolha depender da ordem do banco — o tipo de
-- bug que só aparece em produção e não reproduz.
-- ------------------------------------------------------------
ALTER TABLE evolution_instances
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE evolution_instances
  ADD COLUMN IF NOT EXISTS label TEXT;

COMMENT ON COLUMN evolution_instances.label IS
  'Apelido do número, dado pelo usuário ("Vendas", "Suporte"). NULL = mostra o telefone.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_evolution_instances_default
  ON evolution_instances (account_id)
  WHERE is_default;

-- Quem já tem número passa a ter esse número como padrão. Sem isto,
-- nenhuma conta teria padrão e toda conversa nova ficaria sem número.
UPDATE evolution_instances SET is_default = TRUE
WHERE is_default = FALSE
  AND NOT EXISTS (
    SELECT 1 FROM evolution_instances outra
    WHERE outra.account_id = evolution_instances.account_id
      AND outra.is_default
  );

-- ------------------------------------------------------------
-- 3. A conversa passa a saber de qual número ela é.
--
-- É o que torna o roteamento possível: mensagem que chega no número A
-- responde pelo número A. Sem isso, responder poderia sair pelo número
-- errado — o cliente veria a resposta vindo de um telefone que ele
-- nunca contatou.
--
-- ON DELETE SET NULL, e não CASCADE: desconectar um número não pode
-- apagar o histórico de conversas dele. A conversa fica sem número e o
-- envio cai no padrão.
-- ------------------------------------------------------------
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS instance_id UUID
    REFERENCES evolution_instances(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_instance
  ON conversations (instance_id)
  WHERE instance_id IS NOT NULL;

-- Backfill: como até agora havia no máximo um número por cliente, toda
-- conversa existente pertence a ele sem ambiguidade.
UPDATE conversations c
SET instance_id = e.id
FROM evolution_instances e
WHERE e.account_id = c.account_id
  AND c.instance_id IS NULL;
