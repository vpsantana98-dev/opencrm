"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Users, Trash2, ArrowRight } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";

// DEV-ONLY: tela pra visualizar o Modo Ag�ncia sem WhatsApp real. Injeta
// um grupo de demonstração no inbox e (opcional) remove depois. A rota
// /api/dev/agency-demo já bloqueia produção.
export default function AgencyDevPage() {
  const router = useRouter();
  const { isInternal } = useAuth();
  const [busy, setBusy] = useState<null | "seed" | "clean">(null);

  const isProd = process.env.NODE_ENV === "production";

  async function seed() {
    setBusy("seed");
    try {
      const res = await fetch("/api/dev/agency-demo", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        conversationId?: string;
        error?: string;
      };
      if (!res.ok) {
        toast.error(body.error ?? "Falhou ao criar a demonstração");
        return;
      }
      toast.success("Grupo de demonstração criado no inbox");
      if (body.conversationId) {
        router.push(`/inbox?c=${body.conversationId}`);
      }
    } finally {
      setBusy(null);
    }
  }

  async function clean() {
    setBusy("clean");
    try {
      const res = await fetch("/api/dev/agency-demo", { method: "DELETE" });
      if (!res.ok) {
        toast.error("Falhou ao remover a demonstração");
        return;
      }
      toast.success("Demonstração removida");
    } finally {
      setBusy(null);
    }
  }

  if (isProd) {
    return (
      <div className="p-8">
        <p className="text-sm text-muted-foreground">
          Esta tela é só de desenvolvimento.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-8">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Users className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">
            Modo Ag�ncia · demonstração
          </h1>
          <p className="text-sm text-muted-foreground">
            Visualize o grupo do WhatsApp + painel do ClickUp sem número real.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <p className="text-sm text-foreground">
          O botão abaixo cria um <b>grupo de demonstração</b> no seu inbox (só
          no banco de desenvolvimento), com mensagens de vários remetentes,
          igual ao que o WhatsApp entregaria. Assim dá pra ver:
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>o grupo na lista de conversas (ícone de grupo);</li>
          <li>quem falou acima de cada balão (estilo WhatsApp);</li>
          <li>
            o <b>painel do ClickUp</b> à direita — cole a URL de uma Lista real
            pra puxar as tarefas.
          </li>
        </ul>

        {!isInternal ? (
          <p className="mt-4 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
            Seu perfil não está marcado como interno, então o painel do ClickUp
            não vai aparecer. O grupo ainda aparece no inbox.
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-3">
          <Button onClick={seed} disabled={busy !== null}>
            {busy === "seed" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Users className="h-4 w-4" />
            )}
            Criar grupo de demonstração
          </Button>
          <Button variant="outline" onClick={clean} disabled={busy !== null}>
            {busy === "clean" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Remover demonstração
          </Button>
          <Button variant="ghost" onClick={() => router.push("/inbox")}>
            Ir pro inbox
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
