"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Smartphone } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface StatusResponse {
  configured: boolean;
  exists?: boolean;
  connected?: boolean;
  state?: string;
  phone?: string | null;
}

/** +5531999999999 → "(31) 99999-9999". Formato desconhecido volta cru. */
function formatarTelefone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  // 55 + DDD(2) + numero(8 ou 9)
  if (d.length === 13 && d.startsWith("55")) {
    return `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  }
  if (d.length === 12 && d.startsWith("55")) {
    return `(${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  }
  return phone;
}

/**
 * Estado do WhatsApp do cliente ativo, ao lado do seletor de cliente.
 *
 * Fica AO LADO do seletor de propósito: as duas informações respondem
 * juntas a "estou operando qual cliente, e por qual número?". Separadas
 * — cliente no topo, WhatsApp no rodapé da sidebar — dava para ler uma
 * sem a outra e agir na conta errada.
 *
 * Não é um filtro, e sim um indicador. O painel de referência (Trizup)
 * tem um seletor "Todos WhatsApps" porque lá um cliente pode ter vários
 * números; aqui `evolution_instances.account_id` é PRIMARY KEY, ou seja,
 * o banco garante UM número por cliente. Um seletor de uma opção só
 * seria ruído fingindo ser controle.
 */
export function WhatsAppHeaderStatus() {
  const [status, setStatus] = useState<StatusResponse | null>(null);

  useEffect(() => {
    let cancelado = false;

    const buscar = async () => {
      try {
        const res = await fetch("/api/whatsapp/evolution/status", {
          cache: "no-store",
        });
        if (!res.ok || cancelado) return;
        setStatus((await res.json()) as StatusResponse);
      } catch {
        // Silencioso: um indicador que não carregou não pode virar erro
        // na cara de quem só queria ver o dashboard.
      }
    };

    void buscar();
    const timer = setInterval(buscar, 30_000);
    return () => {
      cancelado = true;
      clearInterval(timer);
    };
  }, []);

  // Enquanto não sabe, não ocupa espaço — evita o pisca-pisca de um
  // rótulo "carregando" que dura menos de um segundo.
  if (!status) return null;

  const { cor, rotulo, detalhe } = descrever(status);

  return (
    <TooltipProvider delay={150}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Link
              href="/settings?tab=whatsapp"
              aria-label={`WhatsApp: ${rotulo}. Abrir configurações.`}
              className="hidden items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-xs transition-colors hover:bg-muted lg:flex"
            />
          }
        >
          <span
            className={cn("size-2 shrink-0 rounded-full", cor)}
            aria-hidden
          />
          {/* Conectado: mostra o NÚMERO, que é a informação útil ("é
              deste telefone que estou falando"). Sem conexão, o número
              não existe, então mostra o estado. */}
          <span className="max-w-[10rem] truncate text-muted-foreground">
            {status.connected && status.phone
              ? formatarTelefone(status.phone)
              : rotulo}
          </span>
          <Smartphone className="size-3.5 shrink-0 text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          {detalhe}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function descrever(status: StatusResponse): {
  cor: string;
  rotulo: string;
  detalhe: string;
} {
  if (!status.configured) {
    return {
      cor: "bg-muted-foreground",
      rotulo: "Sem WhatsApp",
      detalhe:
        "Este cliente ainda não tem WhatsApp conectado. Clique para configurar.",
    };
  }
  if (status.connected) {
    return {
      cor: "bg-green-500",
      rotulo: "Conectado",
      detalhe: status.phone
        ? `WhatsApp conectado no número ${formatarTelefone(status.phone)}. Clique para gerenciar.`
        : "WhatsApp conectado. Clique para gerenciar.",
    };
  }
  if (status.state === "connecting") {
    return {
      cor: "bg-yellow-500",
      rotulo: "Conectando",
      detalhe: "A conexão está sendo estabelecida. Isso leva alguns segundos.",
    };
  }
  return {
    cor: "bg-red-500",
    rotulo: "Desconectado",
    detalhe:
      "O WhatsApp deste cliente caiu. Mensagens não entram nem saem até reconectar. Clique para gerar um novo QR.",
  };
}
