import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Pendências por cliente — o que precisa de alguém HOJE.
 *
 * Três sinais, escolhidos por um critério: só entra o que significa
 * "alguém está sendo mal atendido agora". Disparo que falhou ontem e
 * pixel não configurado são importantes, mas não mudam o seu dia como
 * um WhatsApp fora do ar muda — por isso ficaram de fora.
 *
 * Nada aqui precisa de migration: os três saem de dados que já existem.
 * `deals` parado numa etapa ficou de fora também por isso — sem
 * histórico de etapa, qualquer edição no negócio zeraria o contador e a
 * faixa acusaria coisa errada.
 */

/** Padrão de espera. Uma hora sem resposta é o limite acordado. */
export const ESPERA_PADRAO_MINUTOS = 60;

export interface PendenciaCliente {
  accountId: string;
  nome: string;
  /** WhatsApp desconectado: não entra nem sai mensagem. */
  whatsappCaido: boolean;
  /** Conversas abertas com o cliente esperando além do limite. */
  esperando: number;
  /** Conversas abertas sem ninguém responsável. */
  semResponsavel: number;
}

export interface PendenciasData {
  /** Só clientes COM alguma pendência, mais grave primeiro. */
  clientes: PendenciaCliente[];
  limiteMinutos: number;
}

/** Linha da RPC `agency_overview` que interessa aqui. */
export interface ContaOverview {
  account_id: string;
  account_name: string | null;
  whatsapp_connected: boolean | null;
}

export interface ConversaAberta {
  account_id: string;
  assigned_agent_id: string | null;
  unread_count: number | null;
  last_message_at: string | null;
}

/**
 * Monta a lista a partir das duas leituras. Pura, para ser testável.
 *
 * `agora` entra por parâmetro porque a regra depende do relógio, e um
 * teste que usa a hora real falha sozinho em algum fuso.
 */
export function montarPendencias(
  contas: ContaOverview[],
  conversas: ConversaAberta[],
  agora: Date = new Date(),
  limiteMinutos: number = ESPERA_PADRAO_MINUTOS,
): PendenciasData {
  const porConta = new Map<string, { esperando: number; semResponsavel: number }>();
  const limiteMs = limiteMinutos * 60_000;

  for (const c of conversas) {
    const linha = porConta.get(c.account_id) ?? { esperando: 0, semResponsavel: 0 };

    // Esperando: há mensagem do cliente não lida E a última movimentação
    // já passou do limite. `unread_count` é o contador que o inbox zera
    // quando alguém abre a conversa — é o sinal mais direto de "tem
    // gente esperando" que existe sem reprocessar o histórico.
    if ((c.unread_count ?? 0) > 0 && c.last_message_at) {
      const parada = agora.getTime() - new Date(c.last_message_at).getTime();
      if (parada >= limiteMs) linha.esperando += 1;
    }

    if (!c.assigned_agent_id) linha.semResponsavel += 1;

    porConta.set(c.account_id, linha);
  }

  const clientes = contas
    .map((conta) => {
      const l = porConta.get(conta.account_id) ?? { esperando: 0, semResponsavel: 0 };
      return {
        accountId: conta.account_id,
        nome: conta.account_name?.trim() || "Sem nome",
        // `null` (cliente sem WhatsApp configurado) NÃO é queda: não dá
        // para "cair" o que nunca foi ligado. Acusar isso encheria a
        // faixa de cliente recém-criado e ensinaria você a ignorá-la.
        whatsappCaido: conta.whatsapp_connected === false,
        esperando: l.esperando,
        semResponsavel: l.semResponsavel,
      };
    })
    .filter((c) => c.whatsappCaido || c.esperando > 0 || c.semResponsavel > 0)
    // WhatsApp caído primeiro: é o único sinal que impede QUALQUER
    // atendimento. Depois por volume de gente esperando.
    .sort(
      (a, b) =>
        Number(b.whatsappCaido) - Number(a.whatsappCaido) ||
        b.esperando - a.esperando ||
        b.semResponsavel - a.semResponsavel ||
        a.nome.localeCompare(b.nome, "pt-BR"),
    );

  return { clientes, limiteMinutos };
}

/**
 * Lê as pendências de todos os clientes que o usuário atende.
 *
 * Duas leituras, nenhuma migration:
 *  - `agency_overview()` (RPC já existente, SECURITY DEFINER e escopada
 *    por participação) dá nome e estado do WhatsApp de cada conta;
 *  - `conversations` vem pela RLS, que já limita às contas do usuário —
 *    aqui isso é exatamente o recorte desejado, porque a faixa é
 *    CROSS-cliente de propósito.
 */
export async function loadPendencias(
  db: SupabaseClient,
  limiteMinutos: number = ESPERA_PADRAO_MINUTOS,
): Promise<PendenciasData> {
  const [overviewRes, conversasRes] = await Promise.all([
    db.rpc("agency_overview"),
    db
      .from("conversations")
      .select("account_id, assigned_agent_id, unread_count, last_message_at")
      .eq("status", "open"),
  ]);

  if (overviewRes.error) throw overviewRes.error;
  if (conversasRes.error) throw conversasRes.error;

  return montarPendencias(
    (overviewRes.data ?? []) as ContaOverview[],
    (conversasRes.data ?? []) as ConversaAberta[],
    new Date(),
    limiteMinutos,
  );
}
