// ============================================================
// Server-side account context — for API routes and server
// components. Reads the caller's profile + account in one round
// trip and verifies role on demand.
//
// IMPORTANT: this module is server-only. It imports the Supabase
// SSR client (`@/lib/supabase/server`), which reads `next/headers`
// cookies. Importing it from a client component will fail at
// build time with the standard Next.js "You're importing a
// component that needs `next/headers`" error — that's the
// boundary check; we don't need the `server-only` package.
//
// Calling convention
// ------------------
// API routes don't need to redo `supabase.auth.getUser()` — they
// receive a fully-loaded context from `requireRole`:
//
//   try {
//     const ctx = await requireRole("admin");
//     // ctx.supabase — the SSR client (RLS scoped to this user)
//     // ctx.userId  — auth.uid()
//     // ctx.accountId / ctx.role / ctx.account
//   } catch (err) {
//     return errorResponse(err); // see toErrorResponse() below
//   }
// ============================================================

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "./admin-client";
import { hasMinRole, isAccountRole, type AccountRole } from "./roles";

// ------------------------------------------------------------
// Errors
//
// Custom classes so API routes can map a single `catch` to the
// right HTTP status without sprinkling 401/403 strings everywhere.
// ------------------------------------------------------------

export class UnauthorizedError extends Error {
  readonly status = 401 as const;
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  readonly status = 403 as const;
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Convert one of the typed errors above (or anything else) into a
 * `NextResponse`. Routes can do:
 *
 *   } catch (err) {
 *     return toErrorResponse(err);
 *   }
 *
 * Unknown errors collapse to 500 with the generic message — we
 * never leak `err.message` for non-classified errors to keep
 * server internals out of the wire.
 */
export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[toErrorResponse] uncategorized error:", err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

// ------------------------------------------------------------
// Account context
// ------------------------------------------------------------

export interface AccountContext {
  /** Supabase SSR client, RLS scoped to the calling user. */
  supabase: SupabaseClient;
  /** `auth.uid()` for the caller. Always defined when this resolves. */
  userId: string;
  /** Caller's account_id from their profile row. */
  accountId: string;
  /** Caller's role within their account. */
  role: AccountRole;
  /** Lightweight account meta — id + name. */
  account: { id: string; name: string };
}

/**
 * Resolve the caller's user + account + role in one round trip.
 *
 * Throws `UnauthorizedError` if there's no Supabase session.
 * Throws `ForbiddenError` if the profile is missing account
 * fields (shouldn't happen post-017 migration; defensive guard
 * against profile rows that pre-date the backfill or were
 * inserted by hand).
 *
 * Use `requireRole(min)` instead when the route also needs a
 * minimum-role check — it's a thin wrapper over this.
 */
export async function getCurrentAccount(): Promise<AccountContext> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    throw new UnauthorizedError();
  }

  // Profile carries the "home" account (account_id) and the pointer to
  // the workspace the user last selected (active_account_id). Neither
  // is an authorization source — account_members below is. The pointer
  // is only a *preference*; we re-validate it against real membership.
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("account_id, active_account_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[getCurrentAccount] profile fetch error:", error);
    throw new ForbiddenError("Could not load account context");
  }
  if (!profile || !profile.account_id) {
    // Pre-migration profile, or a manual insert that skipped the
    // signup trigger. The user is authenticated but the app has
    // no way to scope their queries — treat as forbidden.
    throw new ForbiddenError("Profile is not linked to an account");
  }

  // Membership is the ONLY source of truth for which accounts the user
  // may act in, and with what role. RLS lets a user read only their own
  // account_members rows, so this list is self-scoped and safe.
  const { data: memberships, error: memErr } = await supabase
    .from("account_members")
    .select("account_id, role")
    .eq("user_id", user.id);

  if (memErr) {
    console.error("[getCurrentAccount] membership fetch error:", memErr);
    throw new ForbiddenError("Could not load account context");
  }
  if (!memberships || memberships.length === 0) {
    throw new ForbiddenError("Profile is not linked to an account");
  }

  // Resolve the active account FAIL-CLOSED: honour active_account_id
  // only if the user is genuinely a member of it, else fall back to the
  // home account (if still a member), else the first membership. A
  // stale or tampered active_account_id can therefore never grant
  // access to an account the user doesn't belong to — the worst case is
  // being dropped back to a workspace they DO belong to.
  const roleByAccount = new Map<string, string>(
    memberships.map((m) => [m.account_id as string, m.role as string]),
  );
  const activeId =
    (profile.active_account_id &&
      roleByAccount.has(profile.active_account_id) &&
      profile.active_account_id) ||
    (roleByAccount.has(profile.account_id) && profile.account_id) ||
    (memberships[0].account_id as string);

  const role = roleByAccount.get(activeId);
  if (!role || !isAccountRole(role)) {
    // The DB enum should make this impossible; surface rather than
    // silently widen if a future migration broadens the enum.
    throw new ForbiddenError(`Unknown account role: ${role}`);
  }

  // Best-effort repair of a stale/invalid pointer so we don't re-derive
  // it every request. Não-bloqueante: uma falha aqui não pode derrubar a
  // requisição.
  //
  // Escreve via service role porque `active_account_id` é coluna
  // privilegiada desde a migration 052 (o trigger recusa a escrita vinda
  // do cliente do usuário). É seguro: `activeId` acima só pode sair de
  // `roleByAccount`, ou seja, de uma membership real — um ponteiro
  // adulterado nunca chega até aqui.
  if (profile.active_account_id !== activeId) {
    const { error: repairErr } = await supabaseAdmin()
      .from("profiles")
      .update({ active_account_id: activeId })
      .eq("user_id", user.id);
    if (repairErr) {
      console.warn(
        "[getCurrentAccount] active_account_id repair failed:",
        repairErr.message ?? repairErr,
      );
    }
  }

  // Load the account with a plain point lookup by id rather than an
  // embedded FK join (`account:accounts!inner(...)`). The embed forces
  // PostgREST to resolve the FK from its schema cache; when that cache
  // is stale — common right after a migration — the embed fails hard
  // with PGRST200 and takes down the whole context (issue #294). A
  // lookup by id needs no relationship inference and is gated by the
  // same accounts RLS.
  const { data: account, error: accountErr } = await supabase
    .from("accounts")
    .select("id, name, logo_url")
    .eq("id", activeId)
    .maybeSingle();

  if (accountErr) {
    console.error("[getCurrentAccount] account fetch error:", accountErr);
    throw new ForbiddenError("Could not load account context");
  }
  if (!account) {
    // activeId points at no readable account row — should be impossible
    // (membership implies the accounts RLS passes), but stay defensive.
    throw new ForbiddenError("Profile is not linked to an account");
  }

  return {
    supabase,
    userId: user.id,
    accountId: activeId,
    role,
    account: { id: account.id, name: account.name },
  };
}

