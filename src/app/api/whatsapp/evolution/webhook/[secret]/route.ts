import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { attributeLeadToLink } from "@/lib/tracking-links/attribution";
import { captureInstancePhone } from "@/lib/whatsapp/capture-instance-phone";
import { resolveConversationByPhone } from "@/lib/whatsapp/resolve-conversation";
import { resolveGroupConversation } from "@/lib/whatsapp/resolve-group";
import { recordLead } from "@/lib/meta-ads/record";
import { recordGoogleLead } from "@/lib/google-ads/record";
import { getInstanceNumber, getGroupSubject } from "@/lib/whatsapp/evolution-api";
import { persistEvolutionIncomingMedia } from "@/lib/whatsapp/evolution-incoming-media";
import { resolveAuditUserId } from "@/lib/api/v1/contacts";
import { runAutomationsForTrigger } from "@/lib/automations/engine";
import { dispatchInboundToFlows } from "@/lib/flows/engine";
import { dispatchInboundToAiReply } from "@/lib/ai/auto-reply";
import { dispatchWebhookEvent } from "@/lib/webhooks/deliver";
import { dispatchClientLeadWebhook } from "@/lib/client-options/webhooks";
import {
  ehRuidoDeProtocolo,
  parseEvolutionMessageContent,
  resolveEvolutionChatJid,
  type EvolutionWebhookMessage,
} from "@/lib/whatsapp/evolution-webhook-message";

// POST /api/whatsapp/evolution/webhook/<secret>
//
// Recebe os eventos da Evolution (WhatsApp não-oficial) e roteia para a
// conta certa pelo NOME DA INSTÂNCIA (= id da conta, gravado em
// evolution_instances). Trata:
//   - connection.update  → atualiza o status da instância.
//   - messages.upsert    → cria contato/conversa/mensagem no inbox da
//                          conta e marca não lida.
//
// Autenticação: o segredo vai no CAMINHO da URL (não em header), porque
// funciona em qualquer versão da Evolution. Compara com timingSafeEqual
// para não vazar o valor por diferença de tempo de resposta.
//
// Sempre responde 200 para a Evolution não entrar em loop de retry; os
// erros ficam nos logs. Usa service role (ignora RLS) e escopa TUDO pelo
// account_id resolvido da instância — nunca cruza clientes.

/**
 * Traduz o status de ACK que a Evolution manda em `messages.update`
 * para o enum de `messages.status` do CRM. Aceita número (protocolo
 * nativo do WhatsApp: 2 = entregue, 3 = lida) ou string equivalente,
 * já que a Evolution pode achatar isso conforme a versão.
 */
function mapEvolutionAckStatus(
  raw: number | string | undefined,
): "delivered" | "read" | "failed" | null {
  if (raw === 2 || raw === "2" || raw === "DELIVERY_ACK") return "delivered";
  if (raw === 3 || raw === "3" || raw === "READ" || raw === "READ_ACK") return "read";
  if (raw === 0 || raw === "0" || raw === "ERROR" || raw === "error") return "failed";
  return null;
}

