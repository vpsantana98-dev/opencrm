"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface StatusResponse {
  configured: boolean;
  exists?: boolean;
  connected?: boolean;
  state?: string;
  phone?: string | null;
}

interface WhatsAppStatusPillProps {
  collapsed?: boolean;
}

export function WhatsAppStatusPill({ collapsed = false }: WhatsAppStatusPillProps) {
  const router = useRouter();
  const [status, setStatus] = useState<StatusResponse | null>(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch("/api/whatsapp/evolution/status");
        if (res.ok) {
          const data = await res.json();
          setStatus(data);
        }
      } catch {
        // Silently handle errors — show neutral state
      }
    };

    // Initial fetch
    fetchStatus();

    // Poll every 30s
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  if (!status) {
    return null;
  }

  let dotColor = "bg-muted-foreground";
  let label = "WhatsApp: desconectado";

  if (!status.configured) {
    dotColor = "bg-muted-foreground";
    label = "Não configurado";
  } else if (status.connected) {
    dotColor = "bg-green-500";
    label = "WhatsApp: conectado";
  } else if (status.state === "connecting") {
    dotColor = "bg-yellow-500";
    label = "WhatsApp: conectando";
  } else {
    dotColor = "bg-red-500";
    label = "WhatsApp: desconectado";
  }

  const handleClick = () => {
    router.push("/settings");
  };

  const content = (
    <button
      type="button"
      onClick={handleClick}
      className="flex w-full items-center gap-2 text-left transition-colors hover:opacity-80"
      title={label}
    >
      <span className={cn("h-2 w-2 rounded-full shrink-0", dotColor)} />
      {!collapsed && <span className="text-xs text-muted-foreground truncate">{label}</span>}
    </button>
  );

  if (collapsed) {
    return (
      <TooltipProvider delay={150}>
        <Tooltip>
          <TooltipTrigger render={content}>
          </TooltipTrigger>
          <TooltipContent side="right">
            {label}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return content;
}
