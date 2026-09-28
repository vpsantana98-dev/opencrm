"use client"

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { formatCurrency } from '@/lib/currency'
import {
  MessageSquare,
  UserPlus,
  DollarSign,
  Send,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

import {
  loadActivity,
  loadConversationsSeries,
  loadLeadSources,
  loadMetrics,
  loadPipelineFunnel,
  loadResponseTime,
  loadTopOrigens,
} from '@/lib/dashboard/queries'
import type {
  ActivityItem,
  ConversationsSeriesPoint,
  LeadSourcesData,
  MetricsBundle,
  PipelineFunnelData,
  ResponseTimeSummary,
  TopOrigensData,
} from '@/lib/dashboard/types'

import { MetricCard } from '@/components/dashboard/metric-card'
import { SkeletonCard } from '@/components/dashboard/skeleton'
import { QuickActions } from '@/components/dashboard/quick-actions'
import { ConversationsChart } from '@/components/dashboard/conversations-chart'
import { PipelineFunnel } from '@/components/dashboard/pipeline-funnel'
import { LeadSourcesChart } from '@/components/dashboard/lead-sources-chart'
import { TopOrigens } from '@/components/dashboard/top-origens'
import { PendenciasStrip } from '@/components/dashboard/pendencias-strip'
import { ResponseTimeChart } from '@/components/dashboard/response-time-chart'
import { ActivityFeed } from '@/components/dashboard/activity-feed'
import { WorkspaceSwitcher } from '@/components/layout/workspace-switcher'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

type RangeDays = 7 | 30 | 90

export default function DashboardPage() {
  const { defaultCurrency, isClientLogin, accountId, account } = useAuth()
  const [metrics, setMetrics] = useState<MetricsBundle | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(true)

  // PERIODO GLOBAL. Comanda metricas de fluxo, serie de conversas e
  // origens. Os estoques (conversas abertas, valor em aberto) ignoram
  // este valor de proposito — ver o comentario em MetricsBundle.
  const [range, setRange] = useState<RangeDays>(30)
  const [series, setSeries] = useState<ConversationsSeriesPoint[] | null>(null)
  const [seriesLoading, setSeriesLoading] = useState(true)

  const [funnel, setFunnel] = useState<PipelineFunnelData | null>(null)
  const [funnelLoading, setFunnelLoading] = useState(true)
  // Funil escolhido no seletor. `undefined` = "o primeiro", que é o que
  // a query faz quando não recebe id.
  const [pipelineId, setPipelineId] = useState<string | undefined>(undefined)

  const [sources, setSources] = useState<LeadSourcesData | null>(null)
  const [sourcesLoading, setSourcesLoading] = useState(true)
  const [topOrigens, setTopOrigens] = useState<TopOrigensData | null>(null)

  const [responseTime, setResponseTime] = useState<ResponseTimeSummary | null>(null)
  const [responseTimeLoading, setResponseTimeLoading] = useState(true)

  const [activity, setActivity] = useState<ActivityItem[] | null>(null)
  const [activityLoading, setActivityLoading] = useState(true)

  // Se qualquer bloco falhar, sinaliza pra mostrar um aviso com "tentar de
  // novo" em vez de deixar skeletons eternos sem explicação.
  const [loadError, setLoadError] = useState(false)

  const loadAll = useCallback(() => {
    const db = createClient()

    // Kick everything off in parallel. Each block has its own
    // setState + finally so a slow query doesn't hold up faster
    // sections — each widget shows its own skeleton independently.
    void loadResponseTime(db)
      .then((r) => setResponseTime(r))
      .catch((err) => { console.error('[dashboard] response time failed:', err); setLoadError(true) })
      .finally(() => setResponseTimeLoading(false))

    // Fetch up to 50 so the biggest page-size option in the feed
    // (50 rows) is already in memory — switching sizes then becomes
    // a pure client-side slice with no extra round trip.
    void loadActivity(db, 50)
      .then((a) => setActivity(a))
      .catch((err) => { console.error('[dashboard] activity failed:', err); setLoadError(true) })
      .finally(() => setActivityLoading(false))
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // O funil carrega SEPARADO do resto porque ele tem uma dependência
  // que os outros não têm: o funil escolhido no seletor. Se estivesse
  // junto do `loadAll`, trocar de funil recarregaria métricas, série,
  // tempo de resposta e atividade — a página inteira piscaria para
  // atualizar um cartão.
  //
  // O `accountId` explícito também é necessário: a RLS de
  // `pipeline_stages` usa `is_account_member`, que libera QUALQUER
  // conta do usuário. Sem o filtro, quem atende dois clientes veria as
  // etapas dos dois embaralhadas num funil só.
  // Todo `setState` daqui vive DENTRO de uma continuação de promessa,
  // nunca no corpo síncrono. É o mesmo formato do `loadAll` acima, e
  // pelo mesmo motivo: este callback é chamado de um efeito, e escrever
  // estado ali de forma síncrona dispara render em cascata
  // (`react-hooks/set-state-in-effect`, que o lint trata como erro).
  // O `Promise.resolve()` na frente é o que empurra o "ligar esqueleto"
  // para fora do corpo síncrono sem mudar o comportamento: ele continua
  // aparecendo a cada troca de funil ou de conta, um microtask depois.
  const carregarFunil = useCallback(() => {
    if (!accountId) {
      void Promise.resolve().then(() => setFunnelLoading(false))
      return
    }
    void Promise.resolve()
      .then(() => setFunnelLoading(true))
      .then(() => loadPipelineFunnel(createClient(), accountId, pipelineId))
      .then((f) => setFunnel(f))
      .catch((err) => { console.error('[dashboard] funil failed:', err); setLoadError(true) })
      .finally(() => setFunnelLoading(false))
  }, [accountId, pipelineId])

  useEffect(() => {
    carregarFunil()
  }, [carregarFunil])

  // Metricas e serie de conversas seguem o periodo GLOBAL. Ficam juntas
  // porque leem a mesma janela: separadas, uma poderia atualizar antes
  // da outra e a tela mostraria dois recortes ao mesmo tempo.
  const carregarPeriodo = useCallback(() => {
    if (!accountId) {
      void Promise.resolve().then(() => { setMetricsLoading(false); setSeriesLoading(false) })
      return
    }
    void Promise.resolve()
      .then(() => { setMetricsLoading(true); setSeriesLoading(true) })
      .then(() => {
        const db = createClient()
        return Promise.all([
          loadMetrics(db, accountId, range),
          loadConversationsSeries(db, range),
        ])
      })
      .then(([m, s]) => { setMetrics(m); setSeries(s) })
      .catch((err) => { console.error('[dashboard] periodo failed:', err); setLoadError(true) })
      .finally(() => { setMetricsLoading(false); setSeriesLoading(false) })
  }, [accountId, range])

  useEffect(() => {
    carregarPeriodo()
  }, [carregarPeriodo])

  // Mesma razão do funil para carregar em separado: tem período próprio.
  // Aqui não há cache por faixa (como o gráfico de conversas faz) porque
  // a janela também muda a classificação — vale a releitura.
  // Mesmo formato do `carregarFunil` acima, pelo mesmo motivo.
  const carregarOrigens = useCallback(() => {
    if (!accountId) {
      void Promise.resolve().then(() => setSourcesLoading(false))
      return
    }
    // A série e o ranking dividem o MESMO período, então carregam
    // juntos: dois cartões lado a lado mostrando janelas diferentes
    // seria o defeito que a letra (d) existe para resolver.
    void Promise.resolve()
      .then(() => setSourcesLoading(true))
      .then(() => {
        const db = createClient()
        return Promise.all([
          loadLeadSources(db, accountId, range),
          loadTopOrigens(db, accountId, range),
        ])
      })
      .then(([s, t]) => { setSources(s); setTopOrigens(t) })
      .catch((err) => { console.error('[dashboard] origens failed:', err); setLoadError(true) })
      .finally(() => setSourcesLoading(false))
  }, [accountId, range])

  useEffect(() => {
    carregarOrigens()
  }, [carregarOrigens])

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          {/* Diz DE QUEM são os números, não o que a tela faz.
              "Análises ao vivo de conversas, contatos, negócios…" era
              uma legenda que ninguém lê duas vezes: descreve a página,
              que a pessoa já está vendo. Numa agência que opera várias
              contas, a pergunta que importa aqui é outra — de qual
              cliente eu estou olhando o painel? Errar isso faz ligar
              para o cliente errado. */}
          <p className="mt-1 text-sm text-muted-foreground">
            {account?.name ? (
              <>
                Visão do cliente{" "}
                <strong className="font-medium text-foreground">
                  {account.name}
                </strong>
              </>
            ) : (
              "Análises ao vivo de conversas, contatos, negócios e disparos."
            )}
          </p>
        </div>
        {/* Seletor de cliente ativo — mesmo dropdown da sidebar, aqui bem
            visível pra trocar de cliente sem caçar no menu. */}
        <div className="flex flex-wrap items-end gap-4">
          {!isClientLogin ? (
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Cliente ativo
              </span>
              <WorkspaceSwitcher variant="inline" />
            </div>
          ) : null}
          {/* PERÍODO GLOBAL. Um só para a página inteira: antes cada
              gráfico tinha o seu, e dava para comparar sem perceber um
              recorte de 7 dias com outro de 90. Os cartões de estoque
              não obedecem a ele e dizem isso no próprio subtítulo. */}
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Período
            </span>
            <ToggleGroup
              variant="outline"
              size="sm"
              value={[String(range)]}
              onValueChange={(v) => {
                const escolhido = v[0]
                // Clicar no já ativo devolve lista vazia; um painel sem
                // período não existe, então mantém o atual.
                if (escolhido) setRange(Number(escolhido) as RangeDays)
              }}
              aria-label="Período do painel"
            >
              <ToggleGroupItem value="7">7 dias</ToggleGroupItem>
              <ToggleGroupItem value="30">30 dias</ToggleGroupItem>
              <ToggleGroupItem value="90">90 dias</ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
      </div>

      {/* Pendencias — a UNICA parte cross-cliente da pagina. Vem antes
          dos numeros de proposito: e chamado para acao, e chamado para
          acao vem antes de relatorio. Some sozinha quando nao ha nada,
          porque faixa permanente vira moldura e para de ser lida.
          Login de cliente nao ve: ele so tem a propria conta. */}
      {!isClientLogin ? <PendenciasStrip /> : null}

      {/* Aviso de falha de carga: dá feedback + recuperação em vez de
          deixar os widgets em skeleton sem explicação. */}
      {loadError && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-red-300">
            <AlertTriangle className="size-4 shrink-0" />
            Não foi possível carregar alguns dados do painel.
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setLoadError(false)
              loadAll()
            }}
          >
            <RotateCcw className="size-3.5" />
            Tentar de novo
          </Button>
        </div>
      )}

      {/* Metric cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metricsLoading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : !metrics ? (
          <div className="col-span-full rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
            Métricas indisponíveis no momento.
          </div>
        ) : (
          <>
            {/* ESTOQUE — nao muda com o seletor de periodo. O subtitulo
                diz isso, senao dois cartoes vizinhos com significados
                diferentes de tempo viram armadilha. */}
            <MetricCard
              title="Conversas Abertas"
              value={metrics.conversasAbertas.toLocaleString('pt-BR')}
              icon={MessageSquare}
              subtitle="Agora · não muda com o período"
            />
            {/* FLUXO — respeita o periodo, compara com a janela anterior
                de igual tamanho. */}
            <MetricCard
              title="Novos Contatos"
              value={metrics.contatosNovos.current.toLocaleString('pt-BR')}
              icon={UserPlus}
              delta={{
                sign: metrics.contatosNovos.current - metrics.contatosNovos.previous,
                label: deltaLabel(
                  metrics.contatosNovos.current - metrics.contatosNovos.previous,
                  `vs ${range} dias anteriores`,
                ),
              }}
              subtitle="No período · grupos não contam"
            />
            <MetricCard
              title="Valor em Aberto"
              value={formatCurrency(metrics.valorNegociosAbertos, defaultCurrency)}
              icon={DollarSign}
              subtitle={`${metrics.negociosAbertos} negócio${metrics.negociosAbertos === 1 ? '' : 's'} · acumulado, não muda com o período`}
            />
            <MetricCard
              title="Mensagens Enviadas"
              value={metrics.mensagensEnviadas.current.toLocaleString('pt-BR')}
              icon={Send}
              delta={{
                sign: metrics.mensagensEnviadas.current - metrics.mensagensEnviadas.previous,
                label: deltaLabel(
                  metrics.mensagensEnviadas.current - metrics.mensagensEnviadas.previous,
                  `vs ${range} dias anteriores`,
                ),
              }}
              // A query filtra sender_type='agent', que exclui o bot.
              subtitle="No período · pela equipe"
            />          </>
        )}
      </div>

      {/* Quick actions */}
      <QuickActions />

      {/* Charts row */}
      {/* items-stretch (the grid default) stretches the two columns to
          match the tallest sibling; adding h-full on each wrapper and
          on the inner panels makes both cards actually fill that
          stretched height so their rounded borders line up. Without
          this, the pipeline card rendered at its natural (shorter)
          height while the line chart drove the row height. */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="h-full xl:col-span-7">
          <ConversationsChart
            series={series}
            loading={seriesLoading}
            rangeDays={range}
          />
        </div>
        <div className="h-full xl:col-span-5">
          <PipelineFunnel
            data={funnel}
            loading={funnelLoading}
            currency={defaultCurrency}
            onPipelineChange={setPipelineId}
          />
        </div>
      </div>

      {/* Origem dos leads — de onde vem o movimento. Fica logo abaixo
          dos gráficos de volume porque responde a pergunta seguinte:
          "chegou gente; de onde?". */}
      {/* Os dois respondem "de onde vem meu movimento": a série mostra o
          COMPORTAMENTO no tempo, o ranking mostra QUAIS origens. Lado a
          lado e compartilhando o mesmo período — separados, seria fácil
          ler um com a janela do outro. */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="h-full xl:col-span-7">
          <LeadSourcesChart
            data={sources}
            loading={sourcesLoading}
            range={range}
          />
        </div>
        <div className="h-full xl:col-span-5">
          <TopOrigens
            data={topOrigens}
            loading={sourcesLoading}
            rangeDays={range}
          />
        </div>
      </div>

      {/* Response time */}
      <ResponseTimeChart data={responseTime} loading={responseTimeLoading} />

      {/* Activity feed */}
      <ActivityFeed items={activity} loading={activityLoading} />
    </div>
  )
}

// ------------------------------------------------------------

function deltaLabel(delta: number, suffix: string): string {
  if (delta === 0) return `Sem mudança ${suffix}`
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toLocaleString()} ${suffix}`
}
