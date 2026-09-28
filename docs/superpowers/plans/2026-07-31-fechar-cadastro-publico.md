# Fechar Cadastro Público — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar todo caminho de auto-cadastro, criar usuários apenas via tela admin (senha temporária gerada) e forçar troca de senha no primeiro login.

**Architecture:** Flag `must_change_password` em `app_metadata` (só service role escreve), aplicada no `middleware.ts` sem query extra (o `getUser()` já devolve `app_metadata`). Criação de usuário via `auth.admin.createUser` numa rota protegida por `requirePlatformAdmin` (allowlist por env). O fluxo de recovery quebrado (`/auth/callback` inexistente) é consertado reaproveitando a página `/trocar-senha`.

**Tech Stack:** Next.js App Router, Supabase (`@supabase/ssr` + service role), vitest, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-07-31-fechar-cadastro-publico-design.md`

## Global Constraints

- Branch de trabalho: `feat/fechar-cadastro-publico` (criada a partir da `main`; a `feat/antiban-fase1` NÃO está mergeada — não dependa de nada que só existe lá, exceto o conteúdo copiado verbatim na Task 1).
- **NENHUMA migration SQL** neste trabalho (decisão de spec: evitar conflito de schema com as migrations 031-040 da antiban). O nome da conta é ajustado via `UPDATE accounts` na rota admin.
- Copy de UI em PT-BR, sem travessão (—) em textos de interface (padrão do repo, ver commit c31f762).
- Senha temporária: exatamente 16 caracteres. Senha nova do usuário: mínimo 8 (`MIN_PASSWORD = 8`, igual a `src/components/settings/password-form.tsx`).
- Antes de mexer em rota/middleware/página, leia o guia correspondente em `node_modules/next/dist/docs/` (AGENTS.md: este Next.js tem breaking changes vs. o que você conhece).
- Testes: `npm test -- <arquivo>` roda vitest (`vitest run`). Ambiente `node` (vitest.config.ts). Env vars `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` precisam ser setadas em `beforeEach` quando o módulo testado as lê (padrão de `src/middleware.test.ts`).
- Commits: conventional commits em PT-BR (ex.: `feat(auth): ...`), terminando com a linha `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- A UI usa os componentes de `@/components/ui/*` (shadcn) e as classes de tema (`bg-background`, `text-foreground`, `border-border`, `bg-card`, `text-muted-foreground`, `bg-primary`...) — copie o estilo das páginas de auth existentes, nunca cores hardcoded.

---

### Task 1: Recriar `platform-admin.ts` (port verbatim da antiban)

O módulo `src/lib/auth/platform-admin.ts` existe apenas na branch `feat/antiban-fase1` (commit c66a0e6). Recriamos aqui **byte-idêntico** para que o merge futuro auto-resolva ("both added" com conteúdo igual). Por ser um port de código já revisado e testado na outra branch (4be8da5), esta task não tem ciclo TDD próprio — os testes de rota da Task 6 exercitam o contrato.

**Files:**
- Create: `src/lib/auth/platform-admin.ts`
- Modify: `.env.local.example` (adicionar `PLATFORM_ADMIN_USER_IDS`)

**Interfaces:**
- Consumes: `UnauthorizedError`, `ForbiddenError` de `src/lib/auth/account.ts` (já existem na main, `account.ts:41-55`).
- Produces: `requirePlatformAdmin(): Promise<void>` — lança `UnauthorizedError` sem sessão, `ForbiddenError` se o user não está na allowlist `PLATFORM_ADMIN_USER_IDS`. Usada nas Tasks 6/7.

- [ ] **Step 1: Criar o arquivo com o conteúdo EXATO abaixo** (não reformatar, não "melhorar" — precisa ser idêntico ao da antiban):

```typescript
// ============================================================
// Allowlist de administradores de plataforma (agência) — para
// rotas que gerenciam recursos globais da agência, sem
// `account_id`, como o pool de proxies.
//
// Por que `requireRole("owner")` NÃO serve aqui:
//   `handle_new_user` (supabase/migrations/031_multi_account_
//   membership.sql) cria uma conta nova com o usuário como
//   "owner" para TODO cadastro em `/signup`, sem exigir convite.
//   "owner" significa apenas "dono de alguma conta", não "faz
//   parte da agência". Como estas rotas usam o cliente com
//   service role (ignora RLS), este check é o ÚNICO portão de
//   autorização — não pode depender de um papel que qualquer
//   pessoa ganha ao se cadastrar.
//
// FAIL-CLOSED por design: `PLATFORM_ADMIN_USER_IDS` ausente ou
// vazia significa que NINGUÉM é admin de plataforma, nunca que
// todo mundo é. Uma implementação que libera geral quando a env
// falta é pior do que o bug que este módulo corrige.
// ============================================================

import { createClient } from "@/lib/supabase/server";
import { ForbiddenError, UnauthorizedError } from "./account";

/**
 * Lê `PLATFORM_ADMIN_USER_IDS` (UUIDs separados por vírgula,
 * tolerando espaços em volta) e devolve o conjunto de IDs
 * permitidos. Vazio ou ausente devolve um Set vazio.
 */
function loadAllowlist(): Set<string> {
  const raw = process.env.PLATFORM_ADMIN_USER_IDS ?? "";
  return new Set(
    raw
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
  );
}

/**
 * Garante que o usuário autenticado atual está na allowlist de
 * administradores de plataforma.
 *
 * Segue o mesmo padrão de `getCurrentAccount()` (src/lib/auth/
 * account.ts) para resolver o usuário: cliente SSR + `auth.
 * getUser()`. Não reimplementa autenticação.
 *
 * Lança `UnauthorizedError` se não houver sessão válida, e
 * `ForbiddenError` se o usuário estiver autenticado mas não
 * constar na allowlist (inclusive quando a variável de ambiente
 * está ausente ou vazia).
 */
export async function requirePlatformAdmin(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    throw new UnauthorizedError();
  }

  const allowlist = loadAllowlist();
  if (!allowlist.has(user.id)) {
    throw new ForbiddenError(
      "This action requires platform admin access",
    );
  }
}
```

