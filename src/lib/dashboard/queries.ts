import type { SupabaseClient } from '@supabase/supabase-js'
import {
  daysAgoStart,
  DOW_SHORT_MON_FIRST,
  lastNDayKeys,
  localDayKey,
  mondayIndex,
  startOfLocalDay,
} from './date-utils'
import type {
  ActivityItem,
  ConversationsSeriesPoint,
  FunnelStage,
  LeadSource,
  LeadSourcePoint,
  LeadSourcesData,
  MetricsBundle,
  OrigemRanking,
  PipelineFunnelData,
  ResponseTimeBucket,
  TopOrigensData,
  ResponseTimeSummary,
} from './types'

// ------------------------------------------------------------
// All client-side aggregation. RLS scopes every query to the
// signed-in user automatically, so we never pass user_id explicitly
// here. Perf is acceptable for the current scale (low thousands of
// messages) — if a tenant's dataset outgrows this, we'd migrate the
// heavy aggregations to SQL RPCs. Noted in the PR.
// ------------------------------------------------------------

type DB = SupabaseClient

// --- 1. Metric cards ---------------------------------------------------

/**
 * Os quatro numeros do topo, para uma janela de `rangeDays` dias.
 *
 * Duas coisas mudaram junto com a chegada do seletor global de periodo:
 *
 * 1. ESTOQUE x FLUXO. Conversas abertas e valor em aberto sao estados do
 *    momento presente e NAO recebem filtro de data — nao existe foto
 *    historica desses estados no banco, entao "conversas abertas em
 *    outubro" seria um numero inventado com cara de exato. Contatos
 *    novos e mensagens enviadas sao eventos e recebem a janela.
 *
 * 2. A comparacao passou a ser com a janela ANTERIOR de igual tamanho
 *    (30 dias contra os 30 de tras), em vez do "vs ontem" fixo. Comparar
 *    30 dias com um unico dia anterior nao dizia nada.
 *
 * O `accountId` explicito nao e redundancia: a RLS destas tabelas usa
 * `is_account_member`, que autoriza QUALQUER conta da qual o usuario
 * participa. Sem o filtro, quem atende varios clientes veria a soma de
 * todos eles no painel de um so.
 */
export async function loadMetrics(
  db: DB,
  accountId: string,
  rangeDays: number,
): Promise<MetricsBundle> {
  // Janela atual: [inicio, agora]. Anterior: a de mesmo tamanho colada
  // antes dela, para a comparacao ser entre iguais.
  const inicioAtual = daysAgoStart(rangeDays - 1)
  const inicioAnterior = daysAgoStart(rangeDays * 2 - 1)
  const A = inicioAtual.toISOString()
  const B = inicioAnterior.toISOString()

  const [
    convAbertas,
    negociosAbertos,
    contatosAtual,
    contatosAnterior,
    msgsAtual,
    msgsAnterior,
  ] = await Promise.all([
    // ESTOQUE — sem filtro de data, de proposito.
    db
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('status', 'open'),
    db
      .from('deals')
      .select('value')
      .eq('account_id', accountId)
      .eq('status', 'open'),

    // FLUXO — contato-grupo do WhatsApp nao e contato de verdade e nao
    // pode inflar a metrica.
    db
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('is_group', false)
      .gte('created_at', A),
    db
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('is_group', false)
      .gte('created_at', B)
      .lt('created_at', A),

    // `messages` nao tem account_id: o vinculo com a conta e so via
    // conversation_id, dai o join com !inner (mesma razao do relatorio
    // por atendente). `sender_type = agent` exclui o bot — o cartao fala
    // do trabalho da EQUIPE.
    db
      .from('messages')
      .select('id, conversations!inner(account_id)', { count: 'exact', head: true })
      .eq('conversations.account_id', accountId)
      .eq('sender_type', 'agent')
      .gte('created_at', A),
    db
      .from('messages')
      .select('id, conversations!inner(account_id)', { count: 'exact', head: true })
      .eq('conversations.account_id', accountId)
      .eq('sender_type', 'agent')
      .gte('created_at', B)
      .lt('created_at', A),
  ])

  // Erro checado em todas: `count` nulo viraria zero, e um zero falso e
  // indistinguivel de "nao houve movimento".
  for (const r of [convAbertas, negociosAbertos, contatosAtual, contatosAnterior, msgsAtual, msgsAnterior]) {
    if (r.error) throw r.error
  }

  const linhas = (negociosAbertos.data ?? []) as { value: number | null }[]

  return {
    conversasAbertas: convAbertas.count ?? 0,
    valorNegociosAbertos: linhas.reduce((s, d) => s + (d.value ?? 0), 0),
    negociosAbertos: linhas.length,
    contatosNovos: {
      current: contatosAtual.count ?? 0,
      previous: contatosAnterior.count ?? 0,
    },
    mensagensEnviadas: {
      current: msgsAtual.count ?? 0,
      previous: msgsAnterior.count ?? 0,
    },
  }
}

