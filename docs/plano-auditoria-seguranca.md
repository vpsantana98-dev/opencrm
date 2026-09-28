# Plano de auditoria de segurança — CRM OpenCRM

Plano de verificação de segurança do CRM, **front-end e back-end**, escrito para ser
executado passo a passo por outra IA (ou pessoa) que **não conhece este código**.

Auditoria **defensiva**, no pró prio sistema do dono: o objetivo é encontrar e corrigir
falhas antes que um cliente ou um invasor as encontre.

---

# 0. Como usar este plano

### Regras para quem executa

1. **Só leitura e análise.** Não altere código, não aplique migration, não rode nada
   contra produção. A saída é um **relatório**, não um patch.
2. **Não invente vulnerabilidade.** Todo achado precisa de `arquivo:linha` e de uma
   explicação de *como* seria explorado. Se não conseguiu confirmar no código, marque
   como **"suspeita — não confirmada"** e diga o que falta para confirmar.
3. **Não repita o que já está corrigido.** O bloco **B12** lista consertos recentes: lá
   sua tarefa é *verificar que continuam de pé*, não redescobrir.
4. **Se um comando não funcionar** (caminho diferente, arquivo ausente), diga isso no
   relatório em vez de pular em silêncio.
5. **Nunca cole segredo no relatório.** Se encontrar chave/token/senha, reporte
   `arquivo:linha` e o *tipo* do segredo — nunca o valor.

### Ambiente

- Raiz do projeto: `c:/Users/vpsan/opencrm`
- Stack: **Next.js 16 (App Router) + TypeScript + Tailwind + Base UI**, **Supabase
  self-hosted** (Postgres + Auth + Storage + Realtime + RLS).
