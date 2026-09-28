"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RotateCcw,
  Search,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface EventoConversao {
  id: string;
  event_name: string;
  event_id: string | null;
  provider: string;
  status: string;
  error: string | null;
  created_at: string;
}

const PROVEDOR_ROTULO: Record<string, string> = {
  meta: "Meta",
  google: "Google",
};

function formatarData(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Eventos de Conversão — histórico do que foi enviado para Meta (CAPI) e
 * Google Ads.
 *
 * Existe para responder, sem sair do CRM, a pergunta que o gestor de
 * tráfego faz todo dia: "a conversão daquele lead chegou na Meta?".
 * Antes, isso só aparecia como os 10 últimos dentro da tela de
 * Rastreamento — sem filtro, sem busca e sem histórico.
 */
export default function ConversionEventsPage() {
  const [eventos, setEventos] = useState<EventoConversao[]>([]);
  const [total, setTotal] = useState(0);
  const [resumo, setResumo] = useState({ enviados: 0, falhas: 0 });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [carregando, setCarregando] = useState(true);
  const [falhou, setFalhou] = useState(false);

  const [provider, setProvider] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [q, setQ] = useState("");
  // Só o valor "confirmado" da busca dispara fetch (debounce abaixo).
  const [qAplicado, setQAplicado] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setQAplicado(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setFalhou(false);
    try {
      const params = new URLSearchParams();
      if (provider) params.set("provider", provider);
      if (status) params.set("status", status);
      if (qAplicado.length >= 2) params.set("q", qAplicado);
      params.set("page", String(page));

      const res = await fetch(`/api/conversion-events?${params}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setFalhou(true);
        return;
      }
      const body = (await res.json()) as {
        events?: EventoConversao[];
        total?: number;
        pageSize?: number;
        resumo?: { enviados: number; falhas: number };
      };
      setEventos(body.events ?? []);
      setTotal(body.total ?? 0);
      setPageSize(body.pageSize ?? 50);
      setResumo(body.resumo ?? { enviados: 0, falhas: 0 });
    } catch {
      setFalhou(true);
    } finally {
      setCarregando(false);
    }
  }, [provider, status, qAplicado, page]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Trocar filtro tem que voltar pra primeira página, senão o usuário vê
  // "nenhum resultado" só porque estava na página 3 do filtro anterior.
  function aplicarFiltro(fn: () => void) {
    fn();
    setPage(0);
  }

  const temFiltro = provider !== "" || status !== "" || qAplicado.length >= 2;
  const ultimaPagina = Math.max(0, Math.ceil(total / pageSize) - 1);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Eventos de Conversão
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tudo que o CRM enviou para a Meta (API de Conversão) e para o
            Google Ads. Use para conferir se a conversão de um lead chegou.
          </p>
        </div>
        <Button variant="outline" onClick={carregar} disabled={carregando}>
          {carregando ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RotateCcw className="size-4" />
          )}
          Atualizar
        </Button>
      </div>

      {/* Resumo — responde "está saindo?" de relance */}
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Zap className="size-4" />
            <span className="text-xs">Total no histórico</span>
          </div>
          <p className="mt-2 text-xl font-semibold tabular-nums text-foreground">
            {(resumo.enviados + resumo.falhas).toLocaleString("pt-BR")}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-emerald-400">
            <CheckCircle2 className="size-4" />
            <span className="text-xs">Enviados</span>
          </div>
          <p className="mt-2 text-xl font-semibold tabular-nums text-foreground">
            {resumo.enviados.toLocaleString("pt-BR")}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-red-400">
            <AlertTriangle className="size-4" />
            <span className="text-xs">Falharam</span>
          </div>
          <p className="mt-2 text-xl font-semibold tabular-nums text-foreground">
            {resumo.falhas.toLocaleString("pt-BR")}
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => aplicarFiltro(() => setQ(e.target.value))}
            placeholder="Buscar por evento ou id (ex.: lead_...)"
            className="pl-9"
          />
        </div>
        <select
          value={provider}
          onChange={(e) => aplicarFiltro(() => setProvider(e.target.value))}
          className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
          aria-label="Filtrar por plataforma"
        >
          <option value="">Todas as plataformas</option>
          <option value="meta">Meta</option>
          <option value="google">Google</option>
        </select>
        <select
          value={status}
          onChange={(e) => aplicarFiltro(() => setStatus(e.target.value))}
          className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
          aria-label="Filtrar por status"
        >
          <option value="">Todos os status</option>
          <option value="sent">Enviados</option>
          <option value="failed">Falharam</option>
        </select>
        {temFiltro && (
          <Button
            variant="ghost"
            onClick={() =>
              aplicarFiltro(() => {
                setProvider("");
                setStatus("");
                setQ("");
                setQAplicado("");
              })
            }
          >
            Limpar filtros
          </Button>
        )}
      </div>

      {/* Tabela */}
      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
        {carregando ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-9 animate-pulse rounded bg-muted/60" />
            ))}
          </div>
        ) : falhou ? (
          <div className="flex flex-col items-center gap-3 py-14 text-center">
            <AlertTriangle className="size-8 text-red-400" />
            <p className="text-sm text-foreground">
              Não foi possível carregar os eventos.
            </p>
            <Button variant="outline" onClick={carregar}>
              <RotateCcw className="size-4" />
              Tentar de novo
            </Button>
          </div>
        ) : eventos.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-14 text-center">
            <Zap className="size-8 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">
              {temFiltro
                ? "Nenhum evento corresponde aos filtros."
                : "Nenhum evento enviado ainda."}
            </p>
            <p className="max-w-md text-xs text-muted-foreground">
              {temFiltro
                ? "Ajuste ou limpe os filtros."
                : "Os eventos aparecem aqui assim que um lead novo escrever ou um negócio for ganho, com o rastreamento ativo."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Evento</th>
                  <th className="px-4 py-3 font-medium">Plataforma</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Identificador</th>
                  <th className="px-4 py-3 font-medium">Quando</th>
                </tr>
              </thead>
              <tbody>
                {eventos.map((ev) => (
                  <tr
                    key={ev.id}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-3 font-medium text-foreground">
                      {ev.event_name}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {PROVEDOR_ROTULO[ev.provider] ?? ev.provider}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                          ev.status === "sent"
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                            : "border-red-500/40 bg-red-500/10 text-red-400",
                        )}
                        title={ev.error ?? undefined}
                      >
                        {ev.status === "sent" ? (
                          <CheckCircle2 className="size-3" />
                        ) : (
                          <AlertTriangle className="size-3" />
                        )}
                        {ev.status === "sent" ? "Enviado" : "Falhou"}
                      </span>
                      {/* O motivo da falha é o que torna a linha acionável;
                          sem ele o operador só sabe que deu errado. */}
                      {ev.status !== "sent" && ev.error && (
                        <p className="mt-1 max-w-sm truncate text-[11px] text-muted-foreground">
                          {ev.error}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {ev.event_id ?? "—"}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">
                      {formatarData(ev.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Paginação */}
      {!carregando && !falhou && total > pageSize && (
        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs tabular-nums text-muted-foreground">
            Página {page + 1} de {ultimaPagina + 1} · {total.toLocaleString("pt-BR")} eventos
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              <ChevronLeft className="size-4" />
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(ultimaPagina, p + 1))}
              disabled={page >= ultimaPagina}
            >
              Próxima
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