// --- 2. Conversations over time ---------------------------------------

export async function loadConversationsSeries(
  db: DB,
  rangeDays: number,
): Promise<ConversationsSeriesPoint[]> {
  const start = daysAgoStart(rangeDays - 1).toISOString()
  const { data, error } = await db
    .from('messages')
    .select('created_at, sender_type')
    .gte('created_at', start)
    .order('created_at', { ascending: true })
  if (error) throw error

  const keys = lastNDayKeys(rangeDays)
  const buckets = new Map<string, { incoming: number; outgoing: number }>()
  for (const k of keys) buckets.set(k, { incoming: 0, outgoing: 0 })

  for (const row of (data ?? []) as { created_at: string; sender_type: string }[]) {
    const key = localDayKey(row.created_at)
    const bucket = buckets.get(key)
    if (!bucket) continue
    if (row.sender_type === 'customer') bucket.incoming += 1
    else bucket.outgoing += 1 // agent + bot both count as outgoing
  }

  return keys.map((day) => ({ day, ...(buckets.get(day) ?? { incoming: 0, outgoing: 0 }) }))
}

// --- 3. Funil de conversão ---------------------------------------------

/**
 * Funil de conversão de UM pipeline.
 *
 * Substituiu a rosca "Valor do funil" (`loadPipelineDonut`), que tinha
 * dois defeitos além de mostrar o gráfico errado:
 *
 *  1. Buscava `pipeline_stages` sem filtrar por funil nenhum. Com dois
 *     funis — o caso normal de quem atende mais de um cliente — devolvia
 *     as etapas dos dois embaralhadas: duas etapas na posição 0, duas na
 *     1, nomes repetidos na legenda. Numa rosca isso passava
 *     despercebido (são só fatias); num funil viraria uma escada sem pé
 *     nem cabeça.
 *  2. Escondia as etapas vazias. Num funil, a etapa vazia É a
 *     informação: foi ali que todo mundo parou.
 *
 * O `accountId` explícito também é necessário: a RLS de
 * `pipeline_stages` usa `is_account_member`, que autoriza QUALQUER
 * conta do usuário, não a ativa.
 */
