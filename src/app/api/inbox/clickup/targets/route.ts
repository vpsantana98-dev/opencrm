import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { decrypt } from "@/lib/whatsapp/encryption";
import { listClickUpTargets, type ClickUpTarget } from "@/lib/clickup/client";

// GET /api/inbox/clickup/targets — lista as "operações de cliente" do
// ClickUp (pastas + listas) da chave do usuário, pro seletor do painel.
// Só time interno. Não recebe id de conversa: é o catálogo do ClickUp.

// Cache em memória, por usuário, TTL de 5 min: o catálogo é a chamada mais
// cara e o painel refaz a busca a cada troca de conversa (remonta por
// `key`). É um `Map` por instância do processo — não é distribuído, mas
// já corta a maior parte do custo. `?fresh=1` fura o cache.
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; targets: ClickUpTarget[] }>();

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const { data: prof } = await supabaseAdmin()
      .from("profiles")
      .select("is_internal, clickup_api_key")
      .eq("user_id", ctx.userId)
      .maybeSingle();
    const p = prof as
      | { is_internal?: boolean; clickup_api_key?: string | null }
      | null;
    if (!p?.is_internal) {
      return NextResponse.json({ error: "Exclusivo do time interno" }, { status: 403 });
    }
    if (!p.clickup_api_key) {
      return NextResponse.json({ needsKey: true, targets: [] });
    }

    const fresh = new URL(request.url).searchParams.get("fresh") === "1";
    const cached = cache.get(ctx.userId);
    if (!fresh && cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return NextResponse.json({ targets: cached.targets });
    }

    const res = await listClickUpTargets(decrypt(p.clickup_api_key));
    if (!res.ok) {
      return NextResponse.json({ error: res.error, targets: [] }, { status: 502 });
    }
    const targets = res.targets ?? [];
    cache.set(ctx.userId, { at: Date.now(), targets });
    return NextResponse.json({ targets });
  } catch (err) {
    return toErrorResponse(err);
  }
}
