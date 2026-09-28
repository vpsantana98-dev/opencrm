import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";

// GET /api/account/overview
// Cross-client agency overview: one row per client the caller manages,
// with headline metrics and WhatsApp status. Backed by the
// membership-scoped SECURITY DEFINER RPC agency_overview() (035), so it
// only ever returns the caller's own client workspaces.
export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const { data, error } = await ctx.supabase.rpc("agency_overview");
    if (error) {
      console.error("[overview GET] agency_overview error:", error);
      return NextResponse.json(
        { error: "Não foi possível carregar os clientes" },
        { status: 400 },
      );
    }
    // Conta "home" (a própria conta da agência) — pra distinguir do card
    // de cliente. RLS deixa o usuário ler só o próprio perfil.
    const { data: prof } = await ctx.supabase
      .from("profiles")
      .select("account_id")
      .eq("user_id", ctx.userId)
      .maybeSingle();
    return NextResponse.json({
      clients: data ?? [],
      activeAccountId: ctx.accountId,
      homeAccountId: prof?.account_id ?? null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
