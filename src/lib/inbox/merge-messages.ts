import type { Message } from "@/types";

function isOptimistic(m: Message): boolean {
  return m.id.startsWith("temp-");
}

// Decide se `candidate` (uma linha vinda do banco) é o correspondente real
// de `temp` (uma bolha otimista ainda em voo): mesmo remetente, mesmo tipo
// de conteúdo e mesmo texto/mídia. Não há uma chave de correlação
// client→servidor, então isto é o melhor sinal disponível — na prática só
// existe uma bolha otimista por vez em voo por conversa.
function matchesOptimistic(candidate: Message, temp: Message): boolean {
  if (candidate.sender_type !== temp.sender_type) return false;
  if (candidate.content_type !== temp.content_type) return false;
  if (temp.media_url) return candidate.media_url === temp.media_url;
  return (candidate.content_text ?? "") === (temp.content_text ?? "");
}

/**
 * Reconcilia o array de mensagens vindo de um refetch (polling ou resync)
 * com o estado atual, em vez de substituir tudo — era isso que matava a
 * bolha otimista "temp-" e invalidava a identidade de objeto (e todo
 * useMemo dependente) de cada mensagem a cada ciclo.
 *
 * - mensagens já existentes e inalteradas (mesmo id + status + content_text
 *   + media_url) mantêm a MESMA referência de objeto do array anterior;
 * - bolhas otimistas cujo correspondente real já chegou em `incoming` são
 *   descartadas (o item real já está em `incoming`); as demais (envio
 *   ainda em voo) sobrevivem;
 * - resultado ordenado por `created_at`.
 *
 * `incoming` vazio nunca apaga o estado atual — evita que um refetch
 * falho/atrasado esvazie a tela por engano.
 */
export function mergeMessages(prev: Message[], incoming: Message[]): Message[] {
  if (incoming.length === 0) return prev;

  const prevById = new Map(prev.map((m) => [m.id, m]));

  const merged = incoming.map((msg) => {
    const existing = prevById.get(msg.id);
    if (
      existing &&
      existing.status === msg.status &&
      existing.content_text === msg.content_text &&
      existing.media_url === msg.media_url
    ) {
      return existing;
    }
    return msg;
  });

  const consumedIncomingIds = new Set<string>();
  const survivingOptimistic = prev.filter((m) => {
    if (!isOptimistic(m)) return false;
    const match = incoming.find(
      (candidate) =>
        !consumedIncomingIds.has(candidate.id) &&
        matchesOptimistic(candidate, m),
    );
    if (match) {
      consumedIncomingIds.add(match.id);
      return false;
    }
    return true;
  });

  return [...merged, ...survivingOptimistic].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
}
