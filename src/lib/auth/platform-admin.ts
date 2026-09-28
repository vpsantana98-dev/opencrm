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