- Comandos: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`.
- Os comandos abaixo usam `grep`/`rg`. No Windows, rode pelo Git Bash ou troque por
  `rg` (ripgrep). Onde estiver `rg`, `grep -rn` equivalente serve.

### Escala de severidade

| Nível | Significado |
|---|---|
| **CRÍTICO** | Vaza ou permite escrever dados **entre clientes diferentes**, ou permite tomar conta de outro usuário. |
| **ALTO** | Escalonamento de privilégio dentro da conta, exposição de segredo, RCE/SSRF, bypass de autenticação. |
| **MÉDIO** | DoS, enumeração, falta de rate limit, validação fraca com impacto real. |
| **BAIXO** | Defesa em profundidade, higiene, PII em log, hardening. |

---

# 1. Mapa do sistema (leia antes de começar)

### O que este produto é

CRM de atendimento por WhatsApp, **multi-cliente (multi-tenant)**, usado por uma agência.
Cada cliente da agência é uma **conta** (`accounts`) isolada, com contatos, conversas,
funil e número de WhatsApp próprios. A agência opera várias contas.

**A ameaça principal é o vazamento entre contas.** Um usuário legítimo de uma conta não
pode, de forma alguma, ler ou escrever dados de outra.

### Modelo de tenancy (memorize — é a base de quase toda checagem)

- `accounts` — a conta (o "cliente" da agência).
- `account_members` — quem pertence a qual conta e com qual papel (`owner`, `admin`,
  `agent`, `viewer`). **Esta tabela é a única fonte de autorização.**
- `profiles` — perfil do usuário. Tem `account_id` (conta "casa") e `active_account_id`
  (conta em que ele está operando agora). **São preferências, NÃO autorização.**
- Funções SQL de RLS: `is_account_member(account_id)` e `in_active_account(account_id)`.

**Regra de ouro:** o servidor deve resolver a conta com `getCurrentAccount()`
(`src/lib/auth/account.ts`), que revalida contra `account_members`. Qualquer rota que
pegue um `account_id` do corpo/query da requisição, ou que leia `profiles.account_id`
direto e confie nele, é suspeita.

### Superfície de ataque (números atuais)

| Item | Quantidade |
|---|---|
| Rotas de API (`src/app/api/**/route.ts`) | **78** |
| Rotas que usam `supabaseAdmin()` (service role, **ignora RLS**) | **32** |
| Migrations SQL | 53 |
| Tabelas criadas | 42 |
| Páginas do app (`page.tsx`) | 28 |

### Pontos de entrada, por nível de confiança

1. **Sem autenticação nenhuma (mais expostos):**
   - `src/app/conectar/[token]/` — portal público onde o cliente final lê o QR do WhatsApp.
   - `src/app/api/whatsapp/evolution/connect-public/route.ts`
   - `src/app/api/whatsapp/evolution/status-public/route.ts`
   - `src/app/t/[code]/route.ts` — redirecionador de link rastreável.
   - `src/app/api/whatsapp/webhook/route.ts` — webhook da Meta (valida HMAC).
   - `src/app/api/whatsapp/evolution/webhook/[secret]/route.ts` — webhook da Evolution
     (segredo no caminho da URL).
   - `src/app/api/invitations/[token]/peek/route.ts`
   - Rotas de cron: `src/app/api/automations/cron/route.ts`, `src/app/api/flows/cron/route.ts`
2. **Autenticado por API key (integrações externas):** `src/app/api/v1/**` (11 rotas).
3. **Autenticado por sessão (o app):** todo o resto de `src/app/api/**`.

### Onde ficam os segredos

Cifrados com AES-256-GCM por `src/lib/whatsapp/encryption.ts` (chave em `ENCRYPTION_KEY`):
- `whatsapp_config.access_token`, `.verify_token`
- `meta_ads_config` / `google_ads_config` (tokens)
- `profiles.clickup_api_key`
- `evolution_instances`
- `proxies` (credenciais)

### Variáveis `NEXT_PUBLIC_*` (vão para o navegador — nada secreto pode estar aqui)

`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`.

---

# 2. BACK-END

## B1 — Isolamento multi-tenant (CRÍTICO — comece por aqui)

Este é o bloco mais importante do plano. Reserve a maior parte do esforço aqui.

### B1.1 — Inventário das rotas com service role

```bash
grep -rln "supabaseAdmin" src/app/api --include=route.ts | sort
```

Devem aparecer ~32 arquivos. **Para CADA um**, abra e responda:

| Pergunta | Resposta esperada |
|---|---|
| Chama `getCurrentAccount()` (ou `requireApiKey`, ou `requirePlatformAdmin`) antes de qualquer query? | **Sim** |
| A query com `supabaseAdmin()` filtra por `account_id` = o da sessão? | **Sim** |
| Algum `account_id`/`conversation_id`/`contact_id`/`id` vem do corpo ou da query da requisição? | Se sim, **é validado que pertence à conta do chamador antes de ser usado?** |
| Lê `profiles.account_id` direto e usa como chave de tenancy? | **Não** (isso é o antipadrão que causou uma falha crítica antes) |

**Critério de aprovação:** toda rota com service role tem escopo por conta validado
server-side. **Falha aqui é CRÍTICO.**

### B1.2 — Objetos referenciados por id vindo do cliente

```bash
grep -rn "body\.\(accountId\|account_id\|conversationId\|contactId\|dealId\|listId\)" src/app/api --include=route.ts
grep -rn "searchParams.get" src/app/api --include=route.ts | head -50
```

Para cada id recebido do cliente e usado numa query: existe uma checagem de posse
("este id pertence à conta do chamador")? O padrão correto no projeto é uma função
tipo `convInAccount()` (ver `src/app/api/inbox/clickup/route.ts`) que busca a linha e
compara `account_id`.

**Falha:** IDOR (acesso a objeto de outro cliente). **CRÍTICO.**

### B1.3 — Tabelas periféricas que podem cruzar contas

Verifique se as queries destas áreas filtram por conta ativa:
- métricas do dashboard: `src/lib/dashboard/queries.ts`
- notificações: `src/app/api/notifications/**`
- chaves de API: `src/lib/api-keys/**`

**Nota:** o backlog do projeto (`docs/backlog.md`, item P6.3) registra isto como dívida
conhecida — confirme se ainda existe e qual o alcance real.

---

## B2 — RLS no banco

### B2.1 — Toda tabela tem RLS ligado

```bash
grep -rhoE "CREATE TABLE IF NOT EXISTS [a-z_]+" supabase/migrations | awk '{print $NF}' | sort -u > /tmp/tabelas.txt
grep -rhoE "ALTER TABLE [a-z_]+ ENABLE ROW LEVEL SECURITY" supabase/migrations | awk '{print $3}' | sort -u > /tmp/rls.txt
diff /tmp/tabelas.txt /tmp/rls.txt
```

**Critério:** nenhuma tabela sem RLS. Qualquer diferença é achado **ALTO**.

### B2.2 — Policies permissivas demais

```bash
grep -rn "USING (true)\|WITH CHECK (true)" supabase/migrations
```

Cada ocorrência precisa ser justificada. Verifique se uma migration **posterior** a
removeu (o projeto já fez isso pelo menos uma vez).

### B2.3 — Policies que confiam em coluna auto-editável

Procure policies que autorizem com base em `profiles` em vez de `account_members`:

```bash
grep -rn -B3 -A8 "CREATE POLICY" supabase/migrations | grep -iE "profiles\.|profiles " | head -30
```

**Por quê:** o usuário consegue editar o próprio `profiles`. Autorizar por uma coluna que
ele mesmo escreve é escalonamento de privilégio. Confirme que
`is_account_member` lê `account_members` (deve ter sido corrigido na migration 031).

### B2.4 — Funções `SECURITY DEFINER`

```bash
grep -rn "SECURITY DEFINER" supabase/migrations
```

Para cada função: ela tem `SET search_path`? Valida os argumentos recebidos? Uma função
`SECURITY DEFINER` sem `search_path` fixo é vetor clássico de escalonamento. **ALTO.**

### B2.5 — Grants de coluna

```bash
grep -rn "REVOKE\|GRANT" supabase/migrations
```

Confirme que colunas privilegiadas (tokens, flags de papel) não são graváveis por
`authenticated`.

---

## B3 — Autenticação e autorização das rotas

### B3.1 — Rota sem checagem nenhuma

Liste as rotas que **não** mencionam nenhum guard:

```bash
for f in $(find src/app/api -name route.ts); do
  grep -qE "getCurrentAccount|requireApiKey|requirePlatformAdmin|requireRole|auth.getUser" "$f" || echo "SEM GUARD: $f"
done
```

Cada resultado precisa ser classificado: é um endpoint público **intencional** (webhook,
cron, portal) ou é um **esquecimento**? Esquecimento = **CRÍTICO**.

### B3.2 — O middleware não é a defesa

Leia `src/middleware.ts`. Descubra **quais famílias de rota ele protege**. Sabe-se que ele
devolve 401 apenas para `/api/whatsapp/**` — todas as outras dependem 100% da checagem
dentro da própria rota.

**Reporte** como risco estrutural (**MÉDIO**): uma rota nova criada sem guard nasce pública.
Recomende uma proteção por padrão (deny-by-default) no middleware.

### B3.3 — Papéis (roles)

```bash
grep -rn "requireRole\|hasMinRole" src/app/api src/lib | head -30
```

Ações destrutivas ou de configuração (excluir workspace, mudar config de WhatsApp,
gerenciar membros, gerar link público) exigem `admin`+? Um `viewer` consegue fazer algo
que não devia? **ALTO** se sim.

### B3.4 — Rotas de cron

`src/app/api/automations/cron/route.ts` e `src/app/api/flows/cron/route.ts`:
- o segredo é comparado em **tempo constante** (`timingSafeEqual`)?
- falha **fechada** se a env não existir?

---

## B4 — Endpoints públicos e webhooks

Para cada endpoint da lista "sem autenticação" da seção 1:

### B4.1 — Como autentica

- Webhook da Meta: valida assinatura HMAC sobre o **corpo cru**? Falha fechada sem
  `META_APP_SECRET`? (`src/lib/whatsapp/webhook-signature.ts`)
- Webhook da Evolution: compara o segredo em tempo constante? Responde 404 (não 401)?
- Portal `conectar/[token]` e rotas `*-public`: o token é comparado por **hash**, não em
  texto puro?

### B4.2 — Rate limit e amplificação

```bash
grep -rLn "checkRateLimit" $(grep -rl "" src/app/api/whatsapp/evolution/*-public/route.ts src/app/t/*/route.ts 2>/dev/null)
grep -rn "checkRateLimit" src/app/api --include=route.ts | wc -l
```

**Contexto:** só uma minoria das 78 rotas tem rate limit. Priorize: endpoints públicos,
rotas que chamam serviço externo (Evolution, ClickUp, Meta) e rotas que escrevem no banco
a cada chamada. **MÉDIO.**

### B4.3 — Enumeração de token

Os tokens públicos têm entropia suficiente (≥16 bytes aleatórios)? A resposta para token
inválido é indistinguível e sem timing? Existe throttle?

### B4.4 — Tamanho e forma do corpo

Webhooks aceitam corpo de tamanho arbitrário? Iteram sobre array sem limite? Um payload
gigante pode segurar o processo. **MÉDIO.**

### B4.5 — Rotas de desenvolvimento em produção

```bash
grep -rn "NODE_ENV" src/app/api | head
```

Existe `src/app/api/dev/**`. O gate é só `NODE_ENV === 'production'`? Em build de
staging/preview que não define `NODE_ENV=production`, a rota fica aberta e **escreve/apaga
dados**. Avalie e reporte.

---

## B5 — API pública (`/api/v1/**`)

### B5.1
Toda rota faz `requireApiKey` **e** filtra por `.eq('account_id', ctx.accountId)`?

### B5.2
A chave é guardada como **hash** (não em texto)? A resposta a chave inexistente,
revogada e expirada é **idêntica** (não vaza qual dos três)?

### B5.3
O rate limit roda **antes** da checagem de escopo (para não virar oráculo)?

### B5.4
Existe escopo/permissão por chave, ou toda chave pode tudo?

```bash
ls src/app/api/v1; grep -rn "requireApiKey" src/lib/auth/api-context.ts | head
```

---

## B6 — Segredos e criptografia

### B6.1 — Nenhum segredo volta ao cliente

```bash
grep -rn "select('\*')\|select(\"\*\")" src/app/api --include=route.ts
```

Para cada `select('*')` em tabela que tem coluna de token/chave (`whatsapp_config`,
`meta_ads_config`, `google_ads_config`, `profiles`, `evolution_instances`, `proxies`):
o resultado é devolvido ao navegador? O padrão correto no projeto é devolver um booleano
(`hasToken`, `connected`) em vez do valor. **ALTO se vazar.**

### B6.2 — Qualidade da criptografia

Leia `src/lib/whatsapp/encryption.ts`:
- AES-256-GCM com IV aleatório por mensagem (nunca fixo/reutilizado)?
- auth tag é **verificada** na decifragem?
- há formato legado (CBC)? Ele é **somente leitura** (não usado para cifrar novo)?

### B6.3 — Segredo no repositório

```bash
git ls-files | grep -iE "\.env" || echo "nenhum .env versionado (bom)"
grep -rnE "(eyJ[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}|-----BEGIN)" src supabase docs --include="*.ts" --include="*.tsx" --include="*.sql" --include="*.md" | head
git log --oneline --all -- "*.env*" | head
```

Se algum segredo já foi commitado no passado, **rotacione** — remover depois não basta.
Reporte apenas `arquivo:linha` e o tipo, **nunca o valor**.

### B6.4 — Chaves do Supabase
Confirme que as chaves em uso **não** são as do template padrão (o `iss` do JWT não pode
ser `supabase-demo`). *(Já foi corrigido — confirme que continua.)*

---

## B7 — Validação de entrada e injeção

### B7.1 — SQL
```bash
grep -rn "\.rpc(" src | head -30
```
Todo `rpc()` passa parâmetros nomeados (bind), sem concatenar string? Alguma migration
monta SQL com `EXECUTE` + concatenação?

### B7.2 — SSRF
```bash
grep -rn "fetch(" src/lib src/app/api | grep -viE "https://api\.|https://graph\.|supabase|localhost" | head -30
```
Todo `fetch()` cujo destino vem do usuário (webhook de automação, proxy, importação por
URL) passa por `isDeliverableUrl` (`src/lib/webhooks/ssrf.ts`)? **ALTO se não.**
Lembre: o Supabase roda **na mesma VPS** — SSRF alcança a rede interna.

### B7.3 — Upload de arquivo
Onde há upload (mídia do chat, avatar, CSV): tipo é validado pelo **conteúdo** e não só
pela extensão? Há limite de tamanho? O caminho de storage é escopado por conta? SVG é
tratado como conteúdo perigoso (pode conter script)?

### B7.4 — Validação de esquema
O projeto **não usa** zod/valibot; toda validação é `as {...}` + `if` manual. Procure
campos usados sem validação de tipo/tamanho, em especial os que viram URL, caminho de
arquivo ou entram numa query.

---

## B8 — Logs, erros e PII

### B8.1
```bash
grep -rnE "console\.(log|error|warn)" src | grep -iE "token|password|senha|secret|key|phone|telefone|email" | head -20
```
**BAIXO/MÉDIO** — mas corrija: log costuma ir para serviço de terceiros.

### B8.2
Mensagens de erro devolvidas ao cliente vazam detalhe interno (stack, SQL, nome de
tabela)? Veja `toErrorResponse` em `src/lib/auth/account.ts`.

---

# 3. FRONT-END

## F1 — XSS

### F1.1
```bash
grep -rn "dangerouslySetInnerHTML\|innerHTML\|outerHTML\|document.write" src
```
Sabe-se que há **uma** ocorrência (`src/app/layout.tsx`, script de tema). Confirme que o
conteúdo é **constante estática** e nunca recebe dado de usuário. Qualquer outra
ocorrência com dado dinâmico é **ALTO**.

### F1.2
```bash
grep -rn "href={\|src={" src/components src/app --include=*.tsx | grep -viE "\"/|'/|https://" | head -30
```
`href`/`src` montados com dado do usuário podem virar `javascript:`. Verifique se URLs
vindas do banco (ex.: `clickup_url`, `media_url`, links rastreáveis) são validadas quanto
ao **protocolo** antes de virar link.

### F1.3
Renderização de conteúdo de mensagem do WhatsApp: é texto puro (React escapa) ou passa
por algum parser de markdown/HTML? Se houver parser, ele sanitiza?

## F2 — Segredos e dados no cliente

### F2.1
```bash
grep -rn "NEXT_PUBLIC_" src | grep -viE "SUPABASE_URL|SUPABASE_ANON_KEY|SITE_URL|APP_URL"
```
Qualquer `NEXT_PUBLIC_*` além dos quatro conhecidos precisa ser justificado — tudo com
esse prefixo **vai no bundle** e é público.

### F2.2
```bash
npm run build && grep -rlE "service_role|SERVICE_ROLE|ENCRYPTION_KEY|EVOLUTION_API_KEY" .next/static 2>/dev/null | head
```
**Critério:** nenhum resultado. Se aparecer, é **CRÍTICO** — segredo de servidor no bundle.

### F2.3
Componentes marcados `"use client"` que importam módulos server-only (que leem
`process.env` sem `NEXT_PUBLIC_`)? Procure imports de `src/lib/**` server-only dentro de
arquivos com `"use client"`.

### F2.4 — Onde fica a sessão
A sessão do Supabase fica em **cookie** (preferível, `httpOnly` quando possível) ou em
`localStorage` (acessível a XSS)? Verifique `src/lib/supabase/client.ts` e `server.ts`.

## F3 — Autorização no cliente não é autorização

### F3.1
```bash
grep -rn "isInternal\|isClientLogin\|account_role\|hasMinRole" src/components src/app --include=*.tsx | head -30
```
Para **cada** lugar em que a UI esconde um botão por papel/flag, confirme que a **rota de
API correspondente também bloqueia**. Esconder no front sem bloquear no back é
autorização falsa.

**Método:** monte uma tabela `funcionalidade → componente que esconde → rota de API →
guard da rota`. Toda linha sem guard na rota é achado **ALTO**.

### F3.2
Flags vindas de `profiles` (`is_internal`, `is_client_login`) são autoridade no servidor?
Se o usuário puder editá-las, viram bypass. *(Corrigido na migration 052 — confirme em
B12.)*

## F4 — Cabeçalhos e políticas do navegador

### F4.1 — CSP está em modo relatório
`next.config.ts` define `Content-Security-Policy-Report-Only`. **Ou seja, hoje a CSP não
bloqueia nada.**

Tarefa: levantar o que impede a promoção para `Content-Security-Policy` (bloqueio real).
Liste os `unsafe-inline`/`unsafe-eval` presentes e o que os exige. **MÉDIO** — recomende
o plano de promoção.

### F4.2
Confirme presença e valor de: `Strict-Transport-Security`, `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`.

### F4.3 — Verificação em execução (contra o app rodando)
```bash
curl -sI https://<dominio-do-app>/login | grep -iE "strict-transport|x-frame|x-content-type|referrer|content-security|permissions"
```
Os headers configurados chegam mesmo no navegador (o proxy/Traefik não os remove)?

### F4.4 — CORS
```bash
grep -rn "Access-Control-Allow-Origin" src | head
```
Algum `*` em rota autenticada? **ALTO** se sim.

## F5 — Redirecionamento aberto

```bash
grep -rn "redirect(\|router.push(\|NextResponse.redirect" src | grep -iE "searchParams|params\.|query" | head -20
```
Todo destino de redirect vindo de parâmetro é validado (só caminho relativo, bloqueia
`//` e URL absoluta)? Cheque `src/app/auth/callback/route.ts` e `src/app/t/[code]/route.ts`.

## F6 — Portal público do cliente (`/conectar/[token]`)

É a única tela sem login. Verifique:
- a página **não** expõe mais nada da conta além do necessário para o QR;
- o token não vaza em `Referer` para terceiros;
- não há dado de outros clientes no payload;
- o QR/token expira.

---

# 4. Dependências e configuração

## D1 — Vulnerabilidades conhecidas
```bash
npm audit --omit=dev
npm audit
npm outdated | head -30
```
Reporte apenas `high`/`critical` com caminho de exploração plausível **neste** app.

## D2 — Supply chain
```bash
git log --oneline -20 -- package.json package-lock.json
```
Alguma dependência entrou sem revisão? Há pacote com nome suspeito (typosquatting)?

## D3 — Configuração de produção
- `.env` versionado? (deve ser **não**)
- `NEXT_PUBLIC_SITE_URL` correta (usada para montar links públicos)?
- Backups do banco existem e já foram **restaurados em teste** alguma vez?
- Supabase self-hosted: Studio/Kong expostos publicamente? Portas abertas na VPS?

---

# 5. B12 — Regressão dos consertos recentes (verificar, não redescobrir)

Estes pontos foram corrigidos no commit `fe4cb95`. **Tarefa: confirmar que continuam
corretos.** Se algum tiver regredido, é **CRÍTICO**.

| # | O que foi corrigido | Como verificar |
|---|---|---|
| 1 | `profiles` permitia ao usuário trocar o próprio `account_id` → escrita cross-tenant | `supabase/migrations/052_lock_profile_privileged_columns.sql` existe e o trigger cobre `account_id`, `active_account_id`, `account_role`, `is_internal`, `is_client_login`, `agency_owner_id`. **Confirme também que a migration foi aplicada no banco de PRODUÇÃO** (foi aplicada só no dev). |
| 2 | `automations` e `flows` liam `profiles.account_id` e escreviam com service role | `src/app/api/automations/route.ts` e `src/app/api/flows/route.ts` usam `getCurrentAccount()` |
| 3 | Passo `send_webhook` das automações sem guarda de SSRF | `src/lib/automations/engine.ts` chama `isDeliverableUrl` antes do `fetch` |
| 4 | Criação de operador com gate fraco | `src/app/api/account/team-member/route.ts` usa `requirePlatformAdmin()`. **Cuidado:** é fail-closed; confirme que `PLATFORM_ADMIN_USER_IDS` está definida no ambiente, senão a função quebra |
| 5 | `connect-link` montava URL a partir do header `Host` | `src/app/api/account/workspaces/[id]/connect-link/route.ts` usa `resolveConfiguredBaseUrl()` |
| 6 | Endpoints públicos sem rate limit | `status-public`, `connect-public`, `t/[code]` têm `checkRateLimit` |
| 7 | Comparação de segredo do cron não era em tempo constante | `src/app/api/automations/cron/route.ts` usa `timingSafeEqual` |
| 8 | Injeção de URL via `teamId` do ClickUp | `src/app/api/inbox/clickup/route.ts` exige `/^\d+$/` em `id` e `teamId` |
| 9 | Disparo em massa podia incluir o JID de um grupo | `src/hooks/use-broadcast-sending.ts` filtra `is_group` no retorno de `resolveAudience` |

---

# 5b. Pistas já verificadas (economize tempo)

Rodei parte dos comandos deste plano ao escrevê-lo. Resultados confirmados em
2026-08-09 — use como ponto de partida, mas **reconfirme**, porque o código muda.

| Verificação | Resultado |
|---|---|
| B2.1 — tabela sem RLS | **Nenhuma.** As 42 tabelas criadas têm `ENABLE ROW LEVEL SECURITY`. |
| B3.1 — rotas sem guard | 9 aparecem na busca, mas **nenhuma é buraco real**: são crons, webhooks, endpoints públicos e o `peek` de convite. Duas usam padrão diferente do esperado: `src/app/api/account/active/route.ts` delega ao `setActiveAccount` (fail-closed) e `src/app/api/proxies/health/route.ts` usa header `x-cron-secret`. |
| F1.1 — sinks de XSS | **1 ocorrência**, em `src/app/layout.tsx:120`, com constante estática (script de tema). Sem dado de usuário. |
| Cabeçalhos | Existem (`HSTS`, `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy`) e a **CSP está em `Report-Only`** — hoje não bloqueia nada. |

### Achado já identificado, ainda NÃO corrigido — confirme e reporte

**`src/app/api/proxies/health/route.ts:47`** compara o segredo do cron com `!==`, ou seja,
**não é comparação em tempo constante**. É exatamente a mesma falha que foi corrigida em
`src/app/api/automations/cron/route.ts` (que passou a usar `timingSafeEqual`) e que
`src/app/api/flows/cron/route.ts` já fazia certo. Severidade **MÉDIA** (permite inferir o
segredo por diferença de tempo de resposta, com muitas tentativas). Correção: usar
`timingSafeEqual` com pré-checagem de tamanho, copiando o padrão do `flows/cron`.

---

# 6. Testes dinâmicos (opcional — **só com autorização explícita do dono**)

**Não execute contra produção.** Use o ambiente de desenvolvimento e uma conta de teste.

Se o dono autorizar, os testes de maior valor são:

1. **Isolamento entre contas (o mais importante).** Crie duas contas de teste (A e B).
   Logado como A, tente ler e escrever objetos de B trocando ids nas chamadas de API.
   Resultado esperado: **404/403 em todos os casos**.
2. **Escalonamento de privilégio.** Com um usuário `viewer`, tente ações de `admin`.
3. **Trigger da migration 052.** Logado como usuário comum, tente pelo cliente do
   navegador: `supabase.from('profiles').update({ account_id: '<outra conta>' })`.
   Esperado: **erro**.
4. **Rate limit.** Repita chamadas nos endpoints públicos e confirme o 429.
5. **Headers.** Confirme os cabeçalhos de segurança na resposta real (F4.3).

Registre tudo: o que foi tentado, o que aconteceu, e a evidência.

---

# 7. Formato do relatório final

Entregue **um** documento com:

### 7.1 Sumário executivo
5 a 10 linhas, em português claro: o sistema está seguro para uso com clientes reais?
Qual o pior problema encontrado?

### 7.2 Tabela de achados, ordenada por severidade

| ID | Severidade | Título | Arquivo:linha | Como seria explorado | Correção sugerida | Confirmado? |
|---|---|---|---|---|---|---|

- **Como seria explorado:** passo a passo concreto (quem, com qual acesso, faz o quê,
  obtém o quê). Sem isso, o achado não é acionável.
- **Confirmado?:** `sim` (viu no código / reproduziu) ou `suspeita` (e o que falta).

### 7.3 Cobertura
Para cada bloco (B1…B8, F1…F6, D1…D3, B12): **verificado / parcial / não verificado**,
e o porquê se não foi.

### 7.4 O que NÃO foi possível verificar
Seja explícito. Um relatório que finge cobertura total é pior que um honesto e parcial.

### 7.5 Ordem de correção recomendada
Priorizando por (impacto × facilidade de exploração), não por facilidade de conserto.

---

# 8. Priorização do esforço

Se o tempo for limitado, faça **nesta ordem**:

1. **B1** — isolamento multi-tenant (32 rotas com service role). É onde mora o risco real
   de um cliente ver os dados de outro.
2. **B12** — confirmar que os consertos recentes continuam de pé.
3. **B2** — RLS e policies.
4. **B4/B5** — endpoints públicos e API pública.
5. **F3** — autorização de front que não existe no back.
6. **B6/F2** — segredos (repo e bundle).
7. O resto.