/** Compara dois segredos em tempo constante. */
function secretMatches(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  // timingSafeEqual lança se os buffers tiverem tamanhos diferentes, então
  // esse caso precisa ser tratado antes. Ainda assim fazemos uma comparação
  // de tempo constante com buffers dummy do mesmo tamanho, para o tempo de
  // resposta não diferenciar "tamanho errado" de "tamanho certo, valor
  // errado" (o que já vazaria o comprimento do segredo esperado).
  if (providedBuf.length !== expectedBuf.length) {
    timingSafeEqual(
      Buffer.alloc(expectedBuf.length),
      Buffer.alloc(expectedBuf.length),
    );
    return false;
  }
  return timingSafeEqual(providedBuf, expectedBuf);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ secret: string }> },
) {
  // Fail-closed: string vazia OU só espaço em branco conta como
  // ausente, para uma env preenchida por engano com espaço não virar
  // um "segredo" de fato vazio (nesse caso qualquer POST bateria contra
  // uma string vazia se o secret do caminho também viesse vazio).
  const expected = process.env.EVOLUTION_WEBHOOK_SECRET?.trim();
  if (!expected) {
    console.error(
      "[evolution/webhook] EVOLUTION_WEBHOOK_SECRET não configurada",
    );
    return NextResponse.json({ ok: true });
  }
  const { secret } = await params;
  if (!secretMatches(secret, expected)) {
    // 404 em vez de 401: não confirma que o caminho existe para quem está
    // sondando.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const body = (await request.json().catch(() => null)) as {
      event?: string;
      instance?: string;
      data?: unknown;
    } | null;
    if (!body?.instance) return NextResponse.json({ ok: true });

    const event = String(body.event ?? "").toLowerCase().replace(/_/g, ".");
    const db = supabaseAdmin();

    // instância → conta
    const { data: inst } = await db
      .from("evolution_instances")
      .select("id, account_id")
      .eq("instance_name", body.instance)
      .maybeSingle();
    if (!inst) return NextResponse.json({ ok: true });
    const accountId = inst.account_id as string;
    // Qual dos números do cliente recebeu esta mensagem. É o que permite
    // responder pelo MESMO número depois. `instance_name` é UNIQUE, então
    // o maybeSingle acima continua correto mesmo com vários números por
    // conta — o que mudou foram as consultas por `account_id`.
    const instanceId = inst.id as string;

    if (event === "connection.update") {
      const state = (body.data as { state?: string })?.state;
      const status =
        state === "open"
          ? "connected"
          : state === "connecting"
            ? "connecting"
            : "disconnected";
      const update: Record<string, unknown> = { status };
      // Ao conectar, captura e guarda o número (pra mostrar qual é de
      // qual cliente). Ao desconectar, limpa.
      if (state === "open") {
        const number = await getInstanceNumber(body.instance);
        if (number) update.phone = number;
      } else if (status === "disconnected") {
        update.phone = null;
      }
      await db
        .from("evolution_instances")
        .update(update)
        // Por ID. Filtrar por conta gravaria o estado deste número em
        // todos os do cliente: um número caindo apagaria o telefone
        // guardado dos outros e os mostraria como desconectados.
        .eq("id", instanceId);
      if (status === "connected") {
        await captureInstancePhone(db, accountId, body.instance);
      }
      return NextResponse.json({ ok: true });
    }

    if (event === "messages.upsert") {
      // "Quais conversas guardar" (migration 059). Lido UMA vez por
      // lote, não por mensagem: um lote pode trazer dezenas e a
      // preferência não muda no meio.
      const { data: conta } = await db
        .from("accounts")
        .select("conversation_scope")
        .eq("id", accountId)
        .maybeSingle();
      const ignorarGrupos = conta?.conversation_scope === "sem_grupos";

      const raw = body.data;
      const list = Array.isArray(raw) ? raw : [raw];
      for (const m of list as EvolutionWebhookMessage[]) {
        const jid = resolveEvolutionChatJid(m);
        if (!jid) {
          console.warn(
            "[evolution/webhook] mensagem sem JID telefônico utilizável",
            m?.key?.id,
          );
          continue;
        }
        // Reação e tráfego interno do WhatsApp não são conversa.
        //
        // Medido na Evolution de produção: 8% das mensagens (16 em 200)
        // viravam uma bolha vazia "[mensagem]" no inbox — a maioria
        // eram reações, o 👍 que alguém deu numa mensagem. O atendente
        // via conversa nova onde ninguém falou nada.
        //
        // Descartado ANTES de gravar: filtrar na exibição já teria
        // criado a mensagem, marcado a conversa como não lida e
        // disparado automação.
        if (ehRuidoDeProtocolo(m)) continue;

        const fromMe = m.key?.fromMe === true;
        const isGroup = jid.endsWith("@g.us");

        // Descarte ANTES de qualquer escrita.
        //
        // Para muitos clientes o grupo é conversa interna que só polui o
        // inbox do time e infla o banco. Filtrar na exibição não
        // resolveria: o contato-grupo, a conversa e as mídias já teriam
        // sido criados e ocupariam espaço no storage.
        //
        // Só vale para o que chega DEPOIS: nada é apagado para trás.
        if (isGroup && ignorarGrupos) continue;

        // Em grupo, pushName é o nome de QUEM falou (o participante); em
        // 1:1 é o nome do contato. phone só existe pra chats 1:1.
        const pushName = m.pushName ?? null;
        const phone = isGroup ? null : `+${jid.split("@")[0].split(":")[0]}`;
        const { contentType, text } = parseEvolutionMessageContent(m);
        const messageId = m.key?.id ?? undefined;
        const ts = m.messageTimestamp
          ? Number(m.messageTimestamp) * 1000
          : Date.now();

        try {
          // Idempotência: se já gravamos esse message_id, pula.
          if (messageId) {
            const { data: dup } = await db
              .from("messages")
              .select("id, conversations!inner(account_id)")
              .eq("message_id", messageId)
              .eq("conversations.account_id", accountId)
              .maybeSingle();
            if (dup) continue;
          }

          const conv = isGroup
            ? await resolveGroupConversation(db, accountId, jid, {
                subjectIfNew: () => getGroupSubject(body.instance!, jid),
              })
            : await resolveConversationByPhone(
                db,
                accountId,
                phone!,
                pushName,
                instanceId,
              );

          const mediaUrl =
            messageId && contentType !== "text"
              ? await persistEvolutionIncomingMedia(db, {
                  accountId,
                  instanceName: body.instance!,
                  messageId,
                  message: m,
                }).catch((err) => {
                  console.error("[evolution/webhook] media:", err);
                  return null;
                })
              : null;

          // Só interessa pra 1:1 — dispara o gate de "primeira mensagem do
          // contato" que automações/fluxos usam (first_inbound_message).
          // Calculado ANTES do insert abaixo, senão a própria mensagem
          // já contaria como "anterior".
          let isFirstInboundMessage = false;
          if (!isGroup && !fromMe) {
            const { count: priorCount } = await db
              .from("messages")
              .select("id", { count: "exact", head: true })
              .eq("conversation_id", conv.conversationId)
              .eq("sender_type", "customer");
            isFirstInboundMessage = (priorCount ?? 0) === 0;
          }

          const { data: insertedMessage, error: msgErr } = await db
            .from("messages")
            .insert({
              conversation_id: conv.conversationId,
              sender_type: fromMe ? "agent" : "customer",
              sender_id: null,
              content_type: contentType,
              content_text: text,
              media_url: mediaUrl,
              // Em grupo, guarda quem falou pra thread mostrar o autor.
              sender_name: isGroup && !fromMe ? pushName : null,
              message_id: messageId ?? null,
              status: fromMe ? "sent" : "delivered",
              created_at: new Date(ts).toISOString(),
            })
            .select("id")
            .single();
          if (msgErr || !insertedMessage) {
            console.error("[evolution/webhook] insert message:", msgErr);
            continue;
          }

          // Atribuição de origem (Links Rastreáveis): só age quando o
          // contato acabou de ser criado e o texto casa com a
          // mensagem-assinatura de um link ativo. Nunca lança. Roda só
          // depois do insert da mensagem confirmar sucesso, para não
          // atribuir uma conversa fantasma quando o insert falha.
          // Grupo não é lead: sem atribuição.
          if (!isGroup && !fromMe) {
            await attributeLeadToLink(
              db,
              accountId,
              conv.contactId,
              text,
              conv.contactCreated,
            );
          }

          // Lead novo -> conversão Meta/Google (best-effort). Só pra 1:1:
          // grupo não é um lead com telefone atribuível.
          if (conv.contactCreated && !isGroup && !fromMe && phone) {
            void recordLead(db, accountId, {
              contactId: conv.contactId,
              phone,
            });
            void recordGoogleLead(db, accountId, {
              contactId: conv.contactId,
              phone,
            });
            void dispatchClientLeadWebhook(db, accountId, "lead.created", {
              conversation_id: conv.conversationId,
              contact_id: conv.contactId,
              phone,
              name: pushName ?? null,
            });
          }

          // Prévia da lista: em grupo, prefixa com quem falou.
          const preview = text || "[mensagem]";
          const lastText =
            isGroup && pushName ? `${pushName}: ${preview}` : preview;

          const { data: current } = await db
            .from("conversations")
            .select("unread_count")
            .eq("id", conv.conversationId)
            .maybeSingle();
          await db
            .from("conversations")
            .update({
              last_message_text: lastText,
              last_message_at: new Date().toISOString(),
              unread_count:
                ((current?.unread_count as number) ?? 0) + (fromMe ? 0 : 1),
              updated_at: new Date().toISOString(),
            })
            .eq("id", conv.conversationId);

          // Paridade com o webhook da Meta (automação, fluxo, resposta de
          // IA e webhook de saída) — mesmo ponto do ciclo (depois do
          // insert confirmar), mesmos argumentos. Só 1:1: grupo fica de
          // fora pra não disparar automação de vendas dentro de grupo de
          // cliente.
          if (!isGroup && !fromMe) {
            const ownerUserId = await resolveAuditUserId(db, accountId);
            const metaMessageId = messageId ?? insertedMessage.id;

            const flowResult = await dispatchInboundToFlows({
              accountId,
              userId: ownerUserId,
              contactId: conv.contactId,
              conversationId: conv.conversationId,
              message: {
                // O motor de fluxos atualmente só distingue texto e
                // resposta interativa. Para mídia, o placeholder/caption
                // segue o mesmo contrato usado pelo webhook da Meta.
                kind: "text",
                text,
                meta_message_id: metaMessageId,
              },
              isFirstInboundMessage,
            });
            const flowConsumed = flowResult.consumed;

            const automationTriggers: (
              | "new_contact_created"
              | "first_inbound_message"
              | "new_message_received"
              | "keyword_match"
            )[] = [];
            if (!flowConsumed) {
              automationTriggers.push("new_message_received", "keyword_match");
            }
            if (conv.contactCreated) automationTriggers.unshift("new_contact_created");
            if (isFirstInboundMessage) automationTriggers.unshift("first_inbound_message");
            for (const triggerType of automationTriggers) {
              runAutomationsForTrigger({
                accountId,
                triggerType,
                contactId: conv.contactId,
                context: {
                  message_text: text,
                  conversation_id: conv.conversationId,
                },
              }).catch((err) => console.error("[automations] dispatch failed:", err));
            }

            if (!flowConsumed && text.trim()) {
              await dispatchInboundToAiReply({
                accountId,
                conversationId: conv.conversationId,
                contactId: conv.contactId,
                configOwnerUserId: ownerUserId,
              });
            }

            await dispatchWebhookEvent(db, accountId, "message.received", {
              conversation_id: conv.conversationId,
              contact_id: conv.contactId,
              whatsapp_message_id: metaMessageId,
              content_type: contentType,
              text,
              media_url: mediaUrl,
            });
          }
        } catch (err) {
          console.error("[evolution/webhook] message error:", err);
        }
      }
      return NextResponse.json({ ok: true });
    }

    if (event === "messages.update") {
      // ACK de entrega. Correlaciona pelo key.id que o 2.8 passou a
      // gravar em messages.message_id — sem isso não dava pra saber a
      // qual mensagem o ACK se refere.
      //
      // NÃO VERIFICADO contra tráfego real da Evolution (não há captura
      // de payload disponível no repo para conferir o formato exato).
      // Segue o shape nativo do Baileys (do qual a Evolution é wrapper):
      // `{ key: { id }, update: { status } }`, com fallback para um
      // `status` "solto" caso a Evolution achate o objeto.
      const raw = body.data;
      const list = (Array.isArray(raw) ? raw : [raw]).slice(0, 500);
      for (const u of list as Array<{
        key?: { id?: string };
        update?: { status?: number | string };
        status?: number | string;
      }>) {
        const waMessageId = u?.key?.id;
        if (!waMessageId) continue;
        const rawStatus = u.update?.status ?? u.status;
        const status = mapEvolutionAckStatus(rawStatus);
        if (!status) continue;

        // message_id não é único (ids do WhatsApp repetem entre
        // números) — atualiza 0..N linhas, sem `.select()`.
        const { data: targets, error: targetError } = await db
          .from("messages")
          .select("id, conversations!inner(account_id)")
          .eq("message_id", waMessageId)
          .eq("conversations.account_id", accountId);
        if (targetError) {
          console.error("[evolution/webhook] status lookup:", targetError);
          continue;
        }
        const targetIds = (targets ?? []).map((row) => row.id as string);
        if (targetIds.length === 0) continue;
        const { error } = await db
          .from("messages")
          .update({ status })
          .in("id", targetIds);
        if (error) {
          console.error("[evolution/webhook] status update:", error);
        }
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[evolution/webhook] fatal:", err);
    return NextResponse.json({ ok: true });
  }
}
