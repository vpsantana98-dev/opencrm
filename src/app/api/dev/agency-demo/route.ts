import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";

// ============================================================
// DEV-ONLY. Injeta (ou remove) um GRUPO de demonstração no inbox da
// conta ativa, pra visualizar o modo ag�ncia sem WhatsApp real: um
// contato is_group + conversa + mensagens com sender_name (vários
// autores) exatamente como o webhook gravaria.
//
// Bloqueado em produção. Escopado à conta do usuário logado.
// ============================================================

const DEMO_JID = "demo-ag�ncia@g.us";

function devOnly(): NextResponse | null {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return null;
}

// Mensagens do grupo de demonstração (minutos atrás -> agora).
const DEMO_MESSAGES: Array<{
  sender_type: "customer" | "agent";
  sender_name: string | null;
  text: string;
  minsAgo: number;
}> = [
  {
    sender_type: "customer",
    sender_name: "Camila Reis",
    text: "Bom dia, pessoal! Conseguem mandar uma prévia dos criativos do Dia dos Pais ainda hoje?",
    minsAgo: 55,
  },
  {
    sender_type: "agent",
    sender_name: null,
    text: "Bom dia, Camila! Sim, o time de design finaliza até o meio-dia. Te mando aqui assim que sair.",
    minsAgo: 50,
  },
  {
    sender_type: "customer",
    sender_name: "Rodrigo Lima",
    text: "Aproveitando: o resultado da campanha de remarketing tá muito bom, parabéns ao time 👏",
    minsAgo: 45,
  },
  {
    sender_type: "agent",
    sender_name: null,
    text: "Valeu, Rodrigo! O CPA caiu 18% depois do ajuste de público. Vem mais melhoria por aí.",
    minsAgo: 40,
  },
  {
    sender_type: "customer",
    sender_name: "Camila Reis",
    text: "Ficou ótimo! Aprovado. Só aumenta um pouco o logo no canto.",
    minsAgo: 8,
  },
];

export async function POST() {
  const blocked = devOnly();
  if (blocked) return blocked;
  try {
    const ctx = await getCurrentAccount();
    const db = supabaseAdmin();

    // Contato-grupo (find-or-create pela chave wa_jid).
    const { data: existing } = await db
      .from("contacts")
      .select("id")
      .eq("account_id", ctx.accountId)
      .eq("wa_jid", DEMO_JID)
      .maybeSingle();

    let contactId = existing?.id as string | undefined;
    if (!contactId) {
      const { data: c, error } = await db
        .from("contacts")
        .insert({
          account_id: ctx.accountId,
          user_id: ctx.userId,
          phone: DEMO_JID,
          wa_jid: DEMO_JID,
          is_group: true,
          name: "Serra Verde Cafés",
        })
        .select("id")
        .single();
      if (error || !c) {
        return NextResponse.json(
          { error: `Falha ao criar grupo demo: ${error?.message ?? ""}` },
          { status: 500 },
        );
      }
      contactId = c.id as string;
    }

    // Conversa (find-or-create).
    const { data: conv } = await db
      .from("conversations")
      .select("id")
      .eq("account_id", ctx.accountId)
      .eq("contact_id", contactId)
      .maybeSingle();
    let conversationId = conv?.id as string | undefined;
    if (!conversationId) {
      const { data: nc, error } = await db
        .from("conversations")
        .insert({
          account_id: ctx.accountId,
          user_id: ctx.userId,
          contact_id: contactId,
        })
        .select("id")
        .single();
      if (error || !nc) {
        return NextResponse.json(
          { error: `Falha ao criar conversa demo: ${error?.message ?? ""}` },
          { status: 500 },
        );
      }
      conversationId = nc.id as string;
    }

    // Recria as mensagens do zero (idempotente).
    await db.from("messages").delete().eq("conversation_id", conversationId);
    const now = Date.now();
    const rows = DEMO_MESSAGES.map((m) => ({
      conversation_id: conversationId!,
      sender_type: m.sender_type,
      content_type: "text" as const,
      content_text: m.text,
      sender_name: m.sender_name,
      status: m.sender_type === "agent" ? ("sent" as const) : ("delivered" as const),
      created_at: new Date(now - m.minsAgo * 60_000).toISOString(),
    }));
    await db.from("messages").insert(rows);

    const last = DEMO_MESSAGES[DEMO_MESSAGES.length - 1];
    await db
      .from("conversations")
      .update({
        last_message_text: last.sender_name
          ? `${last.sender_name}: ${last.text}`
          : last.text,
        last_message_at: new Date(now - last.minsAgo * 60_000).toISOString(),
        unread_count: DEMO_MESSAGES.filter((m) => m.sender_type === "customer")
          .length,
        // Deixa a demo já com saúde/responsável preenchidos (igual ao mockup).
        health: "estavel",
        cs_owner: "Marina Duarte",
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversationId);

    return NextResponse.json({ ok: true, conversationId });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE() {
  const blocked = devOnly();
  if (blocked) return blocked;
  try {
    const ctx = await getCurrentAccount();
    const db = supabaseAdmin();
    // ON DELETE CASCADE em conversations/messages apaga o resto.
    await db
      .from("contacts")
      .delete()
      .eq("account_id", ctx.accountId)
      .eq("wa_jid", DEMO_JID);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
