// ============================================================
// Resolve (ou cria) a conversa de um GRUPO do WhatsApp.
//
// Espelha resolve-conversation.ts, mas a chave é o jid do grupo
// (contacts.wa_jid), não o telefone: grupo não tem número único. O
// contato-grupo guarda phone = jid só pra satisfazer o NOT NULL; a
// unicidade real é (account_id, wa_jid), da migration 048.
//
// subjectIfNew() só é chamado na CRIAÇÃO (1ª mensagem do grupo), pra
// evitar uma ida à Evolution a cada mensagem só pra pegar o nome.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { isUniqueViolation } from "@/lib/contacts/dedupe";
import { resolveAuditUserId } from "@/lib/api/v1/contacts";

export interface ResolvedGroup {
  conversationId: string;
  contactId: string;
  /** True se ESTA chamada criou o contato-grupo (vs achou existente). */
  contactCreated: boolean;
}

async function findGroupContact(
  db: SupabaseClient,
  accountId: string,
  groupJid: string,
): Promise<{ id: string; name: string | null } | null> {
  const { data } = await db
    .from("contacts")
    .select("id, name")
    .eq("account_id", accountId)
    .eq("wa_jid", groupJid)
    .maybeSingle();
  return (data as { id: string; name: string | null } | null) ?? null;
}

async function getOrCreateConversation(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  ownerUserId: string,
): Promise<string> {
  const { data: conv } = await db
    .from("conversations")
    .select("id")
    .eq("account_id", accountId)
    .eq("contact_id", contactId)
    .maybeSingle();
  if (conv?.id) return conv.id as string;

  const { data: created, error } = await db
    .from("conversations")
    .insert({ account_id: accountId, user_id: ownerUserId, contact_id: contactId })
    .select("id")
    .single();
  if (error || !created) {
    throw new Error(`Falha ao criar conversa do grupo: ${error?.message ?? ""}`);
  }
  return created.id as string;
}

export async function resolveGroupConversation(
  db: SupabaseClient,
  accountId: string,
  groupJid: string,
  opts?: { subjectIfNew?: () => Promise<string | null> },
): Promise<ResolvedGroup> {
  const ownerUserId = await resolveAuditUserId(db, accountId);

  const existing = await findGroupContact(db, accountId, groupJid);
  if (existing) {
    // Nome ainda provisório (a busca do subject falhou na criação) —
    // tenta de novo agora que o grupo mandou outra mensagem. Só nesse
    // caso: buscar em toda mensagem bateria a Evolution à toa.
    if (existing.name && /^Grupo \d+$/.test(existing.name)) {
      const subject = await opts?.subjectIfNew?.();
      if (subject && subject !== existing.name) {
        await db.from("contacts").update({ name: subject }).eq("id", existing.id);
      }
    }
    const conversationId = await getOrCreateConversation(
      db,
      accountId,
      existing.id,
      ownerUserId,
    );
    return { conversationId, contactId: existing.id, contactCreated: false };
  }

  const subject = (await opts?.subjectIfNew?.()) ?? null;
  const shortId = groupJid.split("@")[0].slice(-6);
  const name = subject || `Grupo ${shortId}`;

  const { data: created, error } = await db
    .from("contacts")
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      phone: groupJid, // só pra NOT NULL; a chave do grupo é wa_jid
      wa_jid: groupJid,
      is_group: true,
      name,
    })
    .select("id")
    .single();

  let contactId: string;
  let contactCreated = false;
  if (error || !created) {
    // Corrida com outra entrega do mesmo grupo -> re-resolve pelo jid.
    if (isUniqueViolation(error)) {
      const raced = await findGroupContact(db, accountId, groupJid);
      if (!raced) throw new Error("Falha ao criar contato-grupo (corrida)");
      contactId = raced.id;
    } else {
      throw new Error(`Falha ao criar contato-grupo: ${error?.message ?? ""}`);
    }
  } else {
    contactId = created.id as string;
    contactCreated = true;
  }

  const conversationId = await getOrCreateConversation(
    db,
    accountId,
    contactId,
    ownerUserId,
  );
  return { conversationId, contactId, contactCreated };
}
