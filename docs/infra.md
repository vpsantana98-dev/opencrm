# Infraestrutura

## VPS

- Hostinger, IP `31.97.249.95` (hostname `srv895614.hstgr.cloud`), 8 GB RAM, ~96 GB disco.
- Gerenciada por **Easypanel** (painel em `http://31.97.249.95:3000`), que roda os serviços em Docker Swarm.
- Acesso: SSH como `root` por chave. Reverse proxy: **Traefik** (portas 80/443, HTTPS automático, roteia por domínio).

Serviços que já rodavam na VPS (NÃO mexer sem autorização): Supabase antigo
(projeto `supabase`), n8n (`n8n_editor`), Evolution API existente
(`evolution`), `OpenCRM-crm`, `OpenCRM-dashboard`.

## Supabase (instância dedicada ao CRM)

Projeto Easypanel: **`opencrm-supabase`** (template Supabase do Easypanel).

- Compose: `/etc/easypanel/projects/opencrm-supabase/opencrm-supabase/code/supabase/code/`
  - `.env` com as chaves; backup em `.env.bak`.
  - A **fonte da verdade** do `.env` é a aba **Ambiente** do serviço no
    Easypanel — o painel **regrava** o `.env` a cada redeploy. Editar o
    arquivo direto por SSH é volátil.
- URL pública do Supabase: `https://opencrm-supabase-opencrm-supabase.ldlhf1.easypanel.host`
  (Kong/gateway atrás do Traefik com HTTPS).
- Ajustes feitos: `API_EXTERNAL_URL`/`SUPABASE_PUBLIC_URL` = URL pública do
  Supabase; `SITE_URL`/`ADDITIONAL_REDIRECT_URLS` = URL do app;
  `ENABLE_EMAIL_AUTOCONFIRM=true` (sem SMTP configurado ainda).
- Extensões/recursos em uso: Auth, Storage (buckets `avatars`,
  `chat-media`, `flow-media`), Realtime, `pgvector`, `uuid-ossp`.

### Migrations

Ficam em `supabase/migrations/` (SQL, ordem alfabética = ordem de
aplicação). As 001–030 vieram do template; as **031–035 são o
multi-tenant** (ver `multi-tenant.md`). Aplicação manual contra o banco:

```bash
# do container do Postgres na VPS
PGPASS=$(grep '^POSTGRES_PASSWORD=' <dir>/.env | cut -d= -f2-)
docker exec -i -e PGPASSWORD="$PGPASS" opencrm-supabase_opencrm-supabase-db-1 \
  psql -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -1 -f 0XX_nome.sql
```

Cada arquivo roda em transação única (`-1`): ou aplica inteiro, ou nada.

## App (o CRM Next.js)

Projeto Easypanel: **`opencrm-supabase`**, serviço **`app`**.

- Build: **Nixpacks** (detecta Next.js). Sem Dockerfile.
- Fonte: repositório privado `agenciaOpenCRM/opencrmOpenCRM`, via URL Git com
  token embutido (não commitar o token; ver `.env.easypanel-git-url.txt`
  local, gitignored).
