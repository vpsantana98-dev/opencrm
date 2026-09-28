import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { escolherPadrao, listarInstancias } from "@/lib/whatsapp/instances";
import { logoutInstance } from "@/lib/whatsapp/evolution-api";

// POST /api/whatsapp/evolution/disconnect
// Desconecta o WhatsApp do cliente ATIVO (logout da sessão Evolution),
// MANTENDO o cliente. Diferente de excluir o cliente. Só admin+.
export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");

    // QUAL número desconectar. Antes o nome da instância era o próprio
    // `account_id` e o update pegava tudo da conta — com vários números,
    // desconectar um derrubaria TODOS.
    const corpo = (await request.json().catch(() => ({}))) as {
      instanceId?: unknown;
    };
    const alvoId = typeof corpo.instanceId === "string" ? corpo.instanceId : null;

    const instancias = await listarInstancias(ctx.supabase, ctx.accountId);
    const alvo = alvoId
      ? instancias.find((i) => i.id === alvoId)
      : escolherPadrao(instancias);

    if (!alvo) {
      return NextResponse.json(
        { error: "Número não encontrado nesta conta." },
        { status: 404 },
      );
    }
    const instanceName = alvo.instance_name;

    // Logout na Evolution (best-effort: mesmo se falhar, marcamos como
    // desconectado no nosso lado pra a UI refletir).
    try {
      await logoutInstance(instanceName);
    } catch (err) {
      console.error("[evolution/disconnect] logout error:", err);
    }

    const { error } = await ctx.supabase
      .from("evolution_instances")
      .update({ status: "disconnected", phone: null })
      // Por ID: filtrar por conta marcaria todos os números como caídos.
      .eq("id", alvo.id);
    if (error) {
      return NextResponse.json(
        { error: "Não foi possível atualizar o status" },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
