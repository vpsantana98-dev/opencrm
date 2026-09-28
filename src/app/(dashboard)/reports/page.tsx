"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Download,
  Inbox,
  Info,
  MessageSquare,
  RotateCcw,
  Timer,
  UserRound,
  UsersRound,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  formatarDuracao,
  intervaloDe,
  PERIODOS,
  rotuloIntervalo,
  type PeriodoId,
} from "@/lib/reports/periodo";
import type { ReportsBundle } from "@/lib/reports/types";

const PAPEL_LABEL: Record<string, string> = {
  owner: "Proprietário",
  admin: "Admin",
  agent: "Agente",
  viewer: "Visualizador",
};

/**
 * Relatórios — desempenho por atendente.
 *
 * Recorte estreito de propósito. O Dashboard já responde "como está o
 * negócio" (volume, funil, tempo de resposta do time). O que não existia
 * em lugar nenhum era o corte por PESSOA, com um período escolhido pelo
 * usuário e uma saída em planilha — e é só isso que esta tela faz.
 */
export default function ReportsPage() {
  const [periodo, setPeriodo] = useState<PeriodoId>("30d");
  const [bundle, setBundle] = useState<ReportsBundle | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [falhou, setFalhou] = useState<string | null>(null);
  const [baixando, setBaixando] = useState(false);

  // O intervalo é derivado do período escolhido, no fuso do navegador.
  const intervalo = useMemo(() => intervaloDe(periodo), [periodo]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setFalhou(null);
    try {
      const params = new URLSearchParams({
        from: intervalo.from.toISOString(),
        to: intervalo.to.toISOString(),
      });
      const res = await fetch(`/api/reports?${params}`, { cache: "no-store" });
      if (!res.ok) {
        const corpo = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setFalhou(corpo?.error ?? "Não foi possível carregar o relatório.");
        return;
      }
      setBundle((await res.json()) as ReportsBundle);
    } catch {
      setFalhou("Não foi possível carregar o relatório.");
    } finally {
      setCarregando(false);
    }
  }, [intervalo]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const baixarCSV = useCallback(async () => {
    setBaixando(true);
    try {
      const params = new URLSearchParams({
        from: intervalo.from.toISOString(),
        to: intervalo.to.toISOString(),
        format: "csv",
      });
      const res = await fetch(`/api/reports?${params}`, { cache: "no-store" });
      if (!res.ok) {
        setFalhou("Não foi possível gerar o CSV.");
        return;
      }
      // Baixa via blob (e não abrindo a URL numa aba) porque o fetch
      // leva os cookies de sessão e respeita o mesmo tratamento de erro
      // acima — navegar para a URL mostraria um JSON de erro cru na cara
      // do usuário se a sessão tivesse expirado.
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        res.headers
          .get("Content-Disposition")
          ?.match(/filename="([^"]+)"/)?.[1] ?? "relatorio.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setFalhou("Não foi possível gerar o CSV.");
    } finally {
      setBaixando(false);
    }
  }, [intervalo]);

  const temAlgumaMensagem =
    (bundle?.totais.mensagensEnviadas ?? 0) > 0 ||
    (bundle?.totais.mensagensRecebidas ?? 0) > 0;

  return (
    <div className="flex flex-col gap-5">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Relatórios</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Desempenho por atendente no período de {rotuloIntervalo(intervalo)}.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={baixarCSV}
          disabled={baixando || carregando || !bundle}
        >
          {baixando ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <Download data-icon="inline-start" />
          )}
          Exportar CSV
        </Button>
      </div>

      {/* Seletor de período.
          ToggleGroup em vez de <button> num laço: o componente já traz
          a semântica de grupo, o estado pressionado e a navegação por
          teclado entre as opções. No Base UI o valor é sempre ARRAY,
          mesmo na seleção única — daí o empacota/desempacota abaixo. */}
      <ToggleGroup
        variant="outline"
        value={[periodo]}
        onValueChange={(v) => {
          const escolhido = v[0] as PeriodoId | undefined;
          // Clicar na opção já ativa devolve lista vazia. Um relatório
          // sem período não existe, então ignoramos e mantemos a atual.
          if (escolhido) setPeriodo(escolhido);
        }}
        aria-label="Período"
      >
        {PERIODOS.map((p) => (
          <ToggleGroupItem key={p.id} value={p.id}>
            {p.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {falhou && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>{falhou}</AlertTitle>
          <AlertDescription>
            <Button size="sm" variant="outline" onClick={carregar}>
              <RotateCcw data-icon="inline-start" />
              Tentar de novo
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Amostra em vez de total — precisa aparecer ANTES dos números,
          senão o usuário lê a tabela como exata e só descobre depois. */}
      {bundle?.truncado && (
        <Alert>
          <AlertTriangle />
          <AlertTitle>Estes números são uma amostra</AlertTitle>
          <AlertDescription>
            O período tem mais mensagens do que cabe numa leitura só. Escolha um
            período menor para um resultado exato.
          </AlertDescription>
        </Alert>
      )}

      {/* Totais do período */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CartaoTotal
          titulo="Mensagens enviadas"
          valor={bundle?.totais.mensagensEnviadas}
          carregando={carregando}
          icone={MessageSquare}
        />
        <CartaoTotal
          titulo="Mensagens recebidas"
          valor={bundle?.totais.mensagensRecebidas}
          carregando={carregando}
          icone={Inbox}
        />
        <CartaoTotal
          titulo="Conversas novas"
          valor={bundle?.totais.conversasNovas}
          carregando={carregando}
          icone={MessageSquare}
        />
        <CartaoTotal
          titulo="Contatos novos"
          valor={bundle?.totais.contatosNovos}
          carregando={carregando}
          icone={UserRound}
        />
      </div>

      {/* Tabela por atendente */}
      <Card size="sm" className="gap-0">
        {/* border-b no header: o próprio CardHeader reage a essa classe
            ajustando o próprio padding inferior (ver card.tsx). */}
        <CardHeader className="border-b pb-3">
          <CardTitle>Por atendente</CardTitle>
          {bundle && bundle.mensagensSemAutoria > 0 && (
            <CardAction>
            <TooltipProvider delay={150}>
              <Tooltip>
                {/* Badge em vez de <span> estilizado. `render` é a forma
                    do Base UI de trocar o elemento do gatilho — o Radix
                    usaria asChild. Sem `nativeButton` aqui: no Base UI
                    1.6.0 essa prop existe só em Button e AccordionTrigger,
                    e o Tooltip.Trigger não força um <button>. */}
                <TooltipTrigger
                  render={<Badge variant="outline" className="cursor-help" />}
                >
                  <Info data-icon="inline-start" />
                  {bundle.mensagensSemAutoria.toLocaleString("pt-BR")} sem autoria
                </TooltipTrigger>
                <TooltipContent side="left" className="max-w-xs">
                  Mensagens enviadas antes do sistema passar a registrar quem
                  enviou, ou vindas da API pública (que autentica por chave, sem
                  usuário). Elas não somam para nenhum atendente e não têm como
                  ser recuperadas.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            </CardAction>
          )}
        </CardHeader>

        <CardContent className="px-0">
        {carregando ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Spinner />
            Carregando…
          </div>
        ) : !bundle || bundle.agentes.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UsersRound />
              </EmptyMedia>
              <EmptyTitle>Nenhum atendente nesta conta</EmptyTitle>
              <EmptyDescription>
                Convide alguém em Equipe para começar a medir atendimento.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-4">Atendente</TableHead>
                <TableHead className="px-4 text-right">Enviadas</TableHead>
                <TableHead className="px-4 text-right">
                  Conversas atendidas
                </TableHead>
                <TableHead className="px-4 text-right">Na fila hoje</TableHead>
                <TableHead className="px-4 text-right">
                  Resposta média
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bundle.agentes.map((a) => (
                <TableRow key={a.userId}>
                  <TableCell className="px-4">
                    <div className="flex items-center gap-2.5">
                      <Avatar className="size-7 shrink-0">
                        {a.avatarUrl ? (
                          <AvatarImage src={a.avatarUrl} alt={a.nome} />
                        ) : null}
                        <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
                          {a.nome.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">
                          {a.nome}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {a.email ?? (a.papel ? PAPEL_LABEL[a.papel] : "")}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="px-4 text-right tabular-nums">
                    {a.mensagensEnviadas.toLocaleString("pt-BR")}
                  </TableCell>
                  <TableCell className="px-4 text-right tabular-nums">
                    {a.conversasAtendidas.toLocaleString("pt-BR")}
                  </TableCell>
                  <TableCell className="px-4 text-right tabular-nums text-muted-foreground">
                    {a.conversasAtribuidas.toLocaleString("pt-BR")}
                  </TableCell>
                  <TableCell className="px-4 text-right">
                    <span className="tabular-nums">
                      {formatarDuracao(a.tempoMedioRespostaMin)}
                    </span>
                    {/* Uma média de 1 ou 2 amostras não é uma média —
                        mostrar o n do lado evita que alguém compare
                        dois atendentes com bases incomparáveis. */}
                    {a.amostrasResposta > 0 && (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        ({a.amostrasResposta})
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        </CardContent>
      </Card>

      {/* Nota de rodapé: o que estes números NÃO dizem. */}
      {!carregando && bundle && (
        <Alert>
          <Timer />
          <AlertTitle>Como ler estes números</AlertTitle>
          {/* flex + gap, não space-y: o utilitário de espaçamento entre
              irmãos quebra quando um dos filhos é condicional. */}
          <AlertDescription className="flex flex-col gap-1">
            <p>
              <strong className="text-foreground">Resposta média</strong> é o
              tempo entre a mensagem do cliente e a primeira resposta desse
              atendente. Respostas automáticas não entram na média de ninguém.
            </p>
            <p>
              <strong className="text-foreground">Na fila hoje</strong> é o
              estado atual da atribuição, não do período: quem é dono da conversa
              agora. O sistema não guarda histórico de transferência, então não
              há como dizer de quem ela era antes.
            </p>
            {!temAlgumaMensagem && (
              <p>
                Nenhuma mensagem neste período — os zeros acima são ausência de
                movimento, não falha de carregamento.
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

// ------------------------------------------------------------

function CartaoTotal({
  titulo,
  valor,
  carregando,
  icone: Icone,
}: {
  titulo: string;
  valor: number | undefined;
  carregando: boolean;
  icone: typeof MessageSquare;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Icone className="size-3.5 shrink-0" />
          <span className="truncate">{titulo}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {carregando || valor === undefined ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <p className="text-2xl font-bold tabular-nums text-foreground">
            {valor.toLocaleString("pt-BR")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
