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
