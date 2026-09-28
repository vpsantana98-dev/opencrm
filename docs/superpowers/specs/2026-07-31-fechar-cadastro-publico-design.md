# Fechar cadastro público + criação admin de usuários + troca de senha no 1º login

**Data:** 2026-07-31
**Status:** aprovado

## Contexto e objetivo

O produto deixa de ter cadastro self-service. Usuários passam a ser criados
manualmente pelos donos da plataforma (agência) após negociação comercial, e
no primeiro login o cliente é obrigado a trocar a senha temporária antes de
usar qualquer coisa.

Portas de cadastro existentes hoje:

1. Página `/signup` (`src/app/(auth)/signup/page.tsx`), linkada do `/login`.
2. API de signup do Supabase chamada direto com a anon key — a anon key é
   pública (vai no bundle JS), então remover a página NÃO fecha essa porta.
   Só a configuração do projeto Supabase fecha.
3. Fluxo de convite `/join/[token]`, que manda convidados sem conta para
   `/signup?invite=...`.
4. Trigger `handle_new_user` (migration 031) cria conta + perfil + membership
   para todo usuário novo em `auth.users` — continua necessário, agora servindo
   os usuários criados pelo admin.

## Decisões tomadas (com o usuário)

| Decisão | Escolha |
|---|---|
| Como os donos criam usuários | Tela admin no próprio CRM, protegida por `requirePlatformAdmin` |
| Fluxo de convite `/join/[token]` | Mantido, mas só para usuários já existentes (a página perde o caminho "Criar conta") |
| Senha temporária | Gerada automaticamente (forte, 16 chars), exibida UMA vez com botão de copiar |
| Flag "precisa trocar senha" | `app_metadata.must_change_password` no auth do Supabase, aplicada no middleware (Abordagem A) |

## Design

### 1. Fechamento das portas de cadastro

- **Painel do Supabase (passo manual dos donos):** desligar
  *Authentication → Sign In/Up → "Allow new users to sign up"*. Esse é o
  cadeado real da porta 2. Fica documentado como pré-requisito de deploy
  desta feature (ver "Checklist manual" abaixo).
- **`/signup`:** página apagada. O middleware passa a redirecionar
  `GET /signup` → `/login` para links antigos não quebrarem. O branch de
  `/signup` no bloco de auth-pages do middleware é removido/ajustado.
- **`/login`:** remove o bloco "Não tem uma conta? Criar conta".
- **`/join/[token]`:**
  - Estado deslogado: só o botão "Entrar" (mantendo `?invite=<token>` na URL
    de login para o retorno ao convite após autenticar).
  - Cards de erro (`not_found` / `used` / `expired` / `server_error`): CTAs de
    "Criar uma nova conta" viram "Entrar".
  - Modal de conflito no redeem (409): o texto "saia e crie uma conta de novo
    com um e-mail diferente" vira orientação para entrar com outro usuário /
    pedir ao administrador da plataforma.
- Nenhuma outra chamada a `supabase.auth.signUp` deve sobrar no app
  (verificar por grep na implementação).

### 2. Tela admin de criação de usuários

- **Página `/admin/usuarios`** (server component):
  - Valida platform admin no servidor; não-admin (ou deslogado) recebe
    **404** (`notFound()`), para não vazar a existência da rota.
  - Sem link na sidebar por ora — acesso por URL direta (YAGNI).
  - Formulário: nome completo, e-mail, nome da empresa (`account_name`).
- **`POST /api/admin/users`**:
  - Protegida por `requirePlatformAdmin()` (allowlist `PLATFORM_ADMIN_USER_IDS`,
    mesmo padrão das rotas do pool de proxies — 401 sem sessão, 403 fora da
    allowlist).
  - Gera senha forte de 16 caracteres com `crypto` (letras maiúsculas e
    minúsculas, dígitos e símbolos seguros para copiar/colar).
  - Cria o usuário via cliente service role:
    `auth.admin.createUser({ email, password, email_confirm: true,
    app_metadata: { must_change_password: true },
    user_metadata: { full_name, account_name } })`.
    `email_confirm: true` porque o e-mail foi validado na negociação — nenhum
    e-mail de verificação é enviado.
  - Resposta: `{ email, temp_password }`. E-mail já cadastrado → 409 com
    mensagem clara. A senha não é persistida em lugar nenhum além do hash do
    próprio Supabase.
- **UI pós-criação:** e-mail + senha temporária exibidos uma única vez, com
  botão de copiar e aviso de que a senha não poderá ser vista de novo.
- **Nome da conta SEM migration:** a rota admin, logo após o `createUser`,
  renomeia a conta que o trigger `handle_new_user` acabou de criar
  (`UPDATE accounts SET name = account_name WHERE owner_user_id = <id>`,
  via service role). Decisão tomada no planejamento: as migrations 031-040
  vivem na branch `feat/antiban-fase1` (não mergeada) e reescrevem o
  `handle_new_user`; uma migration aqui teria que funcionar em dois schemas
  diferentes dependendo da ordem de merge. O rename pós-criação funciona
  nos dois mundos e dispensa migration.

### 3. Troca obrigatória de senha no primeiro login

