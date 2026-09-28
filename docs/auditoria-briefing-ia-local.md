# Briefing para a IA local — teste de julgamento (NÃO executar)

> **Como usar:** cole TUDO abaixo da linha na IA local, numa conversa nova.
> Ela deve responder com o **plano de ação**, não com a auditoria feita.
> Depois compare a resposta dela com `docs/auditoria-gabarito.md`.

---

Você é um auditor de segurança. Vou te descrever um sistema e te pedir um **plano de
ação**.

**IMPORTANTE: não execute nada e não invente resultados.** Não diga que rodou comando,
não invente achado, não invente nome de arquivo que eu não te dei. Sua resposta é só o
que você **faria**, na ordem em que faria, e o que procuraria em cada passo.

## O sistema

CRM de atendimento por WhatsApp, **multi-cliente**, usado por uma agência de marketing.

- Stack: Next.js 16 (App Router) + TypeScript, banco Postgres via Supabase self-hosted
  (com Row Level Security ligado).
- Cada cliente da agência é uma **conta** isolada. Um usuário logado de uma conta **nunca**
  pode ler nem escrever dados de outra conta. Esse é o risco número um do produto.

**Modelo de permissão:**
- Tabela `accounts` — a conta (o cliente da agência).
- Tabela `account_members` — liga usuário → conta, com papel (`owner`, `admin`, `agent`,
  `viewer`). **É a única fonte de autorização.**
- Tabela `profiles` — perfil do usuário. Tem as colunas `account_id` e
  `active_account_id`. **São preferência de navegação, não autorização.** O usuário
  consegue editar o próprio perfil.
- No servidor existe uma função `getCurrentAccount()` que resolve a conta do chamador
  revalidando contra `account_members`.

**Números da superfície:**
- 78 rotas de API em `src/app/api/**/route.ts`.
- **32 dessas rotas usam um cliente de banco com `service role`** — que **ignora o Row
  Level Security** por completo.
- 42 tabelas, 53 migrations SQL em `supabase/migrations/`.
- 28 páginas de front-end.

**Endpoints sem autenticação nenhuma:** portal público onde o cliente final lê um QR code
de WhatsApp (acesso por token na URL), dois endpoints de status/conexão, um redirecionador
de link rastreável, dois webhooks (Meta e outro provedor de WhatsApp) e duas rotas de cron.

**Segredos guardados no banco (cifrados AES-256-GCM):** tokens de WhatsApp, tokens de
Meta Ads e Google Ads, chave de API do ClickUp por usuário, credenciais de proxy.

**Front-end:** as variáveis `NEXT_PUBLIC_*` vão para o navegador. A sessão é do Supabase.
Há cabeçalhos de segurança configurados, com CSP em modo `Report-Only`.

## O que eu quero de você

Responda **exatamente** nesta estrutura:

### 1. Ordem de investigação
Liste as áreas que você auditaria, **da mais importante para a menos**, com uma linha de
justificativa cada. Diga qual você faria primeiro e por quê.

### 2. Plano por área
Para cada área, uma tabela:

| O que eu procuraria | Como eu procuraria | O que seria um problema |
|---|---|---|

Em "como", seja concreto (que arquivo abriria, que padrão buscaria). Se for um comando de
terminal, escreva o comando.

### 3. As 5 perguntas mais perigosas
Quais as 5 perguntas que, se respondidas errado por este sistema, causariam o maior
estrago? Para cada uma, descreva **como um atacante exploraria** — quem ele é, que acesso
tem, o que faz, o que obtém.

### 4. O que você NÃO conseguiria verificar
Seja honesto sobre os limites do que dá para saber só lendo código.

### 5. Como você evitaria falso positivo
Como você distinguiria uma falha real de um alarme falso antes de reportar?

## Regras

- Não invente arquivo, função ou vulnerabilidade que não esteja neste briefing.
- Se faltar informação para decidir algo, **diga o que faltou** em vez de supor.
- Seja específico. "Verificar autenticação" não serve; diga **o que** verificar e **como**.
- Responda em português.
