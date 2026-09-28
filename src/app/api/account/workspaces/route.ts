import { NextResponse } from "next/server";

import {
  getCurrentAccount,
  getUserAccounts,
  toErrorResponse,
} from "@/lib/auth/account";

// GET /api/account/workspaces
// Lists every workspace (account) the caller belongs to, with their
// role in each. Powers the workspace switcher and the "my clients" list.
export async function GET() {
  try {
    const [workspaces, ctx] = await Promise.all([
      getUserAccounts(),
      getCurrentAccount(),
    ]);
    return NextResponse.json({ workspaces, activeAccountId: ctx.accountId });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/account/workspaces  { name }
// Creates a new client workspace and makes the caller its owner. The
// agency-side "add a new client" action. Does NOT switch the active
// workspace — the client calls /api/account/active to do that after.
export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const body = (await request.json().catch(() => ({}))) as { name?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json(
        { error: "O nome do workspace é obrigatório" },
        { status: 400 },
      );
    }

    const { data, error } = await ctx.supabase.rpc("create_workspace", {
      p_name: name,
    });
    if (error) {
      console.error("[workspaces POST] create_workspace error:", error);
      return NextResponse.json(
        { error: "Não foi possível criar o workspace" },
        { status: 400 },
      );
    }

    return NextResponse.json({ id: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
