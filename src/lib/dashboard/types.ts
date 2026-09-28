// Shared result shapes the dashboard components consume. Centralised
// here so each component stays thin and the page-level loader wires
// them up without type gymnastics.

/**
 * Um número de fluxo e o mesmo número na janela anterior de igual
 * tamanho (30 dias comparam com os 30 anteriores).
 *
 * `previous` é o VALOR do período anterior, não a diferença — quem
 * exibe decide se mostra a variação absoluta ou percentual. Guardar a
 * diferença aqui perderia a base, e "+3" sobre 4 é uma história bem
 * diferente de "+3" sobre 400.
 */
export interface MetricDelta {
  current: number
  previous: number
}

/**
 * Os quatro números do topo, separados pela natureza deles.
 *
 * ESTOQUE é um estado no momento presente ("quantas conversas estão
 * abertas"). FLUXO são eventos dentro de uma janela ("quantos contatos
 * entraram"). A distinção existe porque o seletor de período só pode
 * comandar os fluxos: "conversas abertas em outubro" exigiria fotos
 * históricas do estado, que este sistema não guarda. Filtrar um estoque
 * por data produziria um número que parece exato e é inventado.
 *
 * Cada cartão diz na tela a qual grupo pertence — sem isso, dois
 * números lado a lado com significados diferentes de tempo é armadilha.
 */
export interface MetricsBundle {
  /** ESTOQUE — conversas com status 'open' agora. */
  conversasAbertas: number
  /** ESTOQUE — soma e contagem dos negócios em aberto. */
  valorNegociosAbertos: number
  negociosAbertos: number

  /** FLUXO — contatos criados na janela (grupos não contam). */
  contatosNovos: MetricDelta
  /** FLUXO — mensagens enviadas pela equipe na janela (exclui bot). */
  mensagensEnviadas: MetricDelta
}

export interface ConversationsSeriesPoint {
  day: string // YYYY-MM-DD local
  incoming: number
  outgoing: number
}

/**
 * Uma etapa dentro do funil de conversão.
 *
 * Repare na diferença entre `naEtapa` e `alcancaram`: a primeira é onde
 * o negócio ESTÁ agora; a segunda é quantos já passaram por aqui. Só a
 * segunda produz um funil — a primeira é uma distribuição, e é por isso
 * que a rosca antiga não conseguia mostrar taxa de conversão.
 */
export interface FunnelStage {
  id: string
  name: string
  color: string
  /** Negócios parados NESTA etapa neste momento. */
  naEtapa: number
  valorNaEtapa: number
  /**
   * Negócios que chegaram até aqui — os desta etapa mais os de todas as
   * seguintes. Assume que negócio não volta para trás; sem histórico de
   * etapa não há como detectar um retrocesso.
   */
  alcancaram: number
  /**
   * Fração que passou da etapa anterior para esta (0–1). `null` na
   * primeira etapa, que não tem anterior, e quando a anterior está
   * zerada — dividir por zero daria 0% ou Infinity, e os dois mentem.
   */
  taxaDaAnterior: number | null
}

export interface PipelineFunnelData {
  pipelineId: string
  pipelineName: string
  /** Para o seletor, quando a conta tem mais de um funil. */
  funisDisponiveis: { id: string; name: string }[]
  stages: FunnelStage[]
  /** Negócios que entraram no funil (chegaram à primeira etapa). */
  totalEntraram: number
  /** Fração que percorreu o funil inteiro (0–1), ou `null`. */
  taxaGeral: number | null
  /** Soma de `value` de todos os negócios considerados. */
  valorTotal: number
}

/**
 * De onde vieram os leads.
 *
 * Só três baldes, e não os quatro do painel de referência: `gclid`
 * existe na tabela `contacts` mas NUNCA é gravado — o código só lê a
 * coluna, em `api/account/meta-ads/conversion`. Um balde "Google Ads"
 * seria uma faixa permanentemente vazia dando a impressão de que a
 * origem está sendo medida. Quando a captura do gclid existir, é aqui
 * que ele entra.
 */
export type LeadSource = 'meta' | 'link' | 'organico'

export interface LeadSourcePoint {
  day: string // YYYY-MM-DD local
  meta: number
  link: number
  organico: number
}

export interface LeadSourcesData {
  series: LeadSourcePoint[]
  totals: Record<LeadSource, number>
  /** Contatos criados no período (soma dos três baldes). */
  total: number
  /**
   * Fração de leads SEM origem identificada (0–1).
   *
   * É o número mais útil desta tela e o motivo de ele existir: com a
   * Evolution, o webhook não captura a referência do anúncio, então
   * uma cobertura baixa significa "não sabemos de onde vem", e não
   * "veio do orgânico". Sem isto, o gráfico faria uma afirmação forte
   * a partir de uma ausência de dado.
   */
  fracaoSemOrigem: number
}

/**
 * Uma origem no ranking: um link rastreável, uma campanha de UTM ou um
 * anúncio específico.
 *
 * Mais fino que `LeadSource` de propósito. Aquele responde "quanto vem
 * de anúncio vs. link"; este responde "QUAL anúncio, QUAL link" — que é
 * a pergunta de quem decide onde colocar verba.
 */
export interface OrigemRanking {
  /** Chave estável de agrupamento (não exibida). */
  id: string
  /** Nome legível. Nunca um id cru quando houver alternativa. */
  nome: string
  tipo: 'link' | 'campanha' | 'anuncio'
  leads: number
  /** Fração do total atribuído (0–1), para a barra. */
  fracao: number
}

export interface TopOrigensData {
  origens: OrigemRanking[]
  /** Leads COM origem identificada no período. */
  totalAtribuido: number
  /**
   * Leads sem nenhum marcador de origem. Não entram no ranking — não
   * são uma origem, são a ausência de uma. Mostrado à parte para o
   * ranking não parecer o total.
   */
  semOrigem: number
}

export interface ResponseTimeBucket {
  /** 0 = Mon … 6 = Sun (Monday-first). */
  dow: number
  /** Average first-response time in minutes. Null means no samples. */
  avgMinutes: number | null
  samples: number
}

export interface ResponseTimeSummary {
  buckets: ResponseTimeBucket[]
  thisWeekAvg: number | null
  lastWeekAvg: number | null
}

export type ActivityKind =
  | 'message'
  | 'deal'
  | 'broadcast'
  | 'automation'
  | 'contact'

export interface ActivityItem {
  id: string
  kind: ActivityKind
  /** Primary line of text rendered in the feed. Pre-formatted. */
  text: string
  /** ISO timestamp the item happened at, drives relative-time + sort. */
  at: string
  /** Optional deep-link for the whole row (not all items have a target). */
  href?: string
}
