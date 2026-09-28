'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts';
import { Clock } from 'lucide-react';

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
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { DOW_SHORT_MON_FIRST } from '@/lib/dashboard/date-utils';
import type { ResponseTimeSummary } from '@/lib/dashboard/types';
import { EmptyState } from './empty-state';
import { Skeleton } from './skeleton';

interface ResponseTimeChartProps {
  data: ResponseTimeSummary | null;
  loading: boolean;
  thresholdMinutes?: number;
}

const CHART_CONFIG = {
  avgMinutes: { label: 'Tempo médio', color: 'var(--primary)' },
} satisfies ChartConfig;

export function ResponseTimeChart({
  data,
  loading,
  thresholdMinutes = 5,
}: ResponseTimeChartProps) {
  const hasData =
    data?.buckets.some((bucket) => bucket.avgMinutes != null) ?? false;
  const chartData =
    data?.buckets.map((bucket, index) => ({
      day: DOW_SHORT_MON_FIRST[index],
      avgMinutes: bucket.avgMinutes ?? 0,
      samples: bucket.samples,
    })) ?? [];

  return (
    <Card className="gap-0">
      <CardHeader className="border-b pb-3">
        <CardTitle>Tempo médio de primeira resposta</CardTitle>
        <CardDescription className="text-foreground/65">
          Tempo até a primeira resposta ao cliente, por dia da semana
        </CardDescription>
        <CardAction className="flex items-center gap-4">
          {data && (data.thisWeekAvg != null || data.lastWeekAvg != null) ? (
            <div className="hidden text-right text-xs sm:block">
              <p className="text-foreground/65">
                Esta semana{' '}
                <strong className="text-foreground font-medium tabular-nums">
                  {formatDuration(data.thisWeekAvg)}
                </strong>
              </p>
              <p className="text-foreground/65">
                Anterior{' '}
                <span className="text-foreground tabular-nums">
                  {formatDuration(data.lastWeekAvg)}
                </span>
              </p>
            </div>
          ) : null}
          {thresholdMinutes > 0 ? (
            <span className="border-destructive/40 bg-destructive/10 text-destructive rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums">
              Meta {thresholdMinutes} min
            </span>
          ) : null}
        </CardAction>
      </CardHeader>

      <CardContent className="flex min-h-[18rem] flex-col pt-4">
        {loading || !data ? (
          <Skeleton className="h-56 w-full" />
        ) : !hasData ? (
          <EmptyState
            icon={Clock}
            title="Nenhuma resposta registrada ainda"
            hint="Este gráfico é preenchido conforme você responde às mensagens dos clientes."
          />
        ) : (
          <ChartContainer
            config={CHART_CONFIG}
            className="h-56 min-h-0 w-full min-w-0"
          >
            <BarChart data={chartData} accessibilityLayer>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="day"
                tickLine={false}
                axisLine={false}
                tickMargin={10}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={54}
                allowDecimals={false}
                domain={[
                  0,
                  (dataMax: number) =>
                    Math.ceil(Math.max(dataMax, thresholdMinutes) * 1.15),
                ]}
                tickFormatter={(value) => `${value} min`}
              />
              <ChartTooltip
                cursor={{ fill: 'var(--muted)', opacity: 0.45 }}
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, payload) =>
                      String(payload?.[0]?.payload?.day ?? '')
                    }
                    formatter={(value) => (
                      <div className="flex min-w-36 items-center justify-between gap-4">
                        <span className="text-muted-foreground">
                          Tempo médio
                        </span>
                        <span className="text-foreground font-mono font-medium tabular-nums">
                          {formatDuration(Number(value))}
                        </span>
                      </div>
                    )}
                  />
                }
              />
              {thresholdMinutes > 0 ? (
                <ReferenceLine
                  y={thresholdMinutes}
                  stroke="var(--destructive)"
                  strokeDasharray="4 4"
                  strokeOpacity={0.7}
                />
              ) : null}
              <Bar
                dataKey="avgMinutes"
                fill="var(--color-avgMinutes)"
                maxBarSize={72}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

function formatDuration(minutes: number | null): string {
  if (minutes == null) return '—';
  if (minutes < 1) return `${Math.max(1, Math.round(minutes * 60))}s`;
  if (minutes < 60) return `${minutes.toFixed(1).replace('.', ',')} min`;
  return `${(minutes / 60).toFixed(1).replace('.', ',')} h`;
}
