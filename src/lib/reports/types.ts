/**
 * Tipos do relatório de desempenho por atendente.
 *
 * Recorte deliberado: só entra aqui o que NÃO existe em outra tela.
 * Volume de conversas, funil por etapa e tempo de resposta agregado já
 * são mostrados pelo Dashboard (ConversationsChart, PipelineFunnel,
 * ResponseTimeChart) — repetir aquilo aqui seria manter duas versões da
 * mesma conta, que é como relatórios passam a discordar entre si.
 */

import type { AccountRole } from "@/lib/auth/roles";

/** Uma linha da tabela: um atendente no período escolhido. */
export interface AgentReportRow {
  userId: string;
  nome: string;
  /** Só preenchido para admin+; agente/visualizador vê nomes apenas. */
  email: string | null;
  avatarUrl: string | null;
  papel: AccountRole | null;

  /** Mensagens que ESTE atendente enviou no período. */
  mensagensEnviadas: number;
  /** Conversas distintas em que ele enviou ao menos uma mensagem. */
  conversasAtendidas: number;
  /**
   * Conversas cujo `assigned_agent_id` é ele HOJE.
   *
   * Estado atual, não do período: a atribuição não tem histórico, então
   * este número responde "de quem é a fila agora", não "de quem era".
   */
  conversasAtribuidas: number;

  /**
   * Média, em minutos, entre a mensagem do cliente e a resposta DESTE
   * atendente. `null` quando não houve nenhum par no período — o que é
   * diferente de zero e a tela precisa distinguir.
   */
  tempoMedioRespostaMin: number | null;
  /** Quantos pares sustentam a média acima. Média de 1 amostra engana. */
  amostrasResposta: number;
}

export interface ReportsTotals {
  mensagensEnviadas: number;
  mensagensRecebidas: number;
  conversasNovas: number;
  contatosNovos: number;
}

export interface ReportsBundle {
  periodo: { from: string; to: string; dias: number };
  agentes: AgentReportRow[];
  totais: ReportsTotals;

  /**
   * Mensagens de agente no período SEM `sender_id`.
   *
   * Antes desta versão o envio não gravava quem enviou, então tudo que
   * é anterior a ela cai aqui e não pode ser atribuído a ninguém —
   * nunca. A tela mostra este número junto da tabela: sem ele, um
   * atendente com "0 mensagens" parece ocioso quando na verdade o dado
   * é que não existe.
   */
  mensagensSemAutoria: number;

  /**
   * `true` quando o período tem mais mensagens do que o teto de leitura.
   * Os números viram uma amostra, não o total — e a tela precisa dizer
   * isso em vez de exibir um número errado com cara de exato.
   */
  truncado: boolean;
}