export async function loadPipelineFunnel(
  db: DB,
  accountId: string,
  pipelineId?: string,
): Promise<PipelineFunnelData | null> {
  const { data: pipelinesRaw, error: pipeErr } = await db
    .from('pipelines')
    .select('id, name')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })
  if (pipeErr) throw pipeErr

  const funis = (pipelinesRaw ?? []) as { id: string; name: string }[]
  if (funis.length === 0) return null

  // Um id inválido (vindo de uma URL velha, por exemplo) cai no
  // primeiro funil em vez de devolver uma tela vazia sem explicação.
  const escolhido = funis.find((p) => p.id === pipelineId) ?? funis[0]

  const [stagesRes, dealsRes] = await Promise.all([
    db
      .from('pipeline_stages')
      .select('id, name, color, position')
      .eq('pipeline_id', escolhido.id)
      .order('position', { ascending: true }),
    // TODOS os status, não só 'open'. Um negócio ganho ou perdido também
    // passou pelas etapas — deixá-lo de fora esvaziaria justamente o
    // fundo do funil, que é onde está a resposta que interessa.
    db
      .from('deals')
      .select('stage_id, value, status')
      .eq('account_id', accountId)
      .eq('pipeline_id', escolhido.id),
  ])
  if (stagesRes.error) throw stagesRes.error
  if (dealsRes.error) throw dealsRes.error

  const stages = (stagesRes.data ?? []) as {
    id: string
    name: string
    color: string
    position: number
  }[]
  const deals = (dealsRes.data ?? []) as {
    stage_id: string
    value: number | null
    status: string | null
  }[]

  const porEtapa = new Map<string, { count: number; total: number }>()
  for (const d of deals) {
    const row = porEtapa.get(d.stage_id) ?? { count: 0, total: 0 }
    row.count += 1
    row.total += d.value ?? 0
    porEtapa.set(d.stage_id, row)
  }

  // "Alcançaram" acumula de trás para frente: quem está na etapa 3 já
  // passou pela 1 e pela 2. É essa soma corrida que transforma uma
  // distribuição num funil.
  const naEtapa = stages.map((s) => porEtapa.get(s.id)?.count ?? 0)
  const alcancaram: number[] = new Array(stages.length).fill(0)
  let acumulado = 0
  for (let i = stages.length - 1; i >= 0; i--) {
    acumulado += naEtapa[i]
    alcancaram[i] = acumulado
  }

  const funnelStages: FunnelStage[] = stages.map((s, i) => ({
    id: s.id,
    name: s.name,
    color: s.color || '#64748b',
    naEtapa: naEtapa[i],
    valorNaEtapa: porEtapa.get(s.id)?.total ?? 0,
    alcancaram: alcancaram[i],
    // Etapa anterior zerada não vira 0% nem 100%: não houve ninguém
    // para converter, e inventar um número aqui é o tipo de zero que
    // depois vira decisão errada.
    taxaDaAnterior:
      i === 0 || alcancaram[i - 1] === 0 ? null : alcancaram[i] / alcancaram[i - 1],
  }))

  const entraram = alcancaram[0] ?? 0
  const chegaramAoFim = alcancaram[alcancaram.length - 1] ?? 0

  return {
    pipelineId: escolhido.id,
    pipelineName: escolhido.name,
    funisDisponiveis: funis,
    stages: funnelStages,
    totalEntraram: entraram,
    taxaGeral: entraram === 0 ? null : chegaramAoFim / entraram,
    valorTotal: deals.reduce((sum, d) => sum + (d.value ?? 0), 0),
  }
}

// --- 3c. Origem dos leads ----------------------------------------------

/**
 * Classifica UM contato. Ordem importa: um lead que veio de anúncio E
 * depois clicou num link rastreável é do anúncio — a primeira origem é
 * a que trouxe a pessoa.
 */
export function classificarOrigem(c: {
  ctwa_clid: string | null
  ad_source_id: string | null
  source_link_id: string | null
}): LeadSource {
  if (c.ctwa_clid || c.ad_source_id) return 'meta'
  if (c.source_link_id) return 'link'
  return 'organico'
}

/**
 * Novos leads por dia, separados por origem.
 *
 * PRÉ-REQUISITO DE DEPLOY: lê `contacts.source_link_id`, coluna que a
 * migration dos links rastreáveis (051) cria. Em produção essa migration
 * ainda não rodou — lá esta query falha com "column does not exist" até
 * ela ser aplicada.
 */
export async function loadLeadSources(
  db: DB,
  accountId: string,
  rangeDays: number,
): Promise<LeadSourcesData> {
  const start = daysAgoStart(rangeDays - 1).toISOString()

  const { data, error } = await db
    .from('contacts')
    .select('created_at, ctwa_clid, ad_source_id, source_link_id')
    .eq('account_id', accountId)
    // Grupo de WhatsApp não é lead — mesma exclusão do resto do painel.
    .eq('is_group', false)
    .gte('created_at', start)
    .order('created_at', { ascending: true })
  if (error) throw error

  const rows = (data ?? []) as {
    created_at: string
    ctwa_clid: string | null
    ad_source_id: string | null
    source_link_id: string | null
  }[]

  const keys = lastNDayKeys(rangeDays)
  const buckets = new Map<string, LeadSourcePoint>()
  for (const day of keys) buckets.set(day, { day, meta: 0, link: 0, organico: 0 })

  const totals: Record<LeadSource, number> = { meta: 0, link: 0, organico: 0 }

  for (const row of rows) {
    const origem = classificarOrigem(row)
    totals[origem] += 1
    // Contato criado fora da janela local (bordas de fuso) não tem
    // balde; ignorar é melhor do que empilhar no dia errado.
    const bucket = buckets.get(localDayKey(row.created_at))
    if (bucket) bucket[origem] += 1
  }

  const total = totals.meta + totals.link + totals.organico

  return {
    series: keys.map((day) => buckets.get(day)!),
    totals,
    total,
    // "Orgânico" aqui é o balde do que sobrou, então ele é exatamente a
    // medida do que NÃO conseguimos atribuir.
    fracaoSemOrigem: total === 0 ? 0 : totals.organico / total,
  }
}