- URL: `https://opencrm-supabase-app.ldlhf1.easypanel.host` (porta 3000).
- Variáveis (aba Ambiente do serviço): `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `ENCRYPTION_KEY` (AES-256-GCM p/ tokens do WhatsApp), `META_APP_SECRET`,
  `META_APP_ID`, e as quatro exigidas pela Fase 1 do anti-ban abaixo:
  `NEXT_PUBLIC_SITE_URL`, `EVOLUTION_WEBHOOK_SECRET`,
  `PLATFORM_ADMIN_USER_IDS`, `VPS_PUBLIC_IP`.

### Variáveis exigidas pela Fase 1 do anti-ban (Evolution)

Todas fail-closed: a ausência de qualquer uma delas recusa a operação em
vez de abrir uma brecha, mas cada uma recusa uma coisa diferente.
Conferir a aba Ambiente do serviço `app` antes de implantar esta fase.

- **`NEXT_PUBLIC_SITE_URL`**: **obrigatória** para conectar WhatsApp.
  `POST /api/whatsapp/evolution/connect` e `/connect-public` usam só
  esta variável para montar a URL do webhook, nunca um header da
  requisição. Sem ela, as duas rotas devolvem 503 em vez de registrar um
  webhook. Existe para a URL do webhook (que carrega o segredo abaixo no
  próprio caminho) nunca ser derivada de um `Host` / `X-Forwarded-Host`
  que o cliente da requisição controla.
- **`EVOLUTION_WEBHOOK_SECRET`**: sem ela, `POST
  /api/whatsapp/evolution/webhook/[secret]` não processa nenhum evento
  (responde 200 vazio, só para a Evolution não entrar em loop de retry,
  sem gravar nada no banco).
- **`PLATFORM_ADMIN_USER_IDS`**: sem ela, ninguém gerencia o pool de
  proxies (`/api/proxies` e `/api/proxies/[id]`), nem um owner de conta.
  É a allowlist por UUID que substitui `requireRole("owner")` para esse
  recurso global (o pool não pertence a nenhuma conta).
- **`VPS_PUBLIC_IP`**: sem ela, a detecção de vazamento de `GET
  /api/proxies/health` fica desligada (ver detalhe abaixo).

**Alerta operacional**: o segredo de `EVOLUTION_WEBHOOK_SECRET` viaja no
CAMINHO da URL do webhook (`.../webhook/<segredo>`), não em header ou
corpo. Se o access log do Traefik estiver ligado neste serviço, ele
grava a URL completa, segredo incluso, em disco a cada mensagem
recebida. Vale conferir essa configuração antes de colocar esta branch
em produção.

### Deploy

1. Push para `agenciaOpenCRM/opencrmOpenCRM` na branch que o serviço aponta
   (aba Fonte → Ramo).
2. No Easypanel, serviço `app` → **Implantar**.
3. **Cache**: após todo deploy, o navegador pode servir a versão antiga
   (chunks defasados). O `next.config.ts` já foi ajustado para
   `max-age=0, must-revalidate` no HTML (fim do resíduo), mas isso só
   vale **depois de um deploy com essa correção + 1x Clear site data**.
   Ao testar um deploy: F12 → Application → **Clear site data** → recarregar.

Para testar a branch `feat/multi-tenant` sem afetar produção: serviço
`app` → Fonte → trocar **Ramo** para `feat/multi-tenant` → Implantar; depois
voltar para `main`.

## Evolution API (não-oficial) — no ar

- **Evolution DEDICADA ao CRM**: projeto Easypanel `evolution-crm`
  (containers `evolution-crm_evolution-api` + `-db` + `-redis`), com
  Postgres/Redis próprios e `AUTHENTICATION_API_KEY` própria. **Separada**
  da Evolution antiga (projeto `evolution`, usada pelo n8n) — não mexer
  naquela.
- O app (serviço `app`) fala com ela por env: `EVOLUTION_API_URL` (host do
  `evolution-crm` no Easypanel) e `EVOLUTION_API_KEY` (a
  `AUTHENTICATION_API_KEY` dela). Setadas na aba Ambiente do serviço `app`.
- Integração, endpoints e o link público (Portal do Cliente) em
  [`whatsapp-providers.md`](./whatsapp-providers.md).
- **Saúde do pool de proxies**: `GET /api/proxies/health` precisa ser
  chamada a cada 15 minutos (agendamento no Easypanel), com o header
  `x-cron-secret: $AUTOMATION_CRON_SECRET`. Ela checa cada proxy do
  pool e desativa na hora qualquer um cujo IP de saída bata com o IP
  da VPS (vazamento). Para a detecção de vazamento funcionar, a
  variável `VPS_PUBLIC_IP` precisa estar setada na aba Ambiente do
  serviço `app`.

## Git / remotes

- `origin` = `github.com/ArnasDon/opencrm` (upstream público do template).
- `OpenCRM` = `github.com/agenciaOpenCRM/opencrmOpenCRM` (privado da agência) —
  **é o nosso**. `gh` é o credential helper; a conta do dono de cada
  remote fica embutida na URL. Push: `git push OpenCRM <branch>:<branch>`.

## Cadastro fechado e criação manual de usuários

O produto NÃO tem auto-cadastro. Usuários são criados pelos donos da
plataforma em `/admin/usuarios` (allowlist `PLATFORM_ADMIN_USER_IDS`),
recebem uma senha temporária de 16 caracteres exibida uma única vez e
são forçados a trocá-la no primeiro login (flag
`app_metadata.must_change_password`, aplicada no middleware).

### Passo manual obrigatório no Supabase (por ambiente)

1. Dashboard do Supabase → Authentication → Sign In / Up.
2. Desligar **Allow new users to sign up**.

Sem esse passo a API pública de signup continua aberta MESMO com a
página /signup removida: a anon key vai no bundle JS e qualquer um
pode chamar `supabase.auth.signUp()` por fora do app. A criação via
`/admin/usuarios` continua funcionando com signups desligados porque
usa a service role (`auth.admin.createUser`).

### Envs relevantes

- `PLATFORM_ADMIN_USER_IDS`: UUIDs (separados por vírgula) dos donos.
  Vazio = ninguém é admin (fail-closed).
- `SUPABASE_SERVICE_ROLE_KEY`: já usada pelo webhook; agora também
  pela criação de usuários e limpeza da flag de troca de senha.
