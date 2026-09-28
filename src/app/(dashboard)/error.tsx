"use client";

// Boundary de erro do dashboard: em vez da tela crua do Next (ou tela
// branca em produção), mostra uma mensagem clara com "tentar de novo"
// (reset) e um caminho de volta. Heurística de Nielsen: ajudar o usuário
// a reconhecer e se recuperar de erros.

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw, LayoutDashboard } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard/error]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-red-500/10 text-red-400">
        <AlertTriangle className="size-7" />
      </div>
      <div>
        <h1 className="text-lg font-semibold text-foreground">
          Algo deu errado aqui
        </h1>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          Tivemos um problema ao carregar esta tela. Você pode tentar de novo;
          se continuar, recarregue a página ou volte ao início.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={reset}>
          <RotateCcw className="size-4" />
          Tentar de novo
        </Button>
        <Button variant="outline" render={<Link href="/dashboard" />}>
          <LayoutDashboard className="size-4" />
          Ir pro início
        </Button>
      </div>
    </div>
  );
}
