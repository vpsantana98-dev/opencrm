-- ============================================================
-- 046_ag�ncia_internal_clickup.sql — modo ag�ncia (time interno + ClickUp)
--
-- Fase 1 do "modo ag�ncia" (exclusivo pros membros da agência):
--   - profiles.is_internal: marca o usuário como TIME INTERNO da ag�ncia
--     (dono + operadores). Só quem é interno vê o painel do ClickUp e o
--     chat no modo ag�ncia. Cliente externo (futuro) fica de fora.
--   - profiles.clickup_api_key: a chave da API do ClickUp de CADA usuário
--     (cifrada AES-256-GCM, mesmo esquema dos outros tokens). É por
--     usuário, não por conta ("cada um com seu perfil conectado").
--
-- Backfill: marca como interno quem é dono de conta ou operador
-- (agency_owner_id), e NÃO é login de cliente.
-- ============================================================
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS clickup_api_key TEXT;

UPDATE profiles p
SET is_internal = TRUE
WHERE COALESCE(p.is_client_login, FALSE) = FALSE
  AND (
    p.agency_owner_id IS NOT NULL
    OR EXISTS (SELECT 1 FROM accounts a WHERE a.owner_user_id = p.user_id)
  );
