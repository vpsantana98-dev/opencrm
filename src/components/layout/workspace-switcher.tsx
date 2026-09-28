"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";
import { ClientLogo } from "@/components/clients/client-logo";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Workspace {
  id: string;
  name: string;
  role: string;
  logo_url?: string | null;
}

/**
 * Agency workspace switcher. Lists every account (client workspace) the
 * user belongs to, marks the active one, and lets them switch or create
 * a new client. Switching hits POST /api/account/active (fail-closed on
 * the server) and refreshes so every account-scoped query re-runs.
 *
 * Self-contained: fetches its own list on mount, so it drops into the
 * sidebar without threading state through useAuth.
 */
export function WorkspaceSwitcher({
  variant = "sidebar",
}: {
  /** "sidebar" (padrão): largura total, abre pra cima (rodapé da sidebar).
   *  "inline": largura automática, abre pra baixo (topo do dashboard). */
  variant?: "sidebar" | "inline";
} = {}) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  async function loadWorkspaces() {
    try {
      const res = await fetch("/api/account/workspaces", {
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = (await res.json()) as {
        workspaces?: Workspace[];
        activeAccountId?: string;
      };
      setWorkspaces(json.workspaces ?? []);
      setActiveId(json.activeAccountId ?? null);
    } catch {
      // Non-fatal: the switcher just renders a neutral label.
    }
  }

  const pathname = usePathname();

  // Recarrega a cada navegacao, nao so na montagem.
  //
  // Com `[]`, a lista era buscada uma unica vez. Quem criasse um cliente
  // pelo assistente da tela de Clientes nunca via o novo cliente aqui —
  // o seletor so se atualizava quando ELE proprio criava um. Pior: o id
  // ativo passava a apontar para uma conta fora da lista, e o rotulo
  // exibia o cliente ERRADO. O header dizia "Sua Ag�ncia" enquanto a
  // pessoa operava outro cliente, que e exatamente o engano que este
  // componente existe para evitar.
  useEffect(() => {
    void loadWorkspaces();
  }, [pathname]);

  // Rede de seguranca: se o id ativo nao esta na lista, a lista esta
  // velha — nao ha nome para mostrar e o rotulo mentiria. Uma releitura
  // resolve. O guard de `workspaces.length` evita recarregar durante a
  // primeira carga, quando a lista ainda esta legitimamente vazia.
  useEffect(() => {
    if (!activeId || workspaces.length === 0) return;
    if (workspaces.some((w) => w.id === activeId)) return;
    void loadWorkspaces();
  }, [activeId, workspaces]);

  // A workspace switch changes the tenant boundary for every screen.
  // Next's router.refresh() intentionally preserves client useState, which
  // left conversations, contacts and dashboard data from the old client on
  // screen. A document reload remounts every account-scoped component and
  // tears down its realtime subscriptions before loading the new workspace.
  function applySwitch(newActiveId: string) {
    setActiveId(newActiveId);
    window.location.reload();
  }

  const active = workspaces.find((w) => w.id === activeId);

  async function switchTo(id: string) {
    if (id === activeId || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/account/active", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId: id }),
      });
      if (!res.ok) {
        toast.error("Não foi possível trocar de cliente");
        return;
      }
      applySwitch(id);
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const n = name.trim();
    if (!n || creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/account/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: n }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        id?: string;
        error?: string;
      };
      if (!res.ok || !body.id) {
        toast.error(body.error ?? "Não foi possível criar o cliente");
        return;
      }
      // Jump straight into the new workspace.
      await fetch("/api/account/active", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId: body.id }),
      });
      toast.success("Cliente criado");
      setCreateOpen(false);
      setName("");
      await loadWorkspaces();
      applySwitch(body.id);
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "hover:bg-muted/60 focus:bg-muted/60 data-popup-open:bg-muted/60 flex items-center gap-2 rounded-lg text-left transition-colors focus:outline-none",
            variant === "sidebar"
              ? "mb-2 w-full px-3 py-2"
              : "border-border bg-card w-auto max-w-64 border px-3 py-2"
          )}
        >
          {/* Logo do cliente ativo no lugar do icone generico: o mesmo
              predinho para todos nao ajudava a distinguir nada. */}
          <ClientLogo
            name={workspaces.find((w) => w.id === activeId)?.name ?? "?"}
            logoUrl={workspaces.find((w) => w.id === activeId)?.logo_url}
            size={20}
          />
          <span
            className="text-foreground min-w-0 flex-1 truncate text-sm font-medium"
            title={active?.name}
          >
            {active?.name ?? "Selecionar cliente"}
          </span>
          <ChevronsUpDown className="text-muted-foreground size-3.5 shrink-0" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side={variant === "sidebar" ? "top" : "bottom"}
          sideOffset={6}
          className="bg-popover text-popover-foreground ring-border min-w-60"
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel>Clientes</DropdownMenuLabel>
            {workspaces.map((w) => (
              <DropdownMenuItem
                key={w.id}
                onClick={() => switchTo(w.id)}
                disabled={busy}
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
              >
                <Check
                  className={cn(
                    "size-4",
                    w.id === activeId ? "opacity-100" : "opacity-0"
                  )}
                />
                <ClientLogo name={w.name} logoUrl={w.logo_url} size={20} />
                <span className="min-w-0 flex-1 truncate">{w.name}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator className="bg-border" />
          <DropdownMenuItem
            onClick={() => setCreateOpen(true)}
            className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
          >
            <Plus className="size-4" />
            Novo cliente
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="border-border bg-popover sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Novo cliente</DialogTitle>
            <DialogDescription>
              Crie um espaço de trabalho separado para um cliente, com WhatsApp,
              contatos e funil próprios.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome do cliente"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") void create();
            }}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              Cancelar
            </Button>
            <Button onClick={create} disabled={creating || !name.trim()}>
              {creating ? <Loader2 className="size-4 animate-spin" /> : null}
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
