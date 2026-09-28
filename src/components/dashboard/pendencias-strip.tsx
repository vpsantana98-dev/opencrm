"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronRight, Clock, UserX, WifiOff } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { loadPendencias, type PendenciasData } from "@/lib/dashboard/pendencias";

/**
 * Faixa de pendências — quais clientes precisam de alguém HOJE.
 *
 * É a única superfície CROSS-cliente do painel: todo o resto do
 * Dashboard fala do cliente ativo. Ela existe porque, numa agência com
 * várias contas, o problema não é ler o painel de um cliente — é
 * descobrir em QUAL deles algo quebrou sem abrir os dez.
 *
 * Só aparece quando há pendência. Uma faixa permanente vira moldura:
 * depois de uma semana ninguém enxerga mais.
 */
export function PendenciasStrip() {
  const [data, setData] = useState<PendenciasData | null>(null);

  useEffect(() => {
    // A função vive DENTRO do efeito, não num useCallback externo.
    // Fora dele, o lint acusa `react-hooks/set-state-in-effect`: um
    // callback com setState chamado direto do corpo do efeito pode
    // disparar render em cascata. Aqui dentro, o setState só acontece
    // depois do await, que já é assíncrono. Mesmo formato de
    // `WhatsAppHeaderStatus`.
    let cancelado = false;

    const carregar = async () => {
      try {
        const r = await loadPendencias(createClient());
        // Componente desmontado no meio da requisição: escrever estado
        // aqui vazaria e avisaria sobre uma tela que não existe mais.
        if (!cancelado) setData(r);
      } catch (err) {
        // Silencioso de propósito: é um aviso auxiliar. Falhar aqui não
        // pode encher a tela de erro e atrapalhar quem só queria ver os
        // números do cliente.
        console.error("[pendencias] falhou:", err);
      }
    };

    void carregar();
    // Mesma cadência do estado do WhatsApp no header. Um cliente que
    // cai precisa aparecer aqui sem depender de recarregar a página.
    const timer = setInterval(() => void carregar(), 60_000);
    return () => {
      cancelado = true;
      clearInterval(timer);
    };
  }, []);

  if (!data || data.clientes.length === 0) return null;

  const n = data.clientes.length;
  const caidos = data.clientes.filter((c) => c.whatsappCaido).length;
  const esperando = data.clientes.reduce((s, c) => s + c.esperando, 0);
  const semDono = data.clientes.reduce((s, c) => s + c.semResponsavel, 0);

  return (
    <Alert variant={caidos > 0 ? "destructive" : "default"}>
      <AlertTriangle />
      <AlertTitle>
        {n === 1
          ? "1 cliente precisa de atenção"
          : `${n} clientes precisam de atenção`}
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        {/* Os três sinais somados, para dar o tamanho do problema antes
            de o usuário decidir se vale abrir a lista. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {caidos > 0 && (
            <Badge variant="destructive">
              <WifiOff data-icon="inline-start" />
              {caidos} sem WhatsApp
            </Badge>
          )}
          {esperando > 0 && (
            <Badge variant="outline">
              <Clock data-icon="inline-start" />
              {esperando} esperando +{data.limiteMinutos}min
            </Badge>
          )}
          {semDono > 0 && (
            <Badge variant="outline">
              <UserX data-icon="inline-start" />
              {semDono} sem responsável
            </Badge>
          )}
        </div>

        {/* Os três primeiros por nome: o número sozinho não diz onde ir.
            A lista completa fica em Clientes. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="text-muted-foreground">
            {data.clientes
              .slice(0, 3)
              .map((c) => c.nome)
              .join(" · ")}
            {n > 3 ? ` · e mais ${n - 3}` : ""}
          </span>
          <Link
            href="/clients"
            className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
          >
            Ver detalhes
            <ChevronRight className="size-3" />
          </Link>
        </div>
      </AlertDescription>
    </Alert>
  );
}
