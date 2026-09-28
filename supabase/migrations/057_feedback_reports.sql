-- ============================================================
-- 057_feedback_reports.sql — histórico de feedback in-app.
--
-- Cada relato é gravado ANTES de tentar o ClickUp, com status 'failed'.
-- Se a API cair, o texto de quem escreveu não se perde — e é possível
-- reprocessar depois. O status vira 'sent' só quando a tarefa nasce.
--
-- Numerada 057 e não 056: já existem DUAS migrations 055 no repositório
-- (055_fix_profile_guard_cascade e 055_harden_security_definer_search_path,
-- de trabalhos paralelos) e uma 056. Pular o número evita uma terceira
-- colisão.
-- ============================================================

CREATE TABLE IF NOT EXISTS feedback_reports (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- A conta ativa no momento do relato. ON DELETE SET NULL para que
  -- excluir um cliente não apague o histórico de quem reportou algo
  -- enquanto operava nele — o relato continua útil para a nossa equipe.
  account_id   UUID REFERENCES accounts(id) ON DELETE SET NULL,

  kind         TEXT NOT NULL CHECK (kind IN ('problema', 'ideia', 'outro')),
  -- Derivado no servidor a partir da mensagem; não existe campo de
  -- título no formulário.
  title        TEXT NOT NULL,
  message      TEXT NOT NULL,
  -- Rota, navegador, SO, tela, tema, id do recurso aberto. JSONB porque
  -- o conjunto vai crescer e não vale uma migration por campo novo.
  context      JSONB NOT NULL DEFAULT '{}'::jsonb,
  attachments  INTEGER NOT NULL DEFAULT 0,

  task_id      TEXT,
  task_url     TEXT,
  status       TEXT NOT NULL DEFAULT 'failed'
                 CHECK (status IN ('sent', 'failed')),
  error        TEXT,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Serve ao rate limit ("quantos relatos deste usuário na última hora?"),
-- que é a consulta mais frequente da tabela.
CREATE INDEX IF NOT EXISTS idx_feedback_reports_user_time
  ON feedback_reports (user_id, created_at DESC);

ALTER TABLE feedback_reports ENABLE ROW LEVEL SECURITY;

-- Cada um vê e cria só os PRÓPRIOS relatos. Diferente do resto do app,
-- o recorte aqui é por USUÁRIO e não por conta: um relato é de quem
-- escreveu, não do cliente que estava aberto. Colegas de conta não
-- precisam ler o que você reportou.
DROP POLICY IF EXISTS feedback_reports_select ON feedback_reports;
CREATE POLICY feedback_reports_select ON feedback_reports FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS feedback_reports_insert ON feedback_reports;
CREATE POLICY feedback_reports_insert ON feedback_reports FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Sem policy de UPDATE/DELETE de propósito: o usuário não edita nem
-- apaga um relato enviado. A rota escreve o status pelo service role.
