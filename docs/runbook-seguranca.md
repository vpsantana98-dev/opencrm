# Runbook: segurança (P0) — o que VOCÊ executa

Estes itens não são código que o Claude sobe no git: são mudanças no
Easypanel/infra. O Claude preparou os valores; aqui está o passo a passo.

> **Regra de ouro:** guarde os valores ANTIGOS antes de trocar (pra
> reverter) e faça numa **janela de baixo movimento**. Trocar as chaves
> **desloga todo mundo** e **quebra qualquer integração que use a chave
> antiga** (ex.: n8n, scripts do dev). Avise o time antes.

---

## P0.1 — Regenerar as chaves do Supabase (o mais importante)

**Por quê:** hoje são as chaves PADRÃO do template. Com o segredo padrão,
qualquer um pode forjar acesso e ler dados de TODOS os clientes. Isso é
pré-requisito pra abrir login pra cliente externa.

**Valores novos:** no arquivo local
`scratchpad/OpenCRM-supabase-keys-NOVAS.txt` (não está no git). Contém
`JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `SECRET_KEY_BASE` e um
`WEBHOOK_VERIFY_TOKEN`.

**⚠️ NÃO TROCAR o `ENCRYPTION_KEY`** — essa cifra os tokens de WhatsApp e do
CAPI. Se mudar, todos os tokens salvos viram lixo.

### Passos

1. **Backup dos valores atuais (rollback).** Easypanel → projeto
   `opencrm-supabase` → serviço **opencrm-supabase** → aba **Ambiente**: copie
   os atuais `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`,
   `SECRET_KEY_BASE` para um lugar seguro. Faça o mesmo no serviço **app**:
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
2. **Avise o time** (vai deslogar todo mundo) e escolha a janela.
3. No serviço **opencrm-supabase** → Ambiente, substitua pelos valores novos:
   `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY` (e `SECRET_KEY_BASE`, se
   estiver lá). Se houver variáveis irmãs que repetem esses valores
   (`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, chaves do Studio/Dashboard),
   deixe TODAS com os mesmos valores novos. **Implantar** e aguardar subir.
4. No serviço **app** → Ambiente, substitua
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` (= novo `ANON_KEY`) e
   `SUPABASE_SERVICE_ROLE_KEY` (= novo `SERVICE_ROLE_KEY`). Não toque em
   `NEXT_PUBLIC_SUPABASE_URL`, `ENCRYPTION_KEY`, `EVOLUTION_*`. **Implantar**.
5. **Testar:** abra o app, re-logue (você foi deslogado), veja se o inbox
   carrega, se manda/recebe mensagem, se as Configurações abrem.
6. **Se quebrou:** volte os valores ANTIGOS nos dois serviços e reimplante.

### Quem mais precisa da chave nova (senão quebra)

Qualquer coisa que fale com o Supabase usando a chave antiga para de
funcionar até atualizar:
- **n8n** (se algum fluxo usa o Supabase do opencrm).
- Qualquer script/serviço do dev que use `SERVICE_ROLE_KEY` ou `ANON_KEY`.
- Confirme com o dev antes de trocar (ele está mexendo no mesmo projeto).

> Chaves de API que o CRM emite pra terceiros (`opencrm_live_...`) NÃO são
> afetadas — são separadas e guardadas como hash.

---

## P0.2 — Verify token de webhook forte

O `WEBHOOK_VERIFY_TOKEN` novo está no mesmo arquivo. Onde usar: na
configuração do webhook da Meta (por cliente, na tela de WhatsApp) troque o
valor fraco (`1234567890`) por esse. Só importa quando for usar número
OFICIAL da Meta.

---

## P0.3 — Backup do banco

Sem backup, se o disco morrer, perde tudo. Um backup diário simples via
cron na VPS (o Claude pode configurar com seu ok):

```bash
# roda no host; guarda 7 dias em /root/backups
mkdir -p /root/backups
PGPASS=$(grep '^POSTGRES_PASSWORD=' /etc/easypanel/projects/opencrm-supabase/opencrm-supabase/code/supabase/code/.env | cut -d= -f2-)
docker exec -e PGPASSWORD="$PGPASS" opencrm-supabase_opencrm-supabase-db-1 \
  pg_dump -U postgres -d postgres | gzip > /root/backups/opencrm-$(date +\%F).sql.gz
find /root/backups -name 'opencrm-*.sql.gz' -mtime +7 -delete
```

Ideal: mandar esses `.gz` pra fora da VPS (outro storage) depois.

---

## P0.4 — Domínio próprio

Easypanel → serviço **app** → aba **Domínios**: adicionar o domínio de
vocês e apontar o DNS (registro A/CNAME) pro IP `31.97.249.95`. Depois
ajustar `NEXT_PUBLIC_*URL` se necessário.

---

## P2.4 — SMTP (pra "esqueci a senha" / convites por e-mail)

No serviço **opencrm-supabase** → Ambiente (o Auth/GoTrue): preencher
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SENDER_NAME` e
`SMTP_ADMIN_EMAIL` com um provedor de e-mail (ex.: um SMTP transacional).
Necessário pro reset de senha do login das clientes funcionar por e-mail
(o link inicial dá pra passar na mão sem isso).
