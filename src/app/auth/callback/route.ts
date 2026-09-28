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
