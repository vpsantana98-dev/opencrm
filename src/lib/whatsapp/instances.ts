import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Resolução de QUAL número de WhatsApp usar.
 *
 * Existe porque o sistema deixou de ter um número por cliente. Antes,
 * "a instância da conta" era uma consulta com `.maybeSingle()` espalhada
 * por 15 lugares — e `.maybeSingle()` ERRA quando há mais de uma linha,
 * então o segundo número quebraria o envio da conta inteira.
 *
 * Centralizar aqui garante que todos os caminhos escolham igual. Duas
 * regras diferentes de escolha em dois arquivos é como uma resposta sai
 * pelo telefone errado.
 */

export interface EvolutionInstance {
  id: string;
  account_id: string;
  instance_name: string;
  status: string;
  phone: string | null;
  label: string | null;
  is_default: boolean;
}

const COLUNAS = "id, account_id, instance_name, status, phone, label, is_default";

/** Todos os números do cliente, padrão primeiro. */
export async function listarInstancias(
  db: SupabaseClient,
  accountId: string,
): Promise<EvolutionInstance[]> {
  const { data, error } = await db
    .from("evolution_instances")
    .select(COLUNAS)
    .eq("account_id", accountId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as EvolutionInstance[];
}

/**
 * O número que a conta usa quando ninguém escolheu.
 *
 * Ordem: o marcado como padrão; senão, qualquer um CONECTADO; senão, o
 * primeiro que existir. A preferência pelo conectado importa porque um
 * padrão que caiu não deve travar o envio quando há outro número no ar.
 */
export function escolherPadrao(
  instancias: EvolutionInstance[],
): EvolutionInstance | null {
  if (instancias.length === 0) return null;
  // A ordem é: padrão no ar → qualquer um no ar → o padrão (mesmo
  // caído) → o primeiro. "Qualquer um no ar" vem ANTES do padrão caído
  // de propósito: quando o padrão está fora, entregar a mensagem por
  // outro número é melhor do que não entregar. Se todos estiverem
  // caídos, devolve o padrão para a falha ser sobre o número esperado.
  return (
    instancias.find((i) => i.is_default && i.status === "connected") ??
    instancias.find((i) => i.status === "connected") ??
    instancias.find((i) => i.is_default) ??
    instancias[0]
  );
}

/**
 * O número de uma CONVERSA — a resposta sai por onde a mensagem entrou.
 *
 * `instanceId` da conversa manda. Se ela não tem (conversa anterior a
 * esta mudança, ou número desconectado depois), cai no padrão: melhor
 * responder por outro número do que não responder.
 */
export function escolherParaConversa(
  instancias: EvolutionInstance[],
  instanceId: string | null | undefined,
): EvolutionInstance | null {
  if (instanceId) {
    const daConversa = instancias.find((i) => i.id === instanceId);
    if (daConversa) return daConversa;
  }
  return escolherPadrao(instancias);
}

/** Resolve direto do banco o número a usar numa conversa. */
export async function instanciaDaConversa(
  db: SupabaseClient,
  accountId: string,
  instanceId: string | null | undefined,
): Promise<EvolutionInstance | null> {
  return escolherParaConversa(await listarInstancias(db, accountId), instanceId);
}

/** Acha a instância pelo nome que a Evolution usa (chave do webhook). */
export async function instanciaPorNome(
  db: SupabaseClient,
  instanceName: string,
): Promise<EvolutionInstance | null> {
  const { data, error } = await db
    .from("evolution_instances")
    .select(COLUNAS)
    .eq("instance_name", instanceName)
    .maybeSingle();
  // `instance_name` é UNIQUE, então aqui o `.maybeSingle()` continua
  // correto — diferente das consultas por `account_id`, que agora
  // podem devolver várias linhas.
  if (error) throw error;
  return (data as EvolutionInstance | null) ?? null;
}

/** Resumo para a UI: quantos números, quantos no ar. */
export function resumo(instancias: EvolutionInstance[]): {
  total: number;
  conectados: number;
} {
  return {
    total: instancias.length,
    conectados: instancias.filter((i) => i.status === "connected").length,
  };
}
