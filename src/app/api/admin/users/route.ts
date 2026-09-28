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
