import { NextResponse } from "next/server";

import { setActiveAccount, toErrorResponse } from "@/lib/auth/account";

// POST /api/account/active  { accountId }
// Switches the caller's active workspace. FAIL-CLOSED: setActiveAccount
// throws ForbiddenError (→ 403) if the caller isn't a member of the
// target, so a tampered accountId can never grant access. The client
// refreshes after a 200 so every account-scoped query re-runs against
// the new active workspace.
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      accountId?: unknown;
    };
    const accountId =
      typeof body.accountId === "string" ? body.accountId : "";
    if (!accountId) {
      return NextResponse.json(
        { error: "accountId é obrigatório" },
        { status: 400 },
      );
    }

    const ctx = await setActiveAccount(accountId);
    return NextResponse.json({
      ok: true,
      accountId: ctx.accountId,
      name: ctx.account.name,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
