// ============================================================
// Resolve (or create) the conversation for a phone number.
//
// The dashboard composer always has a `conversation_id` in hand. The
// public API doesn't — an external automation knows a *phone number*,
// not an internal UUID. This helper bridges that: given an E.164
// phone, it finds-or-creates the contact and its conversation so the
// shared `sendMessageToConversation` core can run unchanged.
//
// It deliberately reuses the exact find-or-create logic the inbound
// webhook uses (the `findExistingContact` dedupe helper, the
// one-conversation-per-(account, contact) convention, the
// account_id-tenancy / user_id-audit split) so a contact created via
// the API is indistinguishable from one created by an inbound message.
//
// Audit user: created rows need a NOT NULL `user_id`. As with the
// webhook (where there's no logged-in human either), we attribute
// them to the WhatsApp config owner — a stable account-level default.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';
import { SendMessageError } from '@/lib/whatsapp/send-message';
import { resolveAuditUserId, ContactError } from '@/lib/api/v1/contacts';

/**
 * O nome atual do contato é só um marcador de lugar?
 *
 * Um contato criado sem nome recebe o próprio telefone como nome (ver o
 * `insert` em `resolveConversationByPhone`). Enquanto estiver assim, vale
 * preencher com o que o WhatsApp mandar. Depois disso o nome é do
 * usuário e nada automático encosta nele.
 *
 * Compara só os DÍGITOS: o telefone é gravado sanitizado, mas o nome
 * pode ter sido gravado com "+", espaços ou parênteses em versões
 * anteriores — e aí a comparação literal falharia, tratando um
 * placeholder como nome escolhido a dedo.
 */
export function ehPlaceholder(
  nomeAtual: string | null | undefined,
  telefone: string,
): boolean {
  if (!nomeAtual || !nomeAtual.trim()) return true;
  const digitos = (v: string) => v.replace(/\D/g, "");
  return digitos(nomeAtual) === digitos(telefone) && digitos(telefone).length > 0;
}

export interface ResolvedConversation {
  conversationId: string;
  contactId: string;
  /** True if this call created the contact (vs matched an existing one). */
  contactCreated: boolean;
}

/**
 * Find or create the contact + conversation for `phone` within
 * `accountId`. Throws `SendMessageError` (shared with the send core,
 * so the route maps one error family) on a bad phone, a missing
 * WhatsApp config, or a DB failure.
 */