// --- 3d. Top origens ---------------------------------------------------

/** Só o que a classificação precisa de um contato. */
export interface ContatoOrigem {
  ad_referral: Record<string, unknown> | null
  ad_source_id: string | null
  source_link_id: string | null
  source_utm: Record<string, unknown> | null
}

/** Texto não-vazio, ou null. Evita `""` virar nome de campanha. */
function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/**
 * Agrupa contatos por origem e ordena por volume.
 *
 * A precedência do NOME é o que separa um ranking útil de uma lista de
 * códigos. Em ordem:
 *
 *   1. nome do link rastreável — foi o usuário que escolheu, ganha de todos
 *   2. utm_campaign — nome real da campanha, veio na URL
 *   3. headline do anúncio — o título que o lead viu na Meta
 *   4. "Anúncio <id>" — último recurso; um id cru não diz nada a ninguém,
 *      mas ainda é melhor do que jogar o lead num balde "outros"
 *
 * Separada da consulta para ser testável sem banco.
 */
export function agruparOrigens(
  contatos: ContatoOrigem[],
  nomesDeLink: Map<string, string>,
  limite = 8,
): TopOrigensData {
  const grupos = new Map<string, { nome: string; tipo: OrigemRanking['tipo']; leads: number }>()
  let semOrigem = 0

  for (const c of contatos) {
    const campanha = texto(c.source_utm?.['utm_campaign'])
    const headline = texto(c.ad_referral?.['headline'])
    const adId = texto(c.ad_source_id)
    const ctwa = texto((c.ad_referral as Record<string, unknown>)?.['ctwa_clid'])

    let chave: string
    let nome: string
    let tipo: OrigemRanking['tipo']

    if (c.source_link_id) {
      chave = `link:${c.source_link_id}`
      // Link apagado depois de gerar leads: o id some do mapa, mas os
      // contatos continuam existindo. Cai para a campanha, e só então
      // para um rótulo genérico.
      nome = nomesDeLink.get(c.source_link_id) ?? campanha ?? 'Link removido'
      tipo = 'link'
    } else if (adId || headline || ctwa) {
      // Agrupa por anúncio quando há id; sem id, todos os leads de
      // anúncio caem juntos — melhor que criar um grupo por lead.
      chave = adId ? `ad:${adId}` : 'ad:sem-id'
      nome = headline ?? (adId ? `Anúncio ${adId}` : 'Anúncio da Meta')
      tipo = 'anuncio'
    } else if (campanha) {
      chave = `utm:${campanha.toLowerCase()}`
      nome = campanha
      tipo = 'campanha'
    } else {
      semOrigem += 1
      continue
    }

    const g = grupos.get(chave) ?? { nome, tipo, leads: 0 }
    g.leads += 1
    grupos.set(chave, g)
  }

  const totalAtribuido = [...grupos.values()].reduce((s, g) => s + g.leads, 0)

  const origens: OrigemRanking[] = [...grupos.entries()]
    .map(([id, g]) => ({
      id,
      nome: g.nome,
      tipo: g.tipo,
      leads: g.leads,
      fracao: totalAtribuido === 0 ? 0 : g.leads / totalAtribuido,
    }))
    // Empate desempata pelo nome para a ordem não dançar entre cargas.
    .sort((a, b) => b.leads - a.leads || a.nome.localeCompare(b.nome, 'pt-BR'))
    .slice(0, limite)

  return { origens, totalAtribuido, semOrigem }
}

/**
 * Ranking de origens dos leads no período.
 *
 * PRÉ-REQUISITO: `contacts.source_link_id` / `source_utm` (migration 051).
 */
