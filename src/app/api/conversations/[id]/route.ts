import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { canManageMembers } from "@/lib/auth/roles";
import { supabaseAdmin } from "@/lib/flows/admin-client";

// DELETE /api/conversations/[id]
//
// Apaga a conversa e suas mensagens DO CRM. Não toca no WhatsApp: nada
// é enviado para a Evolution nem para a Meta, então o histórico no
// aparelho do cliente continua intacto. É o oposto de "apagar para
// todos" — aqui só a nossa cópia some.
//
// Restrito a owner/admin (`canManageMembers`), porque é destrutivo e não
// tem desfazer: as linhas saem do banco, e mensagem apagada não volta.
// Um atendente pode fechar a conversa; apagar é decisão de quem
// administra a conta.

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount();
    if (!canManageMembers(ctx.role)) {
      return NextResponse.json(
        { error: "Apenas administradores podem apagar conversas." },
        { status: 403 },
      );
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Conversa inválida." }, { status: 400 });
    }

    // Confere posse ANTES de apagar, com o cliente do usuário (RLS) e o
    // filtro de conta explícito. Sem esta checagem, um id de outra conta
    // seria apagado pelo service role logo abaixo, que ignora RLS.
    const { data: conversa, error: buscaErr } = await ctx.supabase
      .from("conversations")
      .select("id")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (buscaErr) {
      console.error("[DELETE /api/conversations] busca:", buscaErr.message);
      return NextResponse.json(
        { error: "Não foi possível apagar a conversa." },
        { status: 500 },
      );
    }
    if (!conversa) {
      return NextResponse.json(
        { error: "Conversa não encontrada." },
        { status: 404 },
      );
    }

    // Service role para o apagamento: as policies de DELETE em `messages`
    // não são garantidas para todo papel, e a posse já foi verificada
    // acima. As mensagens saem primeiro — se a conversa sumisse antes,
    // uma falha no meio deixaria mensagens órfãs sem como achá-las.
    const admin = supabaseAdmin();
    const { error: msgErr } = await admin
      .from("messages")
      .delete()
      .eq("conversation_id", id);
    if (msgErr) {
      console.error("[DELETE /api/conversations] mensagens:", msgErr.message);
      return NextResponse.json(
        { error: "Não foi possível apagar as mensagens da conversa." },
        { status: 500 },
      );
    }

    const { error: convErr } = await admin
      .from("conversations")
      .delete()
      .eq("id", id)
      .eq("account_id", ctx.accountId);
    if (convErr) {
      console.error("[DELETE /api/conversations] conversa:", convErr.message);
      return NextResponse.json(
        { error: "As mensagens foram apagadas, mas a conversa permaneceu." },
        { status: 500 },
      );
    }

    // Registro de quem apagou o quê. Sem isto, uma conversa some do
    // inbox e não há como responder "quem apagou?" depois.
    console.info(
      `[conversations] apagada ${id} da conta ${ctx.accountId} por ${ctx.userId}`,
    );

    return NextResponse.json({ deleted: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