- [ ] **Step 2: Adicionar a env no `.env.local.example`**, logo após a linha `SUPABASE_SERVICE_ROLE_KEY=your-service-role-key`:

```bash
# UUIDs (separados por virgula) dos usuarios donos da plataforma.
# Vazio ou ausente = ninguem e admin (fail-closed).
PLATFORM_ADMIN_USER_IDS=
```

- [ ] **Step 3: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sem erros novos (o módulo importa apenas coisas que existem na main).

- [ ] **Step 4: Commit**

```bash
git add src/lib/auth/platform-admin.ts .env.local.example
git commit -m "feat(auth): porta requirePlatformAdmin da feat/antiban-fase1 (verbatim)"
```

---

### Task 2: Gerador de senha temporária

**Files:**
- Create: `src/lib/auth/temp-password.ts`
- Test: `src/lib/auth/temp-password.test.ts`

**Interfaces:**
- Consumes: `node:crypto` (`randomInt`).
- Produces: `generateTempPassword(): string` — 16 chars, pelo menos 1 maiúscula, 1 minúscula, 1 dígito e 1 símbolo; sem caracteres confundíveis (`I`, `l`, `O`, `0`, `1`). Usada na Task 6.

- [ ] **Step 1: Escrever o teste que falha**

```typescript
// src/lib/auth/temp-password.test.ts
import { describe, expect, it } from "vitest";
import {
  generateTempPassword,
  TEMP_PASSWORD_LENGTH,
} from "./temp-password";

describe("generateTempPassword", () => {
  it("gera exatamente 16 caracteres", () => {
    expect(generateTempPassword()).toHaveLength(16);
    expect(TEMP_PASSWORD_LENGTH).toBe(16);
  });

  it("contém pelo menos uma maiúscula, uma minúscula, um dígito e um símbolo", () => {
    // 50 amostras para não passar por sorte com uma senha boa.
    for (let i = 0; i < 50; i++) {
      const pw = generateTempPassword();
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[0-9]/);
      expect(pw).toMatch(/[!@#$%&*+\-=?]/);
    }
  });

  it("não usa caracteres confundíveis (I, l, O, 0, 1)", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateTempPassword()).not.toMatch(/[IlO01]/);
    }
  });

  it("gera senhas diferentes a cada chamada", () => {
    const seen = new Set(
      Array.from({ length: 20 }, () => generateTempPassword()),
    );
    expect(seen.size).toBe(20);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- src/lib/auth/temp-password.test.ts`
Expected: FAIL — módulo `./temp-password` não existe.

- [ ] **Step 3: Implementar**

```typescript
// src/lib/auth/temp-password.ts
// ============================================================
// Senha temporária para usuários criados pelo admin da
// plataforma. Gerada no servidor, exibida UMA vez na tela e
// nunca persistida fora do hash do próprio Supabase Auth.
//
// Alfabeto sem confundíveis (I/l/O/0/1) porque a senha é
// transmitida ao cliente por canal humano (WhatsApp, e-mail)
// e pode acabar digitada à mão.
// ============================================================
import { randomInt } from "node:crypto";

const UPPER = "ABCDEFGHJKMNPQRSTUVWXYZ"; // sem I, L, O
const LOWER = "abcdefghijkmnpqrstuvwxyz"; // sem l
const DIGITS = "23456789";
const SYMBOLS = "!@#$%&*+-=?";
const ALL = UPPER + LOWER + DIGITS + SYMBOLS;

export const TEMP_PASSWORD_LENGTH = 16;

function pick(alphabet: string): string {
  return alphabet[randomInt(alphabet.length)];
}

export function generateTempPassword(): string {
  // Garante uma amostra de cada classe; o resto vem do alfabeto
  // completo. Embaralha com Fisher-Yates para a posição das
  // classes garantidas não ser previsível.
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < TEMP_PASSWORD_LENGTH) {
    chars.push(pick(ALL));
  }
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- src/lib/auth/temp-password.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/temp-password.ts src/lib/auth/temp-password.test.ts
git commit -m "feat(auth): gerador de senha temporaria forte de 16 caracteres"
```

---

### Task 3: Helper puro de decisão `must_change_password`

**Files:**
- Create: `src/lib/auth/must-change-password.ts`
- Test: `src/lib/auth/must-change-password.test.ts`

**Interfaces:**
- Consumes: nada (função pura).
- Produces: `resolveMustChangePassword(user, pathname): "allow" | "redirect" | "forbid"` com `user: { app_metadata?: Record<string, unknown> } | null`. Usada pelo middleware na Task 4. Exporta também o type `MustChangeDecision`.

- [ ] **Step 1: Escrever o teste que falha**

```typescript
// src/lib/auth/must-change-password.test.ts
import { describe, expect, it } from "vitest";
import { resolveMustChangePassword } from "./must-change-password";

const flagged = { app_metadata: { must_change_password: true } };

describe("resolveMustChangePassword", () => {
  it("permite tudo sem usuário (rotas públicas, webhooks)", () => {
    expect(resolveMustChangePassword(null, "/dashboard")).toBe("allow");
    expect(resolveMustChangePassword(null, "/api/whatsapp/webhook")).toBe("allow");
  });

  it("permite tudo para usuário sem a flag", () => {
    expect(resolveMustChangePassword({ app_metadata: {} }, "/dashboard")).toBe("allow");
    expect(
      resolveMustChangePassword({ app_metadata: { must_change_password: false } }, "/inbox"),
    ).toBe("allow");
    // Sem app_metadata nenhum (defensivo)
    expect(resolveMustChangePassword({}, "/dashboard")).toBe("allow");
  });

  it("redireciona páginas quando a flag está ligada", () => {
    expect(resolveMustChangePassword(flagged, "/dashboard")).toBe("redirect");
    expect(resolveMustChangePassword(flagged, "/inbox")).toBe("redirect");
    expect(resolveMustChangePassword(flagged, "/login")).toBe("redirect");
    expect(resolveMustChangePassword(flagged, "/")).toBe("redirect");
  });

  it("bloqueia APIs com 403 quando a flag está ligada", () => {
    expect(resolveMustChangePassword(flagged, "/api/contacts")).toBe("forbid");
    expect(resolveMustChangePassword(flagged, "/api/whatsapp/send")).toBe("forbid");
  });

  it("isenta a própria página de troca, a rota de troca e o callback de auth", () => {
    expect(resolveMustChangePassword(flagged, "/trocar-senha")).toBe("allow");
    expect(resolveMustChangePassword(flagged, "/api/auth/change-password")).toBe("allow");
    expect(resolveMustChangePassword(flagged, "/auth/callback")).toBe("allow");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- src/lib/auth/must-change-password.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```typescript