export async function loadTopOrigens(
  db: DB,
  accountId: string,
  rangeDays: number,
  limite = 8,
): Promise<TopOrigensData> {
  const start = daysAgoStart(rangeDays - 1).toISOString()

  // Duas consultas em vez de um join embutido: `tracking_links` tem
  // dezenas de linhas, não milhares, e o embed obrigaria o PostgREST a
  // resolver a relação pelo cache de schema — que falha com PGRST200
  // logo depois de uma migration (ver o comentário em auth/account.ts).
  const [contatosRes, linksRes] = await Promise.all([
    db
      .from('contacts')
      .select('ad_referral, ad_source_id, source_link_id, source_utm')
      .eq('account_id', accountId)
      .eq('is_group', false)
      .gte('created_at', start),
    db.from('tracking_links').select('id, name').eq('account_id', accountId),
  ])
  if (contatosRes.error) throw contatosRes.error
  if (linksRes.error) throw linksRes.error

  const nomes = new Map<string, string>()
  for (const l of (linksRes.data ?? []) as { id: string; name: string | null }[]) {
    if (l.name?.trim()) nomes.set(l.id, l.name.trim())
  }

  return agruparOrigens(
    (contatosRes.data ?? []) as unknown as ContatoOrigem[],
    nomes,
    limite,
  )
}

// --- 4. Response time by day of week ----------------------------------

