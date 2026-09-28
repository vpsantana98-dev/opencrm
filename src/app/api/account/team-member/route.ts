import { NextResponse } from "next/server";
import crypto from "crypto";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { requirePlatformAdmin } from "@/lib/auth/platform-admin";
import { supabaseAdmin } from "@/lib/automations/admin-client";

// POST /api/account/team-member  { email, name?, scope?, accountId? }
// Cria um login de OPERADOR da agência. Escopo:
//   scope 'all' (padrão) → opera TODOS os clientes (time interno).
//   scope 'client'       → opera SÓ o cliente `accountId` (atendente/SDR).
// Nos dois casos é marcado como interno (is_internal) pra poder conectar
// a própria chave do ClickUp. Só o dono da agência cria. SMTP off, então
// a senha temporária volta aqui pra compartilhar.
export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();

    // Autorização: "ser owner de alguma conta" não serve de gate — todo
    // signup vira owner da própria conta (handle_new_user, migration 031),
    // então qualquer usuário logado passaria. Só admin de plataforma pode
    // criar operador (mesmo padrão de src/app/api/admin/users/route.ts).
    await requirePlatformAdmin();

    const admin = supabaseAdmin();
    const body = (await request.json().catch(() => ({}))) as {
      email?: string;
      name?: string;
      scope?: string;
      accountId?: string;
    };
    const email = (body.email ?? "").trim().toLowerCase();
    if (!email.includes("@")) {
      return NextResponse.json(
        { error: "Informe um e-mail válido" },
        { status: 400 },
      );
    }

    // Contas em que o DONO é membro = os clientes da agência.
    const { data: memberships } = await admin
      .from("account_members")
      .select("account_id")
      .eq("user_id", ctx.userId);
    const allAccountIds = (memberships ?? []).map((m) => m.account_id as string);

    // Escopo: todos os clientes ou só um (validado contra os do dono).
    const scope = body.scope === "client" ? "client" : "all";
    let accountIds: string[];
    if (scope === "client") {
      const target = (body.accountId ?? "").trim();
      if (!target || !allAccountIds.includes(target)) {
        return NextResponse.json(
          { error: "Cliente inválido para escopo restrito" },
          { status: 400 },
        );
      }
      accountIds = [target];
    } else {
      accountIds = allAccountIds;
    }

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
          { error: "Esse e-mail já tem um login. Use outro." },
          { status: 409 },
        );
      }
      console.error("[team-member] createUser error:", createErr);
      return NextResponse.json(
        { error: "Não foi possível criar o operador" },
        { status: 400 },
      );
    }

    const userId = created.user.id;

    // Adiciona o operador (admin) ao(s) cliente(s) do escopo.
    if (accountIds.length > 0) {
      await admin.from("account_members").insert(
        accountIds.map((aid) => ({
          account_id: aid,
          user_id: userId,
          role: "admin" as const,
        })),
      );
    }

    // Marca como operador desta agência e deixa ativo num cliente. IMPORTANTE:
    // apontar o perfil pro cliente-alvo ANTES de apagar a conta pessoal, senão
    // o ON DELETE CASCADE de profiles.account_id apagaria o próprio perfil.
    await admin
      .from("profiles")
      .update({
        agency_owner_id: ctx.userId,
        is_client_login: false,
        is_internal: true,
        active_account_id: accountIds[0] ?? ctx.accountId,
        account_id: accountIds[0] ?? ctx.accountId,
      })
      .eq("user_id", userId);

    // Remove o workspace pessoal que o trigger de signup cria: operador não
    // precisa de conta própria — opera só o(s) cliente(s) atribuído(s). Sem
    // isto, um atendente "só este cliente" ficaria com um espaço próprio vazio.
    // Seguro: o alvo é de outro dono, então nunca cai aqui.
    await admin.from("accounts").delete().eq("owner_user_id", userId);

    return NextResponse.json({ email, password });
  } catch (err) {
    return toErrorResponse(err);
  }
}
