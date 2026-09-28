import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { encrypt } from "@/lib/whatsapp/encryption";
import { getClickUpUser } from "@/lib/clickup/client";

// Conexão do ClickUp POR USUÁRIO (chave pessoal). Só time interno da
// OpenCRM (profiles.is_internal). A chave é validada contra o ClickUp,
// cifrada e guardada no profile do próprio usuário.

async function loadMe(userId: string) {
  const { data } = await supabaseAdmin()
    .from("profiles")
    .select("is_internal, clickup_api_key")
    .eq("user_id", userId)
    .maybeSingle();
  return data as { is_internal?: boolean; clickup_api_key?: string | null } | null;
}

// GET -> { connected, internal }
export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const me = await loadMe(ctx.userId);
    return NextResponse.json({
      internal: !!me?.is_internal,
      connected: !!me?.clickup_api_key,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST { apiKey } -> valida no ClickUp, cifra e salva
export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const me = await loadMe(ctx.userId);
    if (!me?.is_internal) {
      return NextResponse.json(
        { error: "Recurso exclusivo do time interno da OpenCRM" },
        { status: 403 },
      );
    }
    const body = (await request.json().catch(() => ({}))) as { apiKey?: string };
    const apiKey = (body.apiKey ?? "").trim();
    if (!apiKey) {
      return NextResponse.json({ error: "Informe a chave" }, { status: 400 });
    }

    const check = await getClickUpUser(apiKey);
    if (!check.ok) {
      return NextResponse.json(
        { error: check.error ?? "Não foi possível validar a chave" },
        { status: 400 },
      );
    }

    await supabaseAdmin()
      .from("profiles")
      .update({ clickup_api_key: encrypt(apiKey) })
      .eq("user_id", ctx.userId);

    return NextResponse.json({
      connected: true,
      username: check.user?.username ?? null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// DELETE -> desconecta (limpa a chave)
export async function DELETE() {
  try {
    const ctx = await getCurrentAccount();
    const me = await loadMe(ctx.userId);
    if (!me?.is_internal) {
      return NextResponse.json(
        { error: "Recurso exclusivo do time interno da OpenCRM" },
        { status: 403 },
      );
    }
    await supabaseAdmin()
      .from("profiles")
      .update({ clickup_api_key: null })
      .eq("user_id", ctx.userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
