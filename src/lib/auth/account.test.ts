import { afterEach, describe, expect, it, vi } from "vitest";

// getCurrentAccount resolves the caller's ACTIVE account context.
//
// Two invariants this file guards:
//   1. (#294) Account loading must NOT use a PostgREST embedded FK join
//      (`accounts!inner`) — a stale schema cache blanks the whole
//      context. Two plain point queries instead.
//   2. (multi-tenant, fail-closed) The active_account_id pointer is a
//      *preference*, never an authorization source. Membership in
//      account_members is the only thing that grants access. A pointer
//      at an account the user isn't a member of must drop back to an
//      account they ARE a member of — never grant the pointed-at one.

interface BuilderCall {
  table: string;
  columns?: string;
  eqArgs: [string, unknown][];
  updated?: Record<string, unknown>;
}

function makeClient(opts: {
  user: { id: string } | null;
  userErr?: unknown;
  byTable: Record<string, { data: unknown; error: unknown }>;
}) {
  const calls: BuilderCall[] = [];

  const from = (table: string) => {
    const call: BuilderCall = { table, eqArgs: [] };
    calls.push(call);
    const result = () =>
      Promise.resolve(opts.byTable[table] ?? { data: null, error: null });
    const builder = {
      select(columns: string) {
        call.columns = columns;
        return builder;
      },
      update(vals: Record<string, unknown>) {
        call.updated = vals;
        return builder;
      },
      eq(col: string, val: unknown) {
        call.eqArgs.push([col, val]);
        return builder;
      },
      maybeSingle: result,
      // Thenable so a list query (`await …select().eq()`) resolves to
      // the table's queued result without a terminal call.
      then(
        resolve: (v: { data: unknown; error: unknown }) => unknown,
        reject?: (e: unknown) => unknown,
      ) {
        return result().then(resolve, reject);
      },
    };
    return builder;
  };

  return {
    calls,
    client: {
      auth: {
        getUser: () =>
          Promise.resolve({
            data: { user: opts.user },
            error: opts.userErr ?? null,
          }),
      },
      from,
    },
  };
}

const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

// Colunas privilegiadas de `profiles` (active_account_id incluso) só
// aceitam escrita do service role desde a migration 052 — por isso o
// reparo do ponteiro e o setActiveAccount passam pelo admin client.
const supabaseAdmin = vi.fn();
vi.mock("./admin-client", () => ({
  supabaseAdmin: () => supabaseAdmin(),
}));

/** Admin client de mentira, para as asserções de escrita privilegiada. */
function makeAdmin() {
  const { client, calls } = makeClient({ user: null, byTable: {} });
  return { admin: client, adminCalls: calls };
}

const {
  getCurrentAccount,
  getUserAccounts,
  setActiveAccount,
  UnauthorizedError,
  ForbiddenError,
} = await import("./account");

afterEach(() => {
  vi.clearAllMocks();
});

