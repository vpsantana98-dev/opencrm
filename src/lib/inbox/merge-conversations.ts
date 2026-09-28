import type { Conversation } from "@/types";

/**
 * Reconcilia a lista de conversas vinda de um refetch (polling ou resync)
 * com o estado atual, em vez de substituir tudo — era isso que ressuscitava
 * o badge de não-lidas já zerado otimisticamente e invalidava a identidade
 * de objeto de cada conversa a cada ciclo.
 *
 * - a conversa `activeId` (a que o agente está vendo agora) nunca sai daqui
 *   com `unread_count` diferente de 0 — ela foi zerada de propósito ao ser
 *   aberta, e o valor "velho" que ainda não convergiu no banco não pode
 *   ressuscitar o badge;
 * - conversas já existentes e inalteradas mantêm a MESMA referência de
 *   objeto do array anterior;
 * - resultado na ordem em que `incoming` já vem (mais recente primeiro).
 *
 * `incoming` vazio nunca apaga o estado atual — evita que um refetch
 * falho/atrasado esvazie a lista por engano.
 */
export function mergeConversations(
  prev: Conversation[],
  incoming: Conversation[],
  activeId: string | null,
): Conversation[] {
  if (incoming.length === 0) return prev;

  const prevById = new Map(prev.map((c) => [c.id, c]));

  return incoming.map((conv) => {
    const patched: Conversation =
      conv.id === activeId && conv.unread_count !== 0
        ? { ...conv, unread_count: 0 }
        : conv;

    const existing = prevById.get(conv.id);
    if (existing && JSON.stringify(existing) === JSON.stringify(patched)) {
      return existing;
    }
    return patched;
  });
}