/**
 * List every account the caller belongs to, with their role in each.
 * Powers the workspace switcher and the "my clients" list. Ordered by
 * account name for a stable UI.
 *
 * RLS scopes `account_members` to the caller's own rows and `accounts`
 * to accounts they're a member of, so this is safe with the SSR client.
 */
export async function getUserAccounts(): Promise<
  { id: string; name: string; role: AccountRole }[]
> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    throw new UnauthorizedError();
  }

  const { data: memberships, error: memErr } = await supabase
    .from("account_members")
    .select("account_id, role")
    .eq("user_id", user.id);
  if (memErr) {
    throw new ForbiddenError("Could not load workspaces");
  }
  if (!memberships || memberships.length === 0) return [];

  // accounts RLS already restricts this to the member accounts.
  const { data: accounts, error: accErr } = await supabase
    .from("accounts")
    .select("id, name, logo_url");
  if (accErr) {
    throw new ForbiddenError("Could not load workspaces");
  }

  const nameById = new Map<string, string>(
    (accounts ?? []).map((a) => [a.id as string, a.name as string]),
  );

  return memberships
    .filter((m) => isAccountRole(m.role) && nameById.has(m.account_id as string))
    .map((m) => ({
      id: m.account_id as string,
      name: nameById.get(m.account_id as string)!,
      role: m.role as AccountRole,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Switch the caller's active workspace. FAIL-CLOSED: the switch only
 * succeeds if the caller is genuinely a member of `targetAccountId`.
 * Returns the freshly-resolved context for the new active account.
 *
 * Throws `ForbiddenError` if the caller isn't a member of the target —
 * this is the server-side gate the client switcher cannot bypass.
 */
export async function setActiveAccount(
  targetAccountId: string,
): Promise<AccountContext> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    throw new UnauthorizedError();
  }

  const { data: membership, error: memErr } = await supabase
    .from("account_members")
    .select("account_id")
    .eq("user_id", user.id)
    .eq("account_id", targetAccountId)
    .maybeSingle();
  if (memErr) {
    throw new ForbiddenError("Could not verify workspace membership");
  }
  if (!membership) {
    throw new ForbiddenError("You are not a member of this workspace");
  }

  // `active_account_id` é uma coluna privilegiada (migration 052) — o
  // trigger de profiles só aceita a escrita vinda do service role. A
  // posse já foi revalidada acima contra account_members, então é
  // seguro escrever aqui sem o RLS do cliente do usuário.
  const { error: updErr } = await supabaseAdmin()
    .from("profiles")
    .update({ active_account_id: targetAccountId })
    .eq("user_id", user.id);
  if (updErr) {
    throw new ForbiddenError("Could not switch workspace");
  }

  return getCurrentAccount();
}

/**
 * Resolve the caller's account context and enforce a minimum role.
 *
 * Throws `UnauthorizedError` / `ForbiddenError` as documented on
 * `getCurrentAccount`, plus `ForbiddenError("Insufficient role")`
 * when the caller is below `min`.
 */
export async function requireRole(min: AccountRole): Promise<AccountContext> {
  const ctx = await getCurrentAccount();
  if (!hasMinRole(ctx.role, min)) {
    throw new ForbiddenError(
      `This action requires the '${min}' role or higher`,
    );
  }
  return ctx;
}
