'use client';

import Link from 'next/link';
import { ArrowRight, Link2, Megaphone, Target } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
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
import type { OrigemRanking, TopOrigensData } from '@/lib/dashboard/types';

interface TopOrigensProps {
  data: TopOrigensData | null;
  loading: boolean;
  /** Só para o texto do cabeçalho; o recorte vem pronto na `data`. */
  rangeDays: number;
}

const TIPO_META: Record<
  OrigemRanking['tipo'],
  { icone: typeof Link2; rotulo: string }
> = {
  link: { icone: Link2, rotulo: 'Link' },
  anuncio: { icone: Megaphone, rotulo: 'Anúncio' },
  campanha: { icone: Target, rotulo: 'Campanha' },
};

/**
 * De onde vieram os leads, do maior para o menor.
 *
 * Chama-se "origens", e não "campanhas" como o painel de referência,
 * porque nome de campanha nós só temos quando o lead passou por um link
 * rastreável com `utm_campaign`. Vindo de anúncio, o que a Meta manda é
 * o *headline* — que identifica o ANÚNCIO, não a campanha. Chamar tudo
 * de campanha faria o gestor de tráfego procurar no Gerenciador um nome
 * que não existe lá.
 */
export function TopOrigens({ data, loading, rangeDays }: TopOrigensProps) {
  return (
    <Card className="h-full gap-0">
      <CardHeader className="border-b pb-3">
        <CardTitle>Top origens</CardTitle>
        <CardDescription>
          {data
            ? `${data.totalAtribuido.toLocaleString('pt-BR')} lead${data.totalAtribuido === 1 ? '' : 's'} com origem nos últimos ${rangeDays} dias`
            : 'De onde vieram os leads'}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex min-h-[18rem] flex-1 flex-col pt-4">
        {loading ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : !data || data.origens.length === 0 ? (
          <Empty className="min-h-64">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Target />
              </EmptyMedia>
              <EmptyTitle>Nenhuma origem identificada</EmptyTitle>
              <EmptyDescription>
                {data && data.semOrigem > 0
                  ? `Chegaram ${data.semOrigem.toLocaleString('pt-BR')} leads no período, mas nenhum trouxe marcador de origem. Links rastreáveis e o número oficial da Meta preenchem esse dado.`
                  : 'Leads que chegarem por link rastreável ou anúncio aparecem aqui, do maior para o menor.'}
              </EmptyDescription>
            </EmptyHeader>
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link href="/tracking-links" />}
            >
              Criar link rastreável
              <ArrowRight data-icon="inline-end" />
            </Button>
          </Empty>
        ) : (
          <TooltipProvider delay={150}>
            <ol className="flex flex-col gap-3">
              {data.origens.map((o, i) => {
                const meta = TIPO_META[o.tipo];
                const Icone = meta.icone;
                return (
                  <li key={o.id} className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2 text-sm">
                      {/* tabular-nums para os números do ranking ficarem
                          alinhados quando passar de 9. */}
                      <span className="text-muted-foreground w-4 shrink-0 text-right text-xs tabular-nums">
                        {i + 1}
                      </span>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <span className="text-foreground min-w-0 flex-1 cursor-default truncate font-medium" />
                          }
                        >
                          {o.nome}
                        </TooltipTrigger>
                        {/* O nome costuma ser cortado; o tooltip é a
                            única forma de ler o resto sem sair da tela. */}
                        <TooltipContent className="max-w-xs">
                          {o.nome}
                        </TooltipContent>
                      </Tooltip>
                      <Badge variant="outline" className="shrink-0">
                        <Icone data-icon="inline-start" />
                        {meta.rotulo}
                      </Badge>
                      <span className="text-foreground w-10 shrink-0 text-right tabular-nums">
                        {o.leads.toLocaleString('pt-BR')}
                      </span>
                    </div>
                    {/* Barra proporcional ao PRIMEIRO colocado, não ao
                        total: com muitas origens pequenas, dividir pelo
                        total deixaria todas as barras invisíveis. */}
                    <div
                      className="bg-muted ml-6 h-1.5 overflow-hidden rounded-full"
                      role="presentation"
                    >
                      <div
                        className="bg-primary h-full rounded-full"
                        style={{
                          width: `${Math.max(
                            2,
                            (o.leads / data.origens[0].leads) * 100
                          )}%`,
                        }}
                      />
                    </div>
                  </li>
                );
              })}
            </ol>

            {data.semOrigem > 0 && (
              <p className="border-border text-muted-foreground mt-4 border-t pt-3 text-xs">
                Mais{' '}
                <strong className="text-foreground tabular-nums">
                  {data.semOrigem.toLocaleString('pt-BR')}
                </strong>{' '}
                lead{data.semOrigem === 1 ? '' : 's'} chegaram sem origem
                identificada e não entram neste ranking.
              </p>
            )}
          </TooltipProvider>
        )}
      </CardContent>
    </Card>
  );
}
