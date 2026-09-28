"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * O formulário só entra no pacote quando alguém clica.
 *
 * Ele carrega FileReader, colagem, arrastar-e-soltar e miniaturas — peso
 * que a maioria das sessões nunca usa. `ssr: false` porque o modal lê
 * `navigator` e `window.screen` para montar o contexto do relato.
 */
const FeedbackModal = dynamic(
  () => import("./feedback-modal").then((m) => m.FeedbackModal),
  { ssr: false },
);

/**
 * Card de feedback no rodapé da navegação lateral.
 *
 * Fica fixo e sempre visível de propósito: o momento em que alguém
 * encontra um erro é justamente quando não vai caçar onde reportar. Se
 * o caminho for longo, o problema não chega até nós — vira reclamação
 * no WhatsApp ou nada.
 */
export function FeedbackCard({ collapsed = false }: { collapsed?: boolean }) {
  const [open, setOpen] = useState(false);
  // Só monta o modal depois do primeiro clique: `dynamic` adia o
  // download, mas montar o componente ainda custaria render em toda
  // navegação.
  const [jaAbriu, setJaAbriu] = useState(false);

  function abrir() {
    setJaAbriu(true);
    setOpen(true);
  }

  return (
    <>
      {collapsed ? (
        // Menu recolhido: só o ícone, com o rótulo no title.
        <button
          type="button"
          onClick={abrir}
          title="Enviar feedback"
          aria-label="Enviar feedback"
          className="hidden h-8 w-full items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:flex"
        >
          <Send className="size-4" />
        </button>
      ) : (
        <div
          className={cn(
            "rounded-lg border border-border bg-muted/30 p-3",
            collapsed && "lg:hidden",
          )}
        >
          <p className="text-sm font-medium text-foreground">Achou um erro?</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Conte o que aconteceu. Vai direto para quem cuida do sistema.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={abrir}
            className="mt-2.5 w-full"
          >
            <Send data-icon="inline-start" />
            Enviar feedback
          </Button>
        </div>
      )}

      {jaAbriu ? <FeedbackModal open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}
