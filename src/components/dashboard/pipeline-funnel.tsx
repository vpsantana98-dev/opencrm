'use client';

import Link from 'next/link';
import { ArrowRight, ChevronDown, GitBranch } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { formatCurrencyShort } from '@/lib/currency';
import type { PipelineFunnelData } from '@/lib/dashboard/types';
import { cn } from '@/lib/utils';

interface PipelineFunnelProps {
  data: PipelineFunnelData | null;
  loading: boolean;
  currency: string;
  onPipelineChange?: (id: string) => void;
}

function percentual(fracao: number): string {
  const pct = fracao * 100;
  if (pct > 0 && pct < 0.1) return '< 0,1%';
  return `${pct.toFixed(1).replace('.', ',')}%`;
}

export function PipelineFunnel({
  data,
  loading,
  currency,
  onPipelineChange,
}: PipelineFunnelProps) {
  return (
    <Card className="h-full gap-0">
      <CardHeader className="border-b pb-3">
        <CardTitle>Funil de conversão</CardTitle>
        <CardDescription>
          {data
            ? `${data.totalEntraram.toLocaleString('pt-BR')} negócio${data.totalEntraram === 1 ? '' : 's'} no funil`
            : 'Negócios por etapa'}
        </CardDescription>
        {data && data.funisDisponiveis.length > 1 && onPipelineChange ? (
          <CardAction>
            <div className="relative">
              <select
                value={data.pipelineId}
                onChange={(event) => onPipelineChange(event.target.value)}
                aria-label="Escolher funil"
                className="border-border bg-card text-muted-foreground hover:text-foreground focus-visible:ring-ring appearance-none rounded-lg border py-1 pr-7 pl-2.5 text-xs focus-visible:ring-2 focus-visible:outline-none"
              >
                {data.funisDisponiveis.map((funnel) => (
                  <option key={funnel.id} value={funnel.id}>
                    {funnel.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="text-muted-foreground pointer-events-none absolute top-1/2 right-2 size-3 -translate-y-1/2"
                aria-hidden
              />
            </div>
          </CardAction>
        ) : null}
      </CardHeader>

      <CardContent className="flex min-h-[18rem] flex-1 flex-col pt-4">
        {loading ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        ) : !data || data.stages.length === 0 ? (
          <Empty className="min-h-64">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <GitBranch />
              </EmptyMedia>
              <EmptyTitle>Nenhuma etapa configurada</EmptyTitle>
              <EmptyDescription>
                Crie etapas para acompanhar a passagem dos negócios pelo funil.
              </EmptyDescription>
            </EmptyHeader>
            <PipelineLink label="Configurar funil" />
          </Empty>
        ) : data.totalEntraram === 0 ? (
          <div className="flex flex-1 flex-col">
            <Empty className="min-h-40 flex-none gap-3 px-3 py-5">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <GitBranch />
                </EmptyMedia>
                <EmptyTitle>Funil pronto, aguardando negócios</EmptyTitle>
                <EmptyDescription>
                  As etapas estão configuradas. Novos negócios vão preencher a
                  conversão automaticamente.
                </EmptyDescription>
              </EmptyHeader>
              <PipelineLink label="Abrir funil" />
            </Empty>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {data.stages.map((stage) => (
                <div
                  key={stage.id}
                  className="bg-muted/40 flex min-w-0 items-center gap-2 rounded-lg px-3 py-2"
                >
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: stage.color }}
                    aria-hidden
                  />
                  <span className="text-foreground min-w-0 flex-1 truncate text-xs font-medium">
                    {stage.name}
                  </span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    0
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <TooltipProvider delay={150}>
            <div className="flex flex-col gap-3">
              {data.stages.map((stage, index) => {
                const fraction = stage.alcancaram / data.totalEntraram;
                const width = Math.max(fraction, 0.025) * 100;

                return (
                  <div key={stage.id} className="space-y-1.5">
                    <div className="flex min-w-0 items-center gap-2 text-xs">
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: stage.color }}
                        aria-hidden
                      />
                      <span className="text-foreground min-w-0 flex-1 truncate font-medium">
                        {stage.name}
                      </span>
                      {index > 0 && stage.taxaDaAnterior !== null ? (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Badge
                                variant="outline"
                                className="cursor-help"
                              />
                            }
                          >
                            {percentual(stage.taxaDaAnterior)}
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            {stage.alcancaram.toLocaleString('pt-BR')} de{' '}
                            {data.stages[index - 1].alcancaram.toLocaleString(
                              'pt-BR'
                            )}{' '}
                            que chegaram em &ldquo;{data.stages[index - 1].name}
                            &rdquo; seguiram para &ldquo;{stage.name}&rdquo;.
                          </TooltipContent>
                        </Tooltip>
                      ) : null}
                      <span className="text-foreground w-8 shrink-0 text-right font-medium tabular-nums">
                        {stage.alcancaram.toLocaleString('pt-BR')}
                      </span>
                    </div>
                    <div className="bg-muted h-2 overflow-hidden rounded-full">
                      <div
                        className={cn(
                          'h-full rounded-full transition-[width]',
                          stage.alcancaram === 0 && 'opacity-50'
                        )}
                        style={{
                          width: `${width}%`,
                          backgroundColor: stage.color,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="border-border mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs">
              <span className="text-muted-foreground">
                Conversão ponta a ponta:{' '}
                <strong className="text-foreground tabular-nums">
                  {data.taxaGeral === null ? '—' : percentual(data.taxaGeral)}
                </strong>
              </span>
              <span className="text-muted-foreground">
                Valor total:{' '}
                <strong className="text-foreground tabular-nums">
                  {formatCurrencyShort(data.valorTotal, currency)}
                </strong>
              </span>
            </div>
          </TooltipProvider>
        )}
      </CardContent>
    </Card>
  );
}

function PipelineLink({ label }: { label: string }) {
  return (
    <Button
      size="sm"
      variant="outline"
      nativeButton={false}
      render={<Link href="/pipelines" />}
    >
      {label}
      <ArrowRight data-icon="inline-end" />
    </Button>
  );
}
