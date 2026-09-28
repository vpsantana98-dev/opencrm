import { NextResponse } from "next/server";
import crypto from "crypto";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";

// POST /api/account/client-access  { accountId, email, name? }
// Cria (ou informa) um login para o CLIENTE acessar SÓ o workspace dele.
// A agência (owner/admin da conta alvo) gera; devolve e-mail + senha
// temporária pra passar ao cliente. O login entra vinculado só a este
// workspace (RLS isola) e marcado como is_client_login (esconde as telas
// de agência). SMTP está off, então a senha volta aqui pra compartilhar.
export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const admin = supabaseAdmin();
    const body = (await request.json().catch(() => ({}))) as {
      accountId?: string;
      email?: string;
      name?: string;
    };
    const accountId = body.accountId;
    const email = (body.email ?? "").trim().toLowerCase();
    if (!accountId || !email || !email.includes("@")) {
      return NextResponse.json(
        { error: "Informe a conta e um e-mail válido" },
        { status: 400 },
      );
    }

    // Autorização: caller precisa ser owner/admin da conta alvo.
    const { data: mem } = await admin
      .from("account_members")
      .select("role")
      .eq("account_id", accountId)
      .eq("user_id", ctx.userId)
      .maybeSingle();
    if (!mem || (mem.role !== "owner" && mem.role !== "admin")) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    const { data: clientOptions } = await admin
      .from("client_setup_options")
      .select("portal_enabled")
      .eq("account_id", accountId)
      .maybeSingle();
    if (!clientOptions?.portal_enabled) {
      return NextResponse.json(
        { error: "Habilite o Portal do Cliente nas configurações opcionais antes de criar o acesso." },
        { status: 400 },
      );
    }

    // Senha temporária (o cliente troca depois nas Configurações).
    const password = `Fz${crypto.randomBytes(9).toString("base64url")}`;

    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: body.name ?? "" },
      });

    if (createErr || !created?.user) {
      const msg = createErr?.message ?? "";
      if (/already|registered|exists/i.test(msg)) {
        return NextResponse.json(
          {
            error:
              "Esse e-mail já tem um login. Use outro e-mail para o acesso deste cliente.",
          },
          { status: 409 },
        );
      }
      console.error("[client-access] createUser error:", createErr);
      return NextResponse.json(
        { error: "Não foi possível criar o login" },
        { status: 400 },
      );
    }

    const userId = created.user.id;

    // Vincula SÓ ao workspace do cliente (o trigger de signup criou uma
    // conta pessoal vazia que fica invisível; não apagamos nada).
    await admin
      .from("account_members")
      .insert({ account_id: accountId, user_id: userId, role: "admin" });

    // Deixa o cliente ATIVO no workspace dele e marca como login de cliente.
    await admin
      .from("profiles")
      .update({
        active_account_id: accountId,
        account_id: accountId,
        is_client_login: true,
      })
      .eq("user_id", userId);

    return NextResponse.json({ email, password });
  } catch (err) {
    return toErrorResponse(err);
  }
}
