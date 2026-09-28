-- Cacheia quando a foto do WhatsApp foi consultada. Evita chamar a
-- Evolution a cada mensagem quando o contato não possui foto ou a
-- privacidade dele impede a leitura.
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS whatsapp_avatar_checked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_contacts_avatar_refresh
  ON public.contacts (account_id, whatsapp_avatar_checked_at)
  WHERE avatar_url IS NULL;
