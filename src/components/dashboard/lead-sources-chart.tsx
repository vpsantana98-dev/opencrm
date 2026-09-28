'use client';

import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { UserPlus } from 'lucide-react';

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import type { LeadSourcesData } from '@/lib/dashboard/types';

interface LeadSourcesChartProps {
  data: LeadSourcesData | null;
  loading: boolean;
  /** Só para o texto do cabeçalho; o recorte vem pronto na `data`. */
  range: number;
}

// As chaves batem com os campos de LeadSourcePoint — o Recharts usa o
// `dataKey` para achar a cor e o rótulo aqui dentro.
const CHART_CONFIG = {
  meta: { label: 'Meta Ads', color: 'var(--chart-1)' },
  link: { label: 'Link Rastreável', color: 'var(--chart-2)' },
  organico: { label: 'Sem origem', color: 'var(--chart-3)' },
} satisfies ChartConfig;

/**
 * "2026-05-20" → "20/05", sem passar por Date (evita susto de fuso).
 *
 * Aceita `unknown` porque o Recharts tipa o rótulo como ReactNode nos
 * formatadores. Valor fora do formato volta como veio, em vez de virar
 * "undefined/undefined" no eixo.
 */
function rotuloDia(iso: unknown): string {
  if (typeof iso !== 'string') return String(iso ?? '');
  const partes = iso.split('-');
  if (partes.length !== 3) return iso;
  return `${partes[2]}/${partes[1]}`;
}

/**
 * Novos leads por dia, empilhados por origem.
 *
 * Responde "de onde vem meu movimento", que nenhuma outra tela do CRM
 * responde. O terceiro balde chama-se "Sem origem" e não "Orgânico" de
 * propósito: ele é o que sobrou depois de checar anúncio e link, e com
 * a Evolution — que não captura a referência do anúncio — a maior parte
 * cai ali por FALTA de captura, não por ser tráfego espontâneo.
 * Chamá-lo de orgânico transformaria uma ausência de dado numa
 * afirmação sobre o negócio.
 */
export function LeadSourcesChart({
  data,
  loading,
  range,
}: LeadSourcesChartProps) {
  const semOrigemPct = useMemo(
    () => Math.round((data?.fracaoSemOrigem ?? 0) * 100),
    [data]
  );

  return (
    <Card className="h-full gap-0">
      <CardHeader className="border-b pb-3">
        <CardTitle>Origem dos leads</CardTitle>
        <CardDescription>
          {data
            ? `${data.total.toLocaleString('pt-BR')} lead${data.total === 1 ? '' : 's'} nos últimos ${range} dias`
            : 'Novos contatos por dia'}
        </CardDescription>
        {data && data.total > 0 ? (
          <CardAction className="hidden gap-4 sm:flex">
            <div className="text-right">
              <p className="text-muted-foreground text-[10px] uppercase">
                Atribuídos
              </p>
              <p className="text-foreground font-medium tabular-nums">
                {(data.total - data.totals.organico).toLocaleString('pt-BR')}
              </p>
            </div>
            <div className="text-right">
              <p className="text-muted-foreground text-[10px] uppercase">
                Sem origem
              </p>
              <p className="text-foreground font-medium tabular-nums">
                {data.totals.organico.toLocaleString('pt-BR')}
              </p>
            </div>
          </CardAction>
        ) : null}
      </CardHeader>

      <CardContent className="flex min-h-[18rem] flex-1 flex-col pt-4">
        {loading ? (
          <Skeleton className="h-56 w-full" />
        ) : !data || data.total === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UserPlus />
              </EmptyMedia>
              <EmptyTitle>Nenhum lead novo no período</EmptyTitle>
              <EmptyDescription>
                Contatos criados nos últimos {range} dias aparecem aqui,
                separados por origem.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <ChartContainer
              config={CHART_CONFIG}
              className="h-48 min-h-0 w-full min-w-0"
            >
              <BarChart data={data.series} accessibilityLayer>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="day"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={rotuloDia}
                  // Em 90 dias os rótulos se sobrepõem; o Recharts
                  // decide sozinho quantos mostrar com interval.
                  interval="preserveStartEnd"
                  minTickGap={24}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={28}
                  // Lead é contagem: meio lead não existe, e um eixo com
                  // "0,5" faria o gráfico parecer preciso onde não é.
                  allowDecimals={false}
                />
                <ChartTooltip
                  content={<ChartTooltipContent labelFormatter={rotuloDia} />}
                />
                <ChartLegend content={<ChartLegendContent />} />
                {/* stackId igual = barras empilhadas. A ordem aqui é a
                    ordem de baixo para cima na pilha. */}
                <Bar dataKey="meta" stackId="origem" fill="var(--color-meta)" />
                <Bar dataKey="link" stackId="origem" fill="var(--color-link)" />
                <Bar
                  dataKey="organico"
                  stackId="origem"
                  fill="var(--color-organico)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ChartContainer>

            {/* Cobertura da atribuição. É o número acionável desta tela:
                não diz quanto veio do orgânico, diz quanto NÃO sabemos. */}
            {semOrigemPct > 0 && (
              <p className="bg-muted/40 text-muted-foreground mt-3 rounded-lg px-3 py-2.5 text-xs leading-relaxed">
                <strong className="text-foreground tabular-nums">
                  {semOrigemPct}%
                </strong>{' '}
                dos leads chegaram sem origem identificada. Ligar o número
                oficial da Meta ou usar links rastreáveis aumenta essa
                cobertura.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
