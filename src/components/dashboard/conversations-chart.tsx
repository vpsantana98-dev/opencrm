'use client';

import { useMemo } from 'react';
import { Line, LineChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { MessageSquare } from 'lucide-react';

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
import type { ConversationsSeriesPoint } from '@/lib/dashboard/types';
import { EmptyState } from './empty-state';
import { Skeleton } from './skeleton';

interface ConversationsChartProps {
  series: ConversationsSeriesPoint[] | null;
  loading: boolean;
  rangeDays: number;
}

const CHART_CONFIG = {
  incoming: { label: 'Recebidas', color: 'var(--chart-3)' },
  outgoing: { label: 'Enviadas', color: 'var(--primary)' },
} satisfies ChartConfig;

export function ConversationsChart({
  series,
  loading,
  rangeDays,
}: ConversationsChartProps) {
  const totals = useMemo(
    () =>
      (series ?? []).reduce(
        (acc, point) => ({
          incoming: acc.incoming + point.incoming,
          outgoing: acc.outgoing + point.outgoing,
        }),
        { incoming: 0, outgoing: 0 }
      ),
    [series]
  );

  const isEmpty =
    !series ||
    series.every((point) => point.incoming === 0 && point.outgoing === 0);

  return (
    <Card className="h-full gap-0">
      <CardHeader className="border-b pb-3">
        <CardTitle>Conversas ao longo do tempo</CardTitle>
        <CardDescription>
          Volume diário de mensagens · últimos {rangeDays} dias
        </CardDescription>
        {!loading && series ? (
          <CardAction className="hidden items-center gap-4 sm:flex">
            <SummaryValue
              color="var(--chart-3)"
              label="Recebidas"
              value={totals.incoming}
            />
            <SummaryValue
              color="var(--primary)"
              label="Enviadas"
              value={totals.outgoing}
            />
          </CardAction>
        ) : null}
      </CardHeader>

      <CardContent className="flex min-h-[18rem] flex-1 flex-col pt-4">
        {loading || !series ? (
          <Skeleton className="h-56 w-full" />
        ) : isEmpty ? (
          <EmptyState
            icon={MessageSquare}
            title="Nenhuma atividade de mensagens neste período"
            hint="Envie ou receba mensagens para começar a preencher este gráfico."
          />
        ) : (
          <ChartContainer
            config={CHART_CONFIG}
            className="h-56 min-h-0 w-full min-w-0"
          >
            <LineChart
              data={series}
              accessibilityLayer
              margin={{ left: 0, right: 8 }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="day"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={shortDayLabel}
                interval="preserveStartEnd"
                minTickGap={28}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={28}
                allowDecimals={false}
              />
              <ChartTooltip
                cursor={{ stroke: 'var(--border)', strokeDasharray: '3 3' }}
                content={<ChartTooltipContent labelFormatter={longDayLabel} />}
              />
              <Line
                type="monotone"
                dataKey="incoming"
                stroke="var(--color-incoming)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="outgoing"
                stroke="var(--color-outgoing)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ChartContainer>
        )}

        {!loading && series ? (
          <div className="border-border text-muted-foreground mt-auto flex items-center gap-4 border-t pt-3 text-xs sm:hidden">
            <LegendDot color="var(--chart-3)" label="Recebidas" />
            <LegendDot color="var(--primary)" label="Enviadas" />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SummaryValue({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: number;
}) {
  return (
    <div className="text-right">
      <p className="text-muted-foreground flex items-center justify-end gap-1.5 text-[10px] uppercase">
        <span
          className="size-1.5 rounded-full"
          style={{ backgroundColor: color }}
        />
        {label}
      </p>
      <p className="text-foreground font-medium tabular-nums">
        {value.toLocaleString('pt-BR')}
      </p>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="size-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

function shortDayLabel(value: unknown): string {
  const date = parseDay(value);
  return date
    ? date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
    : String(value ?? '');
}

function longDayLabel(value: unknown): string {
  const date = parseDay(value);
  return date
    ? date.toLocaleDateString('pt-BR', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
      })
    : String(value ?? '');
}

function parseDay(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}