describe("getCurrentAccount", () => {
  it("resolves the active account via plain lookups, role from membership", async () => {
    const { client, calls } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: {
          data: { account_id: "acct-1", active_account_id: "acct-1" },
          error: null,
        },
        account_members: {
          data: [{ account_id: "acct-1", role: "owner" }],
          error: null,
        },
        accounts: { data: { id: "acct-1", name: "Acme" }, error: null },
      },
    });
    createClient.mockReturnValue(client);

    const ctx = await getCurrentAccount();

    expect(ctx).toMatchObject({
      userId: "user-1",
      accountId: "acct-1",
      role: "owner",
      account: { id: "acct-1", name: "Acme" },
    });

    // active pointer already correct → no repair write.
    expect(calls.map((c) => c.table)).toEqual([
      "profiles",
      "account_members",
      "accounts",
    ]);
    // No embedded FK join anywhere — the #294 guard.
    for (const c of calls) expect(c.columns ?? "").not.toMatch(/accounts!/);
    expect(calls[2].eqArgs).toEqual([["id", "acct-1"]]);
  });

  it("FAIL-CLOSED: an active_account_id the user is not a member of drops back to a member account", async () => {
    const { client, calls } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: {
          // Pointer at acct-EVIL, which is NOT in the membership list.
          data: { account_id: "acct-home", active_account_id: "acct-evil" },
          error: null,
        },
        account_members: {
          data: [{ account_id: "acct-home", role: "admin" }],
          error: null,
        },
        accounts: { data: { id: "acct-home", name: "Home" }, error: null },
      },
    });
    createClient.mockReturnValue(client);
    const { admin, adminCalls } = makeAdmin();
    supabaseAdmin.mockReturnValue(admin);

    const ctx = await getCurrentAccount();

    // Never resolves to the pointed-at account; falls back to the one
    // the user actually belongs to.
    expect(ctx.accountId).toBe("acct-home");
    expect(ctx.role).toBe("admin");
    // O ponteiro velho é reparado — via ADMIN, porque active_account_id
    // virou coluna privilegiada (migration 052). O cliente do usuário
    // não pode mais escrevê-la.
    const repair = adminCalls.find((c) => c.table === "profiles" && c.updated);
    expect(repair?.updated).toEqual({ active_account_id: "acct-home" });
    expect(repair?.eqArgs).toEqual([["user_id", "user-1"]]);
    expect(calls.find((c) => c.table === "profiles" && c.updated)).toBeUndefined();
  });

  it("honours a valid active_account_id among several memberships", async () => {
    const { client } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: {
          data: { account_id: "acct-home", active_account_id: "acct-client2" },
          error: null,
        },
        account_members: {
          data: [
            { account_id: "acct-home", role: "owner" },
            { account_id: "acct-client2", role: "admin" },
          ],
          error: null,
        },
        accounts: { data: { id: "acct-client2", name: "Client Two" }, error: null },
      },
    });
    createClient.mockReturnValue(client);

    const ctx = await getCurrentAccount();
    expect(ctx.accountId).toBe("acct-client2");
    expect(ctx.role).toBe("admin");
  });

  it("throws UnauthorizedError when there is no session", async () => {
    const { client } = makeClient({ user: null, byTable: {} });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("maps a profiles query error to 'Could not load account context'", async () => {
    const { client } = makeClient({
      user: { id: "user-1" },
      byTable: { profiles: { data: null, error: { code: "PGRST200" } } },
    });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toThrow(
      "Could not load account context",
    );
  });

  it("maps a membership query error to 'Could not load account context'", async () => {
    const { client } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: {
          data: { account_id: "acct-1", active_account_id: "acct-1" },
          error: null,
        },
        account_members: { data: null, error: { code: "PGRST200" } },
      },
    });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toThrow(
      "Could not load account context",
    );
  });

  it("rejects a profile not linked to an account", async () => {
    const { client } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: { data: { account_id: null, active_account_id: null }, error: null },
      },
    });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toThrow(
      "Profile is not linked to an account",
    );
  });

  it("rejects a user with no memberships", async () => {
    const { client } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: {
          data: { account_id: "acct-1", active_account_id: "acct-1" },
          error: null,
        },
        account_members: { data: [], error: null },
      },
    });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toThrow(
      "Profile is not linked to an account",
    );
  });

  it("rejects when the active account resolves to no readable account row", async () => {
    const { client } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: {
          data: { account_id: "acct-1", active_account_id: "acct-1" },
          error: null,
        },
        account_members: {
          data: [{ account_id: "acct-1", role: "viewer" }],
          error: null,
        },
        accounts: { data: null, error: null },
      },
    });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toThrow(
      "Profile is not linked to an account",
    );
  });
});

describe("getUserAccounts", () => {
  it("lists member accounts with roles, sorted by name", async () => {
    const { client } = makeClient({
      user: { id: "user-1" },
      byTable: {
        account_members: {
          data: [
            { account_id: "a", role: "owner" },
            { account_id: "b", role: "agent" },
          ],
          error: null,
        },
        accounts: {
          data: [
            { id: "a", name: "Zeta" },
            { id: "b", name: "Alpha" },
          ],
          error: null,
        },
      },
    });
    createClient.mockReturnValue(client);

    const list = await getUserAccounts();
    expect(list).toEqual([
      { id: "b", name: "Alpha", role: "agent" },
      { id: "a", name: "Zeta", role: "owner" },
    ]);
  });

  it("returns an empty list when the user has no memberships", async () => {
    const { client } = makeClient({
      user: { id: "user-1" },
      byTable: { account_members: { data: [], error: null } },
    });
    createClient.mockReturnValue(client);
    expect(await getUserAccounts()).toEqual([]);
  });
});

describe("setActiveAccount", () => {
  it("FAIL-CLOSED: rejects switching to an account the user isn't a member of", async () => {
    const { client } = makeClient({
      user: { id: "user-1" },
      byTable: {
        // membership lookup for the target returns nothing.
        account_members: { data: null, error: null },
      },
    });
    createClient.mockReturnValue(client);
    await expect(setActiveAccount("acct-evil")).rejects.toThrow(
      "You are not a member of this workspace",
    );
  });
});