// src/lib/auth/must-change-password.ts
// ============================================================
// Decisão pura do middleware para usuários com senha temporária
// (app_metadata.must_change_password = true, gravada pelo admin
// na criação — só a service role escreve app_metadata, o próprio
// usuário não consegue limpar a flag).
//
// Extraída do middleware para ser testável sem NextRequest.
// ============================================================

export type MustChangeDecision = "allow" | "redirect" | "forbid";

interface UserLike {
  app_metadata?: Record<string, unknown>;
}

const EXEMPT_PAGES = new Set(["/trocar-senha"]);
const EXEMPT_APIS = new Set(["/api/auth/change-password"]);
// O callback precisa passar para o fluxo de recovery conseguir
// estabelecer a sessão ANTES de cair em /trocar-senha.
const EXEMPT_PREFIXES = ["/auth/callback"];

export function resolveMustChangePassword(
  user: UserLike | null,
  pathname: string,
): MustChangeDecision {
  if (!user || user.app_metadata?.must_change_password !== true) {
    return "allow";
  }
  if (EXEMPT_PAGES.has(pathname)) return "allow";
  if (EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return "allow";
  }
  if (pathname.startsWith("/api/")) {
    return EXEMPT_APIS.has(pathname) ? "allow" : "forbid";
  }
  return "redirect";
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- src/lib/auth/must-change-password.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/must-change-password.ts src/lib/auth/must-change-password.test.ts
git commit -m "feat(auth): helper puro de enforcement da troca obrigatoria de senha"
```

---

### Task 4: Middleware — enforcement da flag + redirect de `/signup`

**Files:**
- Modify: `src/middleware.ts`
- Test: `src/middleware.test.ts` (adicionar casos; NÃO tocar nos existentes)

**Interfaces:**
- Consumes: `resolveMustChangePassword` (Task 3).
- Produces: comportamento HTTP — flag ligada: páginas → 307 `/trocar-senha`, `/api/*` → 403 `{ error: "password_change_required" }`; `/signup` deslogado → 307 `/login` preservando query. Também adiciona `/trocar-senha` e `/admin` a `protectedPaths`.

- [ ] **Step 1: Adicionar os testes que falham em `src/middleware.test.ts`**

Primeiro, alargue o tipo do knob `mockUser` no topo do arquivo (linha ~11) — de:

```typescript
let mockUser: { id: string } | null = null;
```

para:

```typescript
let mockUser: {
  id: string;
  app_metadata?: Record<string, unknown>;
} | null = null;
```

Depois acrescente este `describe` no fim do arquivo:

```typescript
describe("middleware — troca obrigatória de senha e /signup fechado", () => {
  const flaggedUser = {
    id: "user-1",
    app_metadata: { must_change_password: true },
  };

  it("redireciona páginas para /trocar-senha quando a flag está ligada", async () => {
    mockUser = flaggedUser;
    refreshedCookies = [ROTATED];

    const res = await middleware(new NextRequest("https://app.test/dashboard"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/trocar-senha");
    // Cookies rotacionados sobrevivem também a este redirect novo.
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });

  it("responde 403 password_change_required em APIs quando a flag está ligada", async () => {
    mockUser = flaggedUser;

    const res = await middleware(
      new NextRequest("https://app.test/api/whatsapp/send"),
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "password_change_required" });
  });

  it("deixa o usuário com flag acessar /trocar-senha", async () => {
    mockUser = flaggedUser;

    const res = await middleware(
      new NextRequest("https://app.test/trocar-senha"),
    );

    expect(res.headers.get("location")).toBeNull();
  });

  it("usuário sem flag navega normalmente", async () => {
    mockUser = { id: "user-1", app_metadata: {} };

    const res = await middleware(new NextRequest("https://app.test/inbox"));

    expect(res.headers.get("location")).toBeNull();
  });

  it("redireciona /signup deslogado para /login preservando ?invite=", async () => {
    mockUser = null;

    const res = await middleware(
      new NextRequest("https://app.test/signup?invite=abc123"),
    );

    expect(res.status).toBe(307);
    const location = res.headers.get("location")!;
    expect(location).toContain("/login");
    expect(location).toContain("invite=abc123");
  });

  it("exige login em /trocar-senha e /admin", async () => {
    mockUser = null;

    for (const path of ["/trocar-senha", "/admin/usuarios"]) {
      const res = await middleware(new NextRequest(`https://app.test${path}`));
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toContain("/login");
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- src/middleware.test.ts`
Expected: os 6 casos novos FALHAM; os 4 antigos continuam passando.

- [ ] **Step 3: Implementar no `src/middleware.ts`**

Importar o helper no topo:

```typescript
import { resolveMustChangePassword } from '@/lib/auth/must-change-password'
```

Logo APÓS a definição de `withRefreshedCookies` (linha ~43) e ANTES do bloco "Auth pages" existente, inserir:

```typescript
  // Senha temporária — usuário criado pelo admin precisa trocar a
  // senha antes de usar qualquer coisa. A flag vive em app_metadata
  // (só service role escreve) e getUser() acima já a trouxe fresca
  // do servidor de auth — nenhuma query extra aqui.
  const mustChange = resolveMustChangePassword(user, request.nextUrl.pathname)
  if (mustChange === 'forbid') {
    return withRefreshedCookies(
      NextResponse.json({ error: 'password_change_required' }, { status: 403 })
    )
  }
  if (mustChange === 'redirect') {
    const url = request.nextUrl.clone()
    url.pathname = '/trocar-senha'
    url.search = ''
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  // Cadastro fechado: /signup não existe mais. Links antigos caem
  // no login; ?invite= sobrevive para o fluxo de convite.
  if (!user && request.nextUrl.pathname === '/signup') {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return withRefreshedCookies(NextResponse.redirect(url))
  }
```

E na linha dos `protectedPaths` (linha ~73), acrescentar as duas rotas novas:

```typescript
  const protectedPaths = ['/dashboard', '/inbox', '/contacts', '/pipelines', '/broadcasts', '/automations', '/settings', '/trocar-senha', '/admin']
```

Nota: o bloco "Auth pages" existente continua tratando `/signup` para usuário LOGADO (→ `/dashboard` ou `/join/<token>`); não mexa nele.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- src/middleware.test.ts`
Expected: PASS (10 testes: 4 antigos + 6 novos).

- [ ] **Step 5: Commit**

```bash
git add src/middleware.ts src/middleware.test.ts
git commit -m "feat(auth): middleware forca troca de senha e fecha /signup"
```

---

### Task 5: Remover a página `/signup` e todo caminho de cadastro na UI

Sem teste unitário novo (mudança de JSX/copy); o portão é typecheck + suíte inteira + build.

**Files:**
- Delete: `src/app/(auth)/signup/page.tsx`
- Modify: `src/app/(auth)/login/page.tsx`
- Modify: `src/app/join/[token]/page.tsx`
- Modify: `src/app/(auth)/layout.tsx` (só o comentário que cita signup)

**Interfaces:**
- Consumes: o redirect `/signup` → `/login` do middleware (Task 4) cobre links antigos.
- Produces: nenhum código consumido por outras tasks.

- [ ] **Step 1: Apagar a página de signup**

```bash
git rm src/app/(auth)/signup/page.tsx
```

- [ ] **Step 2: Login sem "Criar conta"** — em `src/app/(auth)/login/page.tsx`, remover o bloco inteiro (linhas ~138-150):

```tsx
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Não tem uma conta?{" "}
            <Link ...>
              Criar conta
            </Link>
          </p>
```

Com isso o import de `Link` pode ficar órfão — verifique: o link "Esqueci minha senha" também usa `Link`, então o import FICA.

- [ ] **Step 3: `/join/[token]` sem caminho de cadastro** — em `src/app/join/[token]/page.tsx`:

3a. No estado **deslogado** (bloco final do componente, linhas ~411-430), substituir os dois links por um único CTA de login:

```tsx
  // ----- Not authed: prompt to sign in -----
  return (
    <Card className="w-full max-w-md border-border bg-card">
      {inviteHeader}
      <CardContent className="flex flex-col gap-2">
        <Link href={`/login?invite=${encodeURIComponent(token!)}`}>
          <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
            Entrar para aceitar
          </Button>
        </Link>
        <p className="text-center text-xs text-muted-foreground">
          Ainda não tem acesso? Peça a quem convidou você para
          solicitar a criação do seu usuário.
        </p>
      </CardContent>
    </Card>
  );
```

3b. Nos **cards de erro** (bloco `if (!peek.ok)`, linhas ~254-287), trocar os CTAs "Criar uma nova conta" por login. O branch `server_error` fica:

```tsx
            <>
              <Button
                onClick={loadPeekAndAuth}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Tentar novamente
              </Button>
              <Link href="/login">
                <Button
                  variant="outline"
                  className="w-full border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  Ir para o login
                </Button>
              </Link>
            </>
```

E o branch dos erros terminais (`not_found` / `used` / `expired`):

```tsx
            <Link href="/login">
              <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
                Ir para o login
              </Button>
            </Link>
```

3c. No **modal de conflito** (409), atualizar o parágrafo explicativo (linhas ~372-380) — não existe mais "criar conta com outro e-mail":

```tsx
            <div className="space-y-2 py-2 text-xs text-muted-foreground">
              <p>
                Para entrar em{' '}
                <span className="text-popover-foreground">{peek.account_name}</span>,
                saia e entre com um usuário diferente. Se a pessoa ainda não
                tem acesso, peça ao administrador da plataforma para criar o
                usuário. O link do convite continua válido enquanto não
                expirar.
              </p>
            </div>
```

E o texto do botão `handleSignOutAndRetry` de `'Sair e usar outro e-mail'` para `'Sair e entrar com outro usuário'`.

3d. Na nota abaixo do botão "Aceitar convite" (linhas ~344-348), remover a menção ao cadastro:

```tsx
            <p className="text-center text-xs text-muted-foreground">
              Ao aceitar, seu login passa a fazer parte de{' '}
              <span className="text-muted-foreground">{peek.account_name}</span>. Sua
              conta pessoal vazia será removida.
            </p>
```

3e. Grep de segurança — nada mais no arquivo pode apontar para `/signup`:

Run (Git Bash): `grep -in "signup" "src/app/join/[token]/page.tsx"`
Expected: 0 ocorrências (exit code 1).

- [ ] **Step 4: Comentário do layout** — em `src/app/(auth)/layout.tsx` linha 4, atualizar `(login / signup / forgot-password)` para `(login / forgot-password / trocar-senha)`.

- [ ] **Step 5: Verificar que não sobrou porta de cadastro**

Run: `grep -rn "signUp\|/signup" src/ --include=*.ts --include=*.tsx`
Expected: as únicas ocorrências restantes são o tratamento de `/signup` no `src/middleware.ts` (redirects) e o teste do middleware. NENHUM `supabase.auth.signUp(` sobrando no app.

- [ ] **Step 6: Suíte + typecheck + build**

Run: `npm test` e depois `npx tsc --noEmit`
Expected: tudo verde, sem referências quebradas à página removida.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(auth): remove pagina de signup e caminhos de cadastro na UI"
```

---

### Task 6: Service role de auth + rota `POST /api/admin/users`

**Files:**
- Create: `src/lib/auth/admin-client.ts`
- Create: `src/app/api/admin/users/route.ts`
- Test: `src/app/api/admin/users/route.test.ts`

**Interfaces:**
- Consumes: `requirePlatformAdmin` (Task 1), `generateTempPassword`/`TEMP_PASSWORD_LENGTH` (Task 2), `toErrorResponse` de `@/lib/auth/account`.
- Produces:
  - `supabaseAdmin(): SupabaseClient` em `@/lib/auth/admin-client` (usada também na Task 8).
  - `POST /api/admin/users` — body `{ full_name: string, email: string, account_name: string }`; respostas: `201 { email, temp_password }`, `400` inválido, `401/403` sem permissão, `409` e-mail já existe, `500` erro do Supabase.

- [ ] **Step 1: Criar `src/lib/auth/admin-client.ts`** (mesmo padrão de `src/lib/automations/admin-client.ts`):

```typescript
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy, shared service-role client para operações de auth admin
// (criar usuário, limpar app_metadata). Mirrors o padrão de
// src/lib/automations/admin-client.ts.
let _adminClient: SupabaseClient | null = null

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}
```

- [ ] **Step 2: Escrever o teste da rota (falhando)**

```typescript
// src/app/api/admin/users/route.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth/account";

// ---- Knobs -----------------------------------------------------------------
let requireAdminError: Error | null = null;
const createUser = vi.fn();
const accountUpdateEq = vi.fn();

vi.mock("@/lib/auth/platform-admin", () => ({
  requirePlatformAdmin: async () => {
    if (requireAdminError) throw requireAdminError;
  },
}));

vi.mock("@/lib/auth/admin-client", () => ({
  supabaseAdmin: () => ({
    auth: { admin: { createUser } },
    from: () => ({ update: () => ({ eq: accountUpdateEq }) }),
  }),
}));

const { POST } = await import("./route");

function post(body: unknown): Request {
  return new Request("https://app.test/api/admin/users", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  full_name: "Cliente Exemplo",
  email: "cliente@exemplo.com",
  account_name: "Empresa Exemplo",
};

beforeEach(() => {
  requireAdminError = null;
  createUser.mockReset().mockResolvedValue({
    data: { user: { id: "new-user-id" } },
    error: null,
  });
  accountUpdateEq.mockReset().mockResolvedValue({ error: null });
});

describe("POST /api/admin/users", () => {
  it("401 sem sessão", async () => {
    requireAdminError = new UnauthorizedError();
    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(401);
    expect(createUser).not.toHaveBeenCalled();
  });

  it("403 fora da allowlist", async () => {
    requireAdminError = new ForbiddenError();
    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(403);
    expect(createUser).not.toHaveBeenCalled();
  });

  it("400 quando faltam campos ou o e-mail é inválido", async () => {
    for (const body of [
      { ...VALID_BODY, full_name: "  " },
      { ...VALID_BODY, account_name: "" },
      { ...VALID_BODY, email: "nao-e-email" },
      {},
    ]) {
      const res = await POST(post(body));
      expect(res.status).toBe(400);
    }
    expect(createUser).not.toHaveBeenCalled();
  });

  it("201 cria usuário confirmado, com flag e metadata, e devolve a senha", async () => {
    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(201);

    const payload = await res.json();
    expect(payload.email).toBe("cliente@exemplo.com");
    expect(payload.temp_password).toHaveLength(16);

    expect(createUser).toHaveBeenCalledWith({
      email: "cliente@exemplo.com",
      password: payload.temp_password,
      email_confirm: true,
      app_metadata: { must_change_password: true },
      user_metadata: {
        full_name: "Cliente Exemplo",
        account_name: "Empresa Exemplo",
      },
    });
    // Renomeia a conta criada pelo trigger handle_new_user.
    expect(accountUpdateEq).toHaveBeenCalledWith("owner_user_id", "new-user-id");
  });

  it("normaliza o e-mail para minúsculas", async () => {
    await POST(post({ ...VALID_BODY, email: "Cliente@Exemplo.COM" }));
    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "cliente@exemplo.com" }),
    );
  });

  it("409 quando o e-mail já está cadastrado", async () => {
    createUser.mockResolvedValue({
      data: { user: null },
      error: { code: "email_exists", message: "User already registered", status: 422 },
    });
    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(409);
  });

  it("500 opaco para outros erros do Supabase", async () => {
    createUser.mockResolvedValue({
      data: { user: null },
      error: { code: "unexpected_failure", message: "boom", status: 500 },
    });
    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(500);
    expect((await res.json()).error).not.toContain("boom");
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm test -- src/app/api/admin/users/route.test.ts`
Expected: FAIL — `./route` não existe.

- [ ] **Step 4: Implementar a rota**

```typescript
// src/app/api/admin/users/route.ts
// ============================================================
// Criação manual de usuários pelos donos da plataforma.
// Cadastro público está DESLIGADO (painel do Supabase + sem
// página /signup) — esta rota é o único caminho de criação.
//
// A senha temporária volta UMA vez na resposta e não é
// persistida em lugar nenhum além do hash do Supabase Auth.
// ============================================================
import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/auth/platform-admin";
import { toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/auth/admin-client";
import { generateTempPassword } from "@/lib/auth/temp-password";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  try {
    await requirePlatformAdmin();
  } catch (err) {
    return toErrorResponse(err);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo JSON inválido" }, { status: 400 });
  }

  const fullName =
    typeof body.full_name === "string" ? body.full_name.trim() : "";
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const accountName =
    typeof body.account_name === "string" ? body.account_name.trim() : "";

  if (!fullName || !accountName || !EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "Informe nome completo, e-mail válido e nome da empresa" },
      { status: 400 },
    );
  }

  const tempPassword = generateTempPassword();
  const admin = supabaseAdmin();

  // email_confirm: o e-mail foi validado na negociação comercial;
  // nenhum e-mail de verificação é enviado ao cliente.
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    app_metadata: { must_change_password: true },
    user_metadata: { full_name: fullName, account_name: accountName },
  });

  if (error || !data.user) {
    if (
      error?.code === "email_exists" ||
      /already.*registered/i.test(error?.message ?? "")
    ) {
      return NextResponse.json(
        { error: "Já existe um usuário com este e-mail" },
        { status: 409 },
      );
    }
    console.error("[admin/users] createUser:", error);
    return NextResponse.json(
      { error: "Não foi possível criar o usuário" },
      { status: 500 },
    );
  }

  // O trigger handle_new_user acabou de criar a conta pessoal do
  // usuário nomeada pelo full_name. Renomeia para o nome da
  // empresa. Falha aqui não é fatal (a conta existe, só com o
  // nome menos bonito) — loga e segue.
  const { error: renameError } = await admin
    .from("accounts")
    .update({ name: accountName })
    .eq("owner_user_id", data.user.id);
  if (renameError) {
    console.error("[admin/users] rename account:", renameError);
  }

  return NextResponse.json(
    { email, temp_password: tempPassword },
    { status: 201 },
  );
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test -- src/app/api/admin/users/route.test.ts`
Expected: PASS (7 testes).

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/admin-client.ts src/app/api/admin/users/route.ts src/app/api/admin/users/route.test.ts
git commit -m "feat(admin): rota de criacao de usuario com senha temporaria"
```

---

### Task 7: Página `/admin/usuarios` + formulário

Página server-side com guard (404 para não-admin) e formulário client-side. Sem teste unitário (UI); portão é typecheck + verificação manual no fim.

**Files:**
- Create: `src/app/admin/usuarios/page.tsx`
- Create: `src/components/admin/create-user-form.tsx`

**Interfaces:**
- Consumes: `requirePlatformAdmin` (Task 1); `POST /api/admin/users` (Task 6).
- Produces: nada consumido por outras tasks.

- [ ] **Step 1: Página com guard**

```tsx
// src/app/admin/usuarios/page.tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/auth/platform-admin";
import { CreateUserForm } from "@/components/admin/create-user-form";

export const metadata: Metadata = {
  title: "Admin | Usuários",
  robots: { index: false, follow: false },
};

// Não-admin (ou deslogado que escapou do middleware) recebe 404,
// não 403 — a existência da área admin não vaza para quem não
// pertence a ela.
export default async function AdminUsuariosPage() {
  try {
    await requirePlatformAdmin();
  } catch {
    notFound();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <CreateUserForm />
    </div>
  );
}
```

- [ ] **Step 2: Formulário com exibição única da senha**

```tsx
// src/components/admin/create-user-form.tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Loader2, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface CreatedUser {
  email: string;
  temp_password: string;
}

export function CreateUserForm() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [accountName, setAccountName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState<CreatedUser | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fullName,
          email,
          account_name: accountName,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error || "Não foi possível criar o usuário");
        return;
      }
      setCreated(payload as CreatedUser);
    } catch {
      setError("Não foi possível conectar ao servidor");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!created) return;
    await navigator.clipboard.writeText(
      `E-mail: ${created.email}\nSenha temporária: ${created.temp_password}`,
    );
    setCopied(true);
    toast.success("Credenciais copiadas");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReset = () => {
    setCreated(null);
    setFullName("");
    setEmail("");
    setAccountName("");
  };

  // ----- Pós-criação: a senha aparece UMA vez -----
  if (created) {
    return (
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <Check className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-xl text-foreground">
            Usuário criado
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Envie as credenciais ao cliente. A senha temporária não
            poderá ser vista de novo depois que você sair desta tela.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="rounded-lg border border-border bg-muted p-4 font-mono text-sm text-foreground">
            <p>E-mail: {created.email}</p>
            <p>Senha temporária: {created.temp_password}</p>
          </div>
          <Button
            onClick={handleCopy}
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            Copiar credenciais
          </Button>
          <Button
            variant="outline"
            onClick={handleReset}
            className="w-full border-border text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Criar outro usuário
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ----- Formulário -----
  return (
    <Card className="w-full max-w-md border-border bg-card">
      <CardHeader className="items-center text-center">
        <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
          <UserPlus className="h-6 w-6 text-primary" />
        </div>
        <CardTitle className="text-xl text-foreground">
          Criar usuário
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          O cliente recebe uma senha temporária e precisa trocá-la no
          primeiro login.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="fullName" className="text-muted-foreground">
              Nome completo
            </Label>
            <Input
              id="fullName"
              type="text"
              placeholder="João da Silva"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="email" className="text-muted-foreground">
              E-mail
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="cliente@empresa.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="accountName" className="text-muted-foreground">
              Nome da empresa
            </Label>
            <Input
              id="accountName"
              type="text"
              placeholder="Empresa do cliente"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              required
              className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
            />
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="mt-2 h-10 w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Criando…
              </>
            ) : (
              "Criar usuário"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Typecheck + suíte**

Run: `npx tsc --noEmit` e `npm test`
Expected: verde.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/usuarios/page.tsx src/components/admin/create-user-form.tsx
git commit -m "feat(admin): pagina /admin/usuarios para criacao manual de clientes"
```

---

### Task 8: Rota `POST /api/auth/change-password`

**Files:**
- Create: `src/app/api/auth/change-password/route.ts`
- Test: `src/app/api/auth/change-password/route.test.ts`

**Interfaces:**
- Consumes: `createClient` de `@/lib/supabase/server`; `supabaseAdmin` (Task 6).
- Produces: `POST /api/auth/change-password` — body `{ password: string, confirm: string }`; respostas `200 { ok: true }`, `400` validação/erro do updateUser, `401` sem sessão, `500` falha ao limpar a flag. Consumida pela página da Task 9. IMPORTANTE: o path está isento no helper da Task 3 — o nome/path não pode divergir de `/api/auth/change-password`.

- [ ] **Step 1: Escrever o teste (falhando)**

```typescript
// src/app/api/auth/change-password/route.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- Knobs -----------------------------------------------------------------
let mockUser: { id: string } | null = null;
const updateUser = vi.fn();
const updateUserById = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: mockUser },
        error: mockUser ? null : { message: "no session" },
      }),
      updateUser,
    },
  }),
}));

vi.mock("@/lib/auth/admin-client", () => ({
  supabaseAdmin: () => ({ auth: { admin: { updateUserById } } }),
}));

const { POST } = await import("./route");

function post(body: unknown): Request {
  return new Request("https://app.test/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockUser = { id: "user-1" };
  updateUser.mockReset().mockResolvedValue({ error: null });
  updateUserById.mockReset().mockResolvedValue({ data: {}, error: null });
});

describe("POST /api/auth/change-password", () => {
  it("401 sem sessão", async () => {
    mockUser = null;
    const res = await POST(post({ password: "12345678", confirm: "12345678" }));
    expect(res.status).toBe(401);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("400 para senha curta", async () => {
    const res = await POST(post({ password: "curta", confirm: "curta" }));
    expect(res.status).toBe(400);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("400 quando a confirmação diverge", async () => {
    const res = await POST(post({ password: "12345678", confirm: "87654321" }));
    expect(res.status).toBe(400);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("200 troca a senha E limpa a flag via service role", async () => {
    const res = await POST(
      post({ password: "nova-senha-123", confirm: "nova-senha-123" }),
    );
    expect(res.status).toBe(200);
    expect(updateUser).toHaveBeenCalledWith({ password: "nova-senha-123" });
    expect(updateUserById).toHaveBeenCalledWith("user-1", {
      app_metadata: { must_change_password: false },
    });
  });

  it("400 repassando a mensagem quando o updateUser falha (ex.: senha igual à anterior)", async () => {
    updateUser.mockResolvedValue({
      error: { message: "New password should be different from the old password." },
    });
    const res = await POST(
      post({ password: "mesma-senha-1", confirm: "mesma-senha-1" }),
    );
    expect(res.status).toBe(400);
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("500 quando limpar a flag falha (senha já trocou, acesso ainda travado)", async () => {
    updateUserById.mockResolvedValue({
      data: null,
      error: { message: "boom" },
    });
    const res = await POST(
      post({ password: "nova-senha-123", confirm: "nova-senha-123" }),
    );
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- src/app/api/auth/change-password/route.test.ts`
Expected: FAIL — `./route` não existe.

- [ ] **Step 3: Implementar**

```typescript
// src/app/api/auth/change-password/route.ts
// ============================================================
// Define a nova senha do usuário logado e limpa a flag
// must_change_password. Serve dois fluxos:
//   1. Troca obrigatória do primeiro login (senha temporária).
//   2. Redefinição via recovery (o callback já estabeleceu a
//      sessão antes de chegar aqui).
// Trocar a senha é exatamente o requisito da flag, então
// QUALQUER troca bem-sucedida limpa a flag.
//
// O path desta rota está isento no middleware
// (src/lib/auth/must-change-password.ts) — se renomear, atualize
// lá também.
// ============================================================
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/auth/admin-client";

const MIN_PASSWORD = 8;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo JSON inválido" }, { status: 400 });
  }

  const password = typeof body.password === "string" ? body.password : "";
  const confirm = typeof body.confirm === "string" ? body.confirm : "";

  if (password.length < MIN_PASSWORD) {
    return NextResponse.json(
      { error: `A senha deve ter pelo menos ${MIN_PASSWORD} caracteres` },
      { status: 400 },
    );
  }
  if (password !== confirm) {
    return NextResponse.json(
      { error: "A nova senha e a confirmação não coincidem" },
      { status: 400 },
    );
  }

  // Troca com a sessão do próprio usuário (cliente SSR).
  const { error: updateError } = await supabase.auth.updateUser({ password });
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  // app_metadata só é escrevível com service role — por isso a
  // limpeza não pode ser feita pelo cliente.
  const { error: flagError } = await supabaseAdmin().auth.admin.updateUserById(
    user.id,
    { app_metadata: { must_change_password: false } },
  );
  if (flagError) {
    console.error("[change-password] clear flag:", flagError);
    return NextResponse.json(
      {
        error:
          "Senha alterada, mas houve um problema ao liberar o acesso. Tente entrar novamente em instantes.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- src/app/api/auth/change-password/route.test.ts`
Expected: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/auth/change-password/route.ts src/app/api/auth/change-password/route.test.ts
git commit -m "feat(auth): rota de troca de senha que limpa a flag de primeiro login"
```

---

### Task 9: Página `/trocar-senha`

Fica no route group `(auth)` — herda o `robots: noindex` do layout. Sem teste unitário (UI).

**Files:**
- Create: `src/app/(auth)/trocar-senha/page.tsx`

**Interfaces:**
- Consumes: `POST /api/auth/change-password` (Task 8). O middleware (Task 4) já protege a rota (sem sessão → `/login`) e já isenta o path do enforcement.
- Produces: nada consumido por outras tasks. O path `/trocar-senha` é o alvo de redirect do middleware (Task 3/4) e do recovery (Task 10) — não renomear.

- [ ] **Step 1: Implementar a página**

Copy neutra ("Defina uma nova senha") porque a página atende DOIS fluxos: primeiro login com senha temporária e redefinição via link de recovery.

```tsx
// src/app/(auth)/trocar-senha/page.tsx
"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { KeyRound, Loader2 } from "lucide-react";
import { AppLogo } from "@/components/brand/app-logo";

const MIN_PASSWORD = 8;

export default function TrocarSenhaPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD) {
      setError(`A senha deve ter pelo menos ${MIN_PASSWORD} caracteres`);
      return;
    }
    if (password !== confirm) {
      setError("A nova senha e a confirmação não coincidem");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirm }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error || "Não foi possível alterar a senha");
        setLoading(false);
        return;
      }
      // Reload completo (não router.push): o middleware precisa
      // reavaliar a flag e o AuthProvider recarregar o perfil.
      window.location.href = "/dashboard";
    } catch {
      setError("Não foi possível conectar ao servidor");
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await createClient().auth.signOut();
    window.location.href = "/login";
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="items-center text-center">
          <AppLogo className="mb-3 h-7 w-auto text-foreground" />
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <KeyRound className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-xl text-foreground">
            Defina uma nova senha
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Por segurança, crie uma senha nova antes de continuar. Use
            pelo menos {MIN_PASSWORD} caracteres.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="password" className="text-muted-foreground">
                Nova senha
              </Label>
              <Input
                id="password"
                type="password"
                placeholder={`Pelo menos ${MIN_PASSWORD} caracteres`}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={MIN_PASSWORD}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="confirm" className="text-muted-foreground">
                Confirmar nova senha
              </Label>
              <Input
                id="confirm"
                type="password"
                placeholder="Repita a nova senha"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                minLength={MIN_PASSWORD}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="mt-2 h-10 w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Salvando…
                </>
              ) : (
                "Salvar nova senha"
              )}
            </Button>
          </form>

          <button
            type="button"
            onClick={handleSignOut}
            className="mt-6 w-full text-center text-sm text-muted-foreground hover:text-foreground"
          >
            Sair e voltar para o login
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + suíte**

Run: `npx tsc --noEmit` e `npm test`
Expected: verde.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(auth)/trocar-senha/page.tsx"
git commit -m "feat(auth): pagina /trocar-senha para primeiro login e recovery"
```

---

### Task 10: Consertar o recovery — `GET /auth/callback` + redirect do forgot-password

O fluxo "Esqueci minha senha" está quebrado hoje: o e-mail aponta para `/auth/callback?next=/reset-password` e nenhum dos dois existe (404). O callback novo estabelece a sessão e manda para `/trocar-senha`.

**Files:**
- Create: `src/app/auth/callback/route.ts`
- Modify: `src/app/(auth)/forgot-password/page.tsx:31` (redirectTo)

**Interfaces:**
- Consumes: página `/trocar-senha` (Task 9); `createClient` de `@/lib/supabase/server`.
- Produces: `GET /auth/callback?code=...&next=/trocar-senha` → troca código por sessão → 307 para `next`. O path está isento no helper da Task 3.

- [ ] **Step 1: Implementar o callback**

Antes, leia `node_modules/next/dist/docs/` sobre route handlers para confirmar a assinatura nesta versão do Next.

```typescript
// src/app/auth/callback/route.ts
// ============================================================
// Destino dos links de e-mail do Supabase (recovery de senha).
// Troca o `code` da URL por uma sessão (PKCE) e redireciona
// para `next`. Sem code válido, cai no /login.
//
// Este path está isento do enforcement de must_change_password
// (src/lib/auth/must-change-password.ts) — a sessão precisa ser
// estabelecida ANTES de o usuário conseguir chegar à página de
// troca.
// ============================================================
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/trocar-senha";
  // Só caminhos internos — nada de open redirect via ?next=.
  const safeNext = next.startsWith("/") && !next.startsWith("//")
    ? next
    : "/trocar-senha";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
    console.error("[auth/callback] exchange error:", error.message);
  }

  return NextResponse.redirect(`${origin}/login`);
}
```

- [ ] **Step 2: Apontar o forgot-password para o fluxo novo** — em `src/app/(auth)/forgot-password/page.tsx` linha 31, trocar:

```typescript
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
```

por:

```typescript
      redirectTo: `${window.location.origin}/auth/callback?next=/trocar-senha`,
```

- [ ] **Step 3: Typecheck + suíte completa**

Run: `npx tsc --noEmit` e `npm test`
Expected: verde.

- [ ] **Step 4: Commit**

```bash
git add src/app/auth/callback/route.ts "src/app/(auth)/forgot-password/page.tsx"
git commit -m "fix(auth): conserta recovery de senha com /auth/callback e /trocar-senha"
```

---

### Task 11: Docs, verificação final e checklist manual

**Files:**
- Modify: `docs/infra.md` (nova seção)
- Modify: `CHANGELOG.md` (entrada nova, seguindo o formato existente do arquivo)

**Interfaces:**
- Consumes: tudo anterior.
- Produces: documentação; nenhum código.

- [ ] **Step 1: Documentar em `docs/infra.md`** (acrescentar seção no fim, ajustando o nível de heading ao padrão do arquivo):

```markdown
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
```

- [ ] **Step 2: Atualizar `CHANGELOG.md`** com a feature (leia o topo do arquivo e siga exatamente o formato das entradas existentes).

- [ ] **Step 3: Verificação final completa**

Run: `npm test` → tudo verde.
Run: `npx tsc --noEmit` → sem erros.
Run: `npx eslint src` (escopo alterado) → sem erros novos.
Run: `npm run build` → build passa.
Run: `grep -rn "supabase.auth.signUp" src/` → 0 ocorrências.

- [ ] **Step 4: Commit**

```bash
git add docs/infra.md CHANGELOG.md
git commit -m "docs: cadastro fechado, criacao manual de usuarios e passo do painel Supabase"
```

- [ ] **Step 5: Checklist manual (não automatizável — reportar ao usuário no fim)**

1. Supabase (produção E dev): desligar "Allow new users to sign up".
2. Conferir `PLATFORM_ADMIN_USER_IDS` nos ambientes com os UUIDs dos donos.
3. Smoke test com `npm run dev`:
   - `/signup` → redireciona para `/login`; login sem link "Criar conta".
   - `/admin/usuarios` com usuário fora da allowlist → 404; com admin → cria usuário e mostra a senha uma vez.
   - Login com a senha temporária → qualquer rota cai em `/trocar-senha`; após trocar, dashboard normal.
   - "Esqueci minha senha" → e-mail → link abre `/trocar-senha` e a troca funciona.
```
