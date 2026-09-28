import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import {
  deleteInstance,
  isEvolutionConfigured,
} from "@/lib/whatsapp/evolution-api";
import { listarInstancias } from "@/lib/whatsapp/instances";
import { releaseProxy } from "@/lib/whatsapp/proxy-pool";

// Gerência de UM número de WhatsApp do cliente ativo.
//
// PATCH  → apelido e/ou marcar como padrão.
// DELETE → remove o número de vez.
//
// As duas exigem admin: mexer aqui muda por qual telefone as respostas
// saem, e remover derruba a sessão de quem está usando o aparelho.

/** Acha o número dentro da conta ATIVA, ou devolve 404. */
async function acharAlvo(
  ctx: Awaited<ReturnType<typeof requireRole>>,
  id: string,
) {
  // Passa pela lista da conta em vez de buscar o id direto: assim o
  // filtro por `account_id` é obrigatório por construção, e o id de um
  // número de OUTRO cliente nunca resolve — mesmo com RLS permitindo
  // (o helper `is_account_member` vale para QUALQUER conta da pessoa,
  // não só a ativa).
  const instancias = await listarInstancias(ctx.supabase, ctx.accountId);
  return { instancias, alvo: instancias.find((i) => i.id === id) ?? null };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ctx = await requireRole("admin");
    const { alvo } = await acharAlvo(ctx, id);
    if (!alvo) {
      return NextResponse.json(
        { error: "Número não encontrado neste cliente." },
        { status: 404 },
      );
    }

    const corpo = (await request.json().catch(() => ({}))) as {
      label?: unknown;
      isDefault?: unknown;
    };

    const mudancas: Record<string, unknown> = {};
    if (typeof corpo.label === "string") {
      const limpo = corpo.label.trim().slice(0, 40);
      // Vazio volta a NULL: a interface mostra o telefone quando não há
      // apelido, e gravar "" faria o nome do número sumir da lista.
      mudancas.label = limpo === "" ? null : limpo;
    }

    if (corpo.isDefault === true) {
      // Tira o padrão do anterior ANTES de marcar o novo.
      //
      // Existe um índice único parcial permitindo um só padrão por
      // cliente (migration 058). Marcar primeiro violaria a constraint
      // e a troca falharia inteira. Não é transação — se a segunda
      // escrita falhar, o cliente fica sem padrão, e `escolherPadrao`
      // cobre isso caindo para qualquer número conectado.
      await ctx.supabase
        .from("evolution_instances")
        .update({ is_default: false })
        .eq("account_id", ctx.accountId)
        .eq("is_default", true);
      mudancas.is_default = true;
    }

    if (Object.keys(mudancas).length === 0) {
      return NextResponse.json({ error: "Nada para alterar." }, { status: 400 });
    }

    const { error } = await ctx.supabase
      .from("evolution_instances")
      .update(mudancas)
      .eq("id", alvo.id);
    if (error) {
      console.error("[evolution/instances PATCH]", error);
      return NextResponse.json(
        { error: "Não foi possível salvar" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ctx = await requireRole("admin");
    const { instancias, alvo } = await acharAlvo(ctx, id);
    if (!alvo) {
      return NextResponse.json(
        { error: "Número não encontrado neste cliente." },
        { status: 404 },
      );
    }

    const admin = supabaseAdmin();

    // Ordem: apaga na Evolution → solta o proxy → apaga a linha.
    //
    // A linha vai por último de propósito. Se ela sumisse primeiro e a
    // Evolution falhasse, a sessão continuaria de pé no servidor sem
    // nada no CRM apontando para ela — e não haveria como achá-la
    // depois, porque o nome dela mora justamente nessa linha.
    if (isEvolutionConfigured()) {
      try {
        await deleteInstance(alvo.instance_name);
      } catch (e) {
        // Best-effort: uma Evolution fora do ar não pode impedir a
        // pessoa de tirar o número do CRM.
        console.warn("[evolution/instances DELETE] evolution:", e);
      }
    }
    await releaseProxy(admin, ctx.accountId, alvo.instance_name);

    const { error } = await admin
      .from("evolution_instances")
      .delete()
      .eq("id", alvo.id)
      // Cinto e suspensório: o alvo já veio filtrado por conta, mas um
      // DELETE sem filtro de conta é o tipo de linha que alguém copia
      // para outro lugar sem o contexto.
      .eq("account_id", ctx.accountId);
    if (error) {
      console.error("[evolution/instances DELETE]", error);
      return NextResponse.json(
        { error: "Não foi possível remover o número" },
        { status: 500 },
      );
    }

    // As conversas dele NÃO são apagadas: a coluna `instance_id` é
    // ON DELETE SET NULL (migration 058), então o histórico fica e o
    // envio passa a sair pelo padrão. Perder conversa por trocar de
    // número seria inaceitável.

    // Se o removido era o padrão, promove outro. Sem padrão, toda
    // conversa nova nasceria sem número definido.
    if (alvo.is_default) {
      const restantes = instancias.filter((i) => i.id !== alvo.id);
      const novoPadrao =
        restantes.find((i) => i.status === "connected") ?? restantes[0];
      if (novoPadrao) {
        await admin
          .from("evolution_instances")
          .update({ is_default: true })
          .eq("id", novoPadrao.id);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