- **Flag:** `app_metadata.must_change_password: true`, gravada na criação pelo
  admin. `app_metadata` só é escrevível com service role — o usuário não
  consegue limpar a própria flag.
- **Enforcement no middleware** (`src/middleware.ts`): o middleware já chama
  `supabase.auth.getUser()` em toda request e a resposta traz `app_metadata`
  direto do servidor de auth — zero query extra. Com a flag ligada:
  - Páginas → redirect para `/trocar-senha` (exceto a própria `/trocar-senha`
    e as rotas públicas de auth).
  - `/api/*` → 403 JSON `{ error: "password_change_required" }`, exceto
    `POST /api/auth/change-password`.
  - Assets/estáticos já ficam fora pelo matcher atual.
- **Página `/trocar-senha`:** requer sessão. Campos: nova senha + confirmação,
  mínimo 8 caracteres. Explica que é o primeiro acesso e a senha temporária
  precisa ser substituída.
- **`POST /api/auth/change-password`:**
  1. Valida a sessão (cliente SSR).
  2. Valida a senha (>= 8 chars, confirmação igual).
  3. `auth.updateUser({ password })` com a sessão do usuário.
  4. Limpa a flag via service role:
     `auth.admin.updateUserById(user.id, { app_metadata: { must_change_password: false } })`.
  5. Cliente redireciona para `/dashboard`. Como o middleware lê o
     `app_metadata` fresco via `getUser()`, o próximo request já passa.
- **Recovery ("Esqueci minha senha") — conserto incluído no escopo:** o
  fluxo está quebrado hoje: `forgot-password` manda o e-mail com
  `redirectTo: /auth/callback?next=/reset-password`, mas nem `/auth/callback`
  nem `/reset-password` existem no repo — o link do e-mail cai em 404. Com
  usuários criados manualmente, recuperar senha vira essencial, então esta
  feature conserta o fluxo reaproveitando as peças novas:
  - Novo route handler `GET /auth/callback`: troca o código da URL por
    sessão (`exchangeCodeForSession`) e redireciona para `next`.
  - O `redirectTo` do `forgot-password` passa a apontar para
    `/auth/callback?next=/trocar-senha` — a MESMA página da troca
    obrigatória serve de página de redefinição (título genérico "Definir
    nova senha"; ela só precisa de sessão).
  - Como a redefinição usa `POST /api/auth/change-password`, a flag
    `must_change_password` é limpa em qualquer redefinição bem-sucedida —
    trocar a senha é exatamente o requisito.
- **Logout com a flag ligada funciona:** o `signOut()` do client fala direto
  com o Supabase e não passa pelo middleware.

### 4. Erros, casos de borda e testes

- A decisão de redirecionamento do middleware vira um helper puro e testável
  (ex.: `resolveMustChangePassword(user, pathname)` → `"allow" | "redirect" |
  "forbid"`), no padrão de testes já existente no repo.
- Testes de rota:
  - `POST /api/admin/users`: 401 sem sessão, 403 fora da allowlist, sucesso
    (usuário criado com flag + metadata certos, senha com 16 chars), 409
    e-mail duplicado.
  - `POST /api/auth/change-password`: 401 sem sessão, 400 senha curta /
    confirmação divergente, sucesso troca senha E limpa flag.
- Casos de borda cobertos pelo design:
  - Link antigo de `/signup` (inclusive `?invite=`) → redirect para `/login`
    preservando `?invite=` quando presente.
  - Usuário com flag ligada tentando navegar direto para qualquer rota
    protegida ou API → sempre acaba em `/trocar-senha` / 403.
  - Convite para pessoa sem usuário: a página `/join` orienta a entrar; a
    criação do usuário acontece com os donos (fora do fluxo do convite).

## Critérios de aceite

1. `/signup` não existe mais como página; a URL redireciona para `/login`.
2. `/login` não tem link de criar conta.
3. `/join/[token]` deslogado só oferece "Entrar"; nenhum texto do fluxo de
   convite sugere criar conta.
4. Com "Allow new users to sign up" desligado no painel, `signUp` direto na
   API do Supabase falha (verificação manual dos donos).
5. Platform admin cria usuário em `/admin/usuarios` e vê a senha temporária
   uma única vez.
6. Não-admin: 404 na página `/admin/usuarios`, 401/403 na API.
7. Login com senha temporária: qualquer página protegida leva a
   `/trocar-senha`; qualquer API responde 403 até a troca.
8. Depois da troca: navegação e APIs normais; flag limpa no auth.
9. Fluxo "Esqueci minha senha" funciona ponta a ponta (e-mail → callback →
   `/trocar-senha` → senha nova) e também limpa a flag.

## Checklist manual (donos da plataforma)

- [ ] Supabase → Authentication → Sign In/Up → desligar **Allow new users to
      sign up** (projeto de produção e de dev).
- [ ] Conferir que `PLATFORM_ADMIN_USER_IDS` contém os UUIDs dos donos no
      ambiente de produção.

## Fora de escopo

- Link "Admin" na sidebar / área admin navegável.
- Gestão de usuários além da criação (desativar, resetar senha pelo admin,
  listar) — pode virar iteração futura da mesma tela.
- Expiração da senha temporária ou do primeiro acesso.
- Alterar o fluxo de convites além de remover o caminho de signup.