export async function resolveConversationByPhone(
  db: SupabaseClient,
  accountId: string,
  phone: string,
  name?: string | null,
  /**
   * Por qual número esta conversa entrou.
   *
   * É o que permite responder pelo MESMO número: quem escreveu para o
   * Suporte recebe resposta do Suporte. Opcional porque quem inicia uma
   * conversa a partir do CRM ainda não escolheu número — aí o envio cai
   * no padrão da conta.
   */
  instanceId?: string | null
): Promise<ResolvedConversation> {
  const sanitized = sanitizePhoneForMeta(phone);
  if (!isValidE164(sanitized)) {
    throw new SendMessageError(
      'bad_request',
      "'to' must be a valid phone number in E.164 format (e.g. +14155550123)",
      400
    );
  }

  // Fail fast (and create nothing) when the account has NO WhatsApp
  // connected by ANY provider — Meta (whatsapp_config) or Evolution
  // (evolution_instances). Same error the send would raise anyway.
  const [{ data: metaConfig }, { data: evoInstance }] = await Promise.all([
    db.from('whatsapp_config').select('id').eq('account_id', accountId).maybeSingle(),
    // `.limit(1)` e nao `.maybeSingle()`: agora uma conta pode ter
    // VARIOS numeros, e o maybeSingle erraria com mais de uma linha.
    // Aqui so interessa "existe algum?".
    db.from('evolution_instances').select('account_id').eq('account_id', accountId).limit(1),
  ]);
  if (!metaConfig && (evoInstance ?? []).length === 0) {
    throw new SendMessageError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400
    );
  }

  // Audit user for created rows = the single account-wide default used
  // by every public-API write (see resolveAuditUserId), so a contact
  // created here is attributed identically to one created via
  // POST /api/v1/contacts. resolveAuditUserId throws ContactError only
  // if the owner can't be resolved — remap it to the send error family
  // the callers already handle.
  let ownerUserId: string;
  try {
    ownerUserId = await resolveAuditUserId(db, accountId);
  } catch (err) {
    if (err instanceof ContactError) {
      throw new SendMessageError('db_error', err.message, err.status);
    }
    throw err;
  }

  // ---- contact -------------------------------------------------
  let contactId: string;
  let contactCreated = false;

  const existing = await findExistingContact(db, accountId, sanitized);
  if (existing) {
    contactId = existing.id;
    // Só preenche o nome quando ele ainda é PLACEHOLDER.
    //
    // Antes, qualquer nome novo sobrescrevia o existente. Como o
    // `pushName` é o nome que a PESSOA escolheu para si — e ela pode
    // trocar quando quiser — o nome que você deu ao contato no CRM era
    // apagado na mensagem seguinte. Aconteceu em produção: um contato
    // salvo como "Vinícius" virou "Psicóloga Sarah Vitoria" sozinho.
    //
    // O placeholder é o próprio telefone: é o que o `insert` abaixo grava
    // quando a primeira mensagem não traz nome. Então a primeira mensagem
    // COM nome preenche, e a partir daí o nome é seu — a agenda do CRM
    // manda, não a do contato.
    if (name && ehPlaceholder(existing.name, sanitized)) {
      await db
        .from('contacts')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    }
  } else {
    const { data: created, error: createErr } = await db
      .from('contacts')
      .insert({
        account_id: accountId,
        user_id: ownerUserId,
        phone: sanitized,
        name: name || sanitized,
      })
      .select('id')
      .single();

    if (createErr || !created) {
      // Lost a race against a concurrent inbound/API create — the
      // unique index (migration 022) rejected the duplicate. Re-resolve.
      if (isUniqueViolation(createErr)) {
        const raced = await findExistingContact(db, accountId, sanitized);
        if (raced) {
          contactId = raced.id;
        } else {
          throw new SendMessageError(
            'db_error',
            'Failed to create contact',
            500
          );
        }
      } else {
        console.error(
          '[resolve-conversation] contact create error:',
          createErr
        );
        throw new SendMessageError('db_error', 'Failed to create contact', 500);
      }
    } else {
      contactId = created.id;
      contactCreated = true;
    }
  }

  // ---- conversation -------------------------------------------
  // One conversation per (account, contact) — same convention as the
  // webhook.
  const { data: conv } = await db
    .from('conversations')
    .select('id, instance_id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .maybeSingle();

  if (conv?.id) {
    // Conversa criada antes desta mudança (ou cujo número foi removido)
    // ganha o número na primeira mensagem que chegar. Só preenche
    // quando está vazio: reescrever apagaria o vínculo original de uma
    // conversa que já pertence a outro número.
    if (instanceId && !conv.instance_id) {
      await db
        .from('conversations')
        .update({ instance_id: instanceId })
        .eq('id', conv.id);
    }
    return { conversationId: conv.id, contactId, contactCreated };
  }

  const { data: newConv, error: convErr } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      contact_id: contactId,
      // Por qual número esta conversa nasceu. Null quando a conversa
      // parte do CRM (ninguém escolheu número) — aí o envio usa o padrão.
      instance_id: instanceId ?? null,
    })
    .select('id')
    .single();

  if (convErr || !newConv) {
    console.error('[resolve-conversation] conversation create error:', convErr);
    throw new SendMessageError(
      'db_error',
      'Failed to create conversation',
      500
    );
  }

  return { conversationId: newConv.id, contactId, contactCreated };
}