export async function loadResponseTime(db: DB): Promise<ResponseTimeSummary> {
  // Pull the last 14 days of messages in one shot, then walk per
  // conversation to find each "first inbound" → "first subsequent
  // outbound" pair. 14 days gives us both "this week" + "last week"
  // with enough overlap if the user opens the dashboard late on a
  // Monday.
  const fourteenDaysAgo = daysAgoStart(13).toISOString()
  const { data, error } = await db
    .from('messages')
    .select('conversation_id, sender_type, created_at')
    .gte('created_at', fourteenDaysAgo)
    .order('conversation_id', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error

  const rows = (data ?? []) as {
    conversation_id: string
    sender_type: string
    created_at: string
  }[]

  // Group per conversation, pair unreplied customer messages with the
  // next outbound message from the agent/bot. A single customer message
  // can only count once (avoids inflating averages if the customer
  // double-messages while the agent takes time to reply).
  interface Sample {
    customerAt: Date
    responseAt: Date
  }
  const samples: Sample[] = []

  let currentConv = ''
  let pendingCustomer: Date | null = null
  for (const row of rows) {
    if (row.conversation_id !== currentConv) {
      currentConv = row.conversation_id
      pendingCustomer = null
    }
    const ts = new Date(row.created_at)
    if (row.sender_type === 'customer') {
      if (!pendingCustomer) pendingCustomer = ts
    } else if (pendingCustomer) {
      samples.push({ customerAt: pendingCustomer, responseAt: ts })
      pendingCustomer = null
    }
  }

  const now = new Date()
  const thisWeekStart = daysAgoStart(mondayIndex(now))
  const lastWeekStart = daysAgoStart(mondayIndex(now) + 7)

  // Per-day-of-week buckets, averaged over both weeks' worth of data
  // so each bar has more samples to stand on. If a day has no samples
  // its avgMinutes stays null and the chart renders the bar muted.
  const byDow = new Map<number, number[]>()
  for (let i = 0; i < 7; i++) byDow.set(i, [])
  const thisWeekMins: number[] = []
  const lastWeekMins: number[] = []

  for (const s of samples) {
    const diffMin = (s.responseAt.getTime() - s.customerAt.getTime()) / 60_000
    if (diffMin < 0) continue
    const dow = mondayIndex(s.customerAt)
    byDow.get(dow)!.push(diffMin)
    if (s.customerAt >= thisWeekStart) {
      thisWeekMins.push(diffMin)
    } else if (s.customerAt >= lastWeekStart && s.customerAt < thisWeekStart) {
      lastWeekMins.push(diffMin)
    }
  }

  const avg = (arr: number[]) =>
    arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length

  const buckets: ResponseTimeBucket[] = Array.from({ length: 7 }, (_, dow) => {
    const samples = byDow.get(dow) ?? []
    return {
      dow,
      avgMinutes: avg(samples),
      samples: samples.length,
    }
  })

  // Silence unused-label warnings — keep the arrays explicitly named
  // for readability above.
  void DOW_SHORT_MON_FIRST

  return {
    buckets,
    thisWeekAvg: avg(thisWeekMins),
    lastWeekAvg: avg(lastWeekMins),
  }
}

// --- 5. Activity feed --------------------------------------------------

export async function loadActivity(db: DB, limit = 20): Promise<ActivityItem[]> {
  // Pull ~10 from each source (plenty of headroom after merge-sort),
  // then interleave by timestamp. The individual per-table limits
  // keep the payload small; the final limit is enforced after sort.
  const [msgs, contacts, deals, broadcasts, autoLogs] = await Promise.all([
    db
      .from('messages')
      .select('id, content_text, sender_type, created_at, conversation_id, conversations(contact_id, contacts(name, phone))')
      .eq('sender_type', 'customer')
      .order('created_at', { ascending: false })
      .limit(10),
    db
      .from('contacts')
      .select('id, name, phone, created_at')
      .eq('is_group', false)
      .order('created_at', { ascending: false })
      .limit(10),
    db
      .from('deals')
      .select('id, title, updated_at, stage:pipeline_stages(name)')
      .order('updated_at', { ascending: false })
      .limit(10),
    db
      .from('broadcasts')
      .select('id, name, status, total_recipients, created_at')
      .order('created_at', { ascending: false })
      .limit(5),
    db
      .from('automation_logs')
      .select('id, trigger_event, status, created_at, automation:automations(name), contact:contacts(name, phone)')
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  const items: ActivityItem[] = []

  // PostgREST returns nested selections as arrays by default, even when
  // the foreign key is 1:1. We normalise by taking [0] on each level.
  for (const m of (msgs.data ?? []) as unknown as Array<{
    id: string
    content_text: string | null
    created_at: string
    conversation_id: string
    conversations:
      | { contact_id: string | null; contacts: { name: string | null; phone: string }[] | { name: string | null; phone: string } | null }[]
      | { contact_id: string | null; contacts: { name: string | null; phone: string }[] | { name: string | null; phone: string } | null }
      | null
  }>) {
    const conv = Array.isArray(m.conversations) ? m.conversations[0] : m.conversations
    const contact = Array.isArray(conv?.contacts) ? conv?.contacts[0] : conv?.contacts
    const who = contact?.name || contact?.phone || 'Desconhecido'
    items.push({
      id: `msg-${m.id}`,
      kind: 'message',
      text: `Nova mensagem de ${who}`,
      at: m.created_at,
      href: `/inbox?c=${m.conversation_id}`,
    })
  }

  for (const c of (contacts.data ?? []) as Array<{ id: string; name: string | null; phone: string; created_at: string }>) {
    items.push({
      id: `contact-${c.id}`,
      kind: 'contact',
      text: `Novo contato: ${c.name || c.phone}`,
      at: c.created_at,
      href: '/contacts',
    })
  }

  for (const d of (deals.data ?? []) as unknown as Array<{
    id: string
    title: string
    updated_at: string
    stage: { name: string }[] | { name: string } | null
  }>) {
    const stage = Array.isArray(d.stage) ? d.stage[0] : d.stage
    items.push({
      id: `deal-${d.id}`,
      kind: 'deal',
      text: stage?.name
        ? `Negócio "${d.title}" em ${stage.name}`
        : `Negócio "${d.title}" atualizado`,
      at: d.updated_at,
      href: '/pipelines',
    })
  }

  for (const b of (broadcasts.data ?? []) as Array<{
    id: string
    name: string
    status: string
    total_recipients: number
    created_at: string
  }>) {
    const label =
      b.status === 'sent'
        ? `sent to ${b.total_recipients} contacts`
        : `${b.status} (${b.total_recipients} recipients)`
    items.push({
      id: `broadcast-${b.id}`,
      kind: 'broadcast',
      text: `Broadcast "${b.name}" ${label}`,
      at: b.created_at,
      href: '/broadcasts',
    })
  }

  for (const l of (autoLogs.data ?? []) as unknown as Array<{
    id: string
    trigger_event: string
    status: string
    created_at: string
    automation: { name: string }[] | { name: string } | null
    contact: { name: string | null; phone: string }[] | { name: string | null; phone: string } | null
  }>) {
    const automation = Array.isArray(l.automation) ? l.automation[0] : l.automation
    const contact = Array.isArray(l.contact) ? l.contact[0] : l.contact
    const who = contact?.name || contact?.phone || 'a contact'
    const autoName = automation?.name || 'Automation'
    items.push({
      id: `auto-${l.id}`,
      kind: 'automation',
      text: `Automation "${autoName}" ${l.status === 'failed' ? 'failed for' : 'triggered for'} ${who}`,
      at: l.created_at,
    })
  }

  return items
    .sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0))
    .slice(0, limit)
}
