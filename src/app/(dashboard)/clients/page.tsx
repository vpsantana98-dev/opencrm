"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ClientLogo } from '@/components/clients/client-logo';
import {
  Building2,
  Check,
  Copy,
  KeyRound,
  Link2,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  Settings2,
  Trash2,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NewClientWizard } from "@/components/clients/new-client-wizard";

interface ClientRow {
  account_id: string;
  account_name: string;
  logo_url: string | null;
  contacts: number;
  open_conversations: number;
  open_deals: number;
  open_deal_value: number;
  whatsapp_connected: boolean;
  whatsapp_phone: string | null;
  /** Ramo do cliente (migration 059). NULL enquanto ninguém respondeu. */
  segment: string | null;
  /** Quantos números de WhatsApp — não só se HÁ um. */
  whatsapp_numbers: number;
  whatsapp_owner: "agencia" | "cliente" | null;
  ad_platforms: string[] | null;
  conversation_scope: "todas" | "sem_grupos" | null;
}

export default function ClientsPage() {
  const router = useRouter();
  const { refreshProfile, defaultCurrency } = useAuth();
  const [clients, setClients] = useState<ClientRow[]>([]);
  /** Ramo selecionado no filtro; null = todos. */
  const [segmentoFiltro, setSegmentoFiltro] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [homeId, setHomeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Rename inline de um cliente (resolve contas nomeadas por e-mail).
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [renamingBusy, setRenamingBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [setupClient, setSetupClient] = useState<ClientRow | null>(null);
  const [toDelete, setToDelete] = useState<ClientRow | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  // Cliente aguardando confirmação de "gerar novo link" (invalida o anterior).
  const [confirmLink, setConfirmLink] = useState<ClientRow | null>(null);
  const [linkFor, setLinkFor] = useState<ClientRow | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [operatorOpen, setOperatorOpen] = useState(false);
  const [accessEmail, setAccessEmail] = useState("");
  const [accessBusy, setAccessBusy] = useState(false);
  const [accessResult, setAccessResult] = useState<{
    email: string;
    password: string;
  } | null>(null);
  const [accessCopied, setAccessCopied] = useState(false);
  // Escopo do operador: 'all' (todos os clientes) ou 'client' (só um).
  // operatorClient guarda o cliente-alvo quando o diálogo abre de um card.
  const [operatorScope, setOperatorScope] = useState<"all" | "client">("all");
  const [operatorClient, setOperatorClient] = useState<ClientRow | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/account/overview", { cache: "no-store" });
      if (!res.ok) {
        toast.error("Não foi possível carregar os clientes");
        return;
      }
      const json = (await res.json()) as {
        clients?: ClientRow[];
        activeAccountId?: string;
        homeAccountId?: string;
      };
      setClients(json.clients ?? []);
      setActiveId(json.activeAccountId ?? null);
      setHomeId(json.homeAccountId ?? null);
    } catch {
      toast.error("Não foi possível carregar os clientes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function startRename(c: ClientRow) {
    setRenamingId(c.account_id);
    setRenameText(c.account_name);
  }

  async function saveRename() {
    const id = renamingId;
    const name = renameText.trim();
    if (!id || !name || renamingBusy) return;
    setRenamingBusy(true);
    try {
      const res = await fetch(`/api/account/workspaces/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(body.error ?? "Não foi possível renomear");
        return;
      }
      toast.success("Nome atualizado");
      setRenamingId(null);
      setRenameText("");
      await load();
    } finally {
      setRenamingBusy(false);
    }
  }

  // Switch active workspace, then optionally jump to a route inside it.
  async function enter(accountId: string, go: string) {
    if (busyId) return;
    setBusyId(accountId);
    try {
      const res = await fetch("/api/account/active", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId }),
      });
      if (!res.ok) {
        toast.error("Não foi possível entrar no cliente");
        return;
      }
      await refreshProfile();
      router.push(go);
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!toDelete || deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/account/workspaces/${toDelete.account_id}`, {
        method: "DELETE",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(body.error ?? "Não foi possível excluir o cliente");
        return;
      }
      toast.success("Cliente excluído");
      setToDelete(null);
      await load();
    } finally {
      setDeleting(false);
    }
  }

  // Gera o link público do Portal do Cliente e abre o Dialog para copiar.
  async function generateLink(c: ClientRow) {
    if (linkBusy) return;
    setLinkBusy(c.account_id);
    try {
      const res = await fetch(
        `/api/account/workspaces/${c.account_id}/connect-link`,
        { method: "POST" },
      );
      const body = (await res.json().catch(() => ({}))) as {
        link?: string;
        error?: string;
      };
      if (!res.ok || !body.link) {
        toast.error(body.error ?? "Não foi possível gerar o link");
        return;
      }
      setLink(body.link);
      setLinkFor(c);
      setCopied(false);
    } finally {
      setLinkBusy(null);
    }
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Não foi possível copiar. Copie manualmente.");
    }
  }

  // Sem cliente => global (todos). Com cliente => padrão "só este cliente".
  function openOperator(client?: ClientRow) {
    setOperatorClient(client ?? null);
    setOperatorScope(client ? "client" : "all");
    setOperatorOpen(true);
    setAccessEmail("");
    setAccessResult(null);
    setAccessCopied(false);
  }

  // Cria um login de OPERADOR (vê e opera todos os clientes) e mostra
  // e-mail + senha temporária pra compartilhar.
  async function createAccess() {
    if (accessBusy) return;
    const email = accessEmail.trim();
    // Validação de e-mail de verdade (antes só checava "@", aceitando
    // "a@" e afins — a senha aparece uma vez, e-mail errado = acesso perdido).
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error("Informe um e-mail válido");
      return;
    }
    if (operatorScope === "client" && !operatorClient) {
      toast.error("Escolha o cliente do operador");
      return;
    }
    setAccessBusy(true);
    try {
      const res = await fetch("/api/account/team-member", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          scope: operatorScope,
          accountId:
            operatorScope === "client" ? operatorClient?.account_id : undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        email?: string;
        password?: string;
        error?: string;
      };
      if (!res.ok || !body.email || !body.password) {
        toast.error(body.error ?? "Não foi possível criar o acesso");
        return;
      }
      setAccessResult({ email: body.email, password: body.password });
      toast.success("Acesso de operador criado");
    } finally {
      setAccessBusy(false);
    }
  }

  async function copyAccessMessage() {
    if (!accessResult) return;
    const origin =
      typeof window !== "undefined" ? window.location.origin : "";
    const msg = `Acesse o CRM em ${origin}/login\nE-mail: ${accessResult.email}\nSenha: ${accessResult.password}`;
    try {
      await navigator.clipboard.writeText(msg);
      setAccessCopied(true);
      setTimeout(() => setAccessCopied(false), 2000);
    } catch {
      toast.error("Não foi possível copiar. Copie manualmente.");
    }
  }

  // Ramos existentes, para os botões do filtro. Só aparecem os que
  // algum cliente realmente tem — uma lista fixa mostraria ramos vazios.
  const segmentos = [
    ...new Set(
      clients
        .map((c) => c.segment)
        .filter((s): s is string => typeof s === "string" && s.trim() !== ""),
    ),
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));

  const clientesVisiveis = segmentoFiltro
    ? clients.filter((c) => c.segment === segmentoFiltro)
    : clients;

  // Os totais seguem a lista VISÍVEL: filtrar por "Odontologia" e ver o
  // total de todos os clientes faria os números não baterem com os
  // cartões logo abaixo.
  const totals = clientesVisiveis.reduce(
    (acc, c) => ({
      contacts: acc.contacts + Number(c.contacts),
      conversations: acc.conversations + Number(c.open_conversations),
      value: acc.value + Number(c.open_deal_value),
    }),
    { contacts: 0, conversations: 0, value: 0 },
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Clientes
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Cada cliente é um espaço isolado que você gerencia, com WhatsApp,
            contatos e funil próprios. Entre em um cliente para operá-lo.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => openOperator()}>
            <KeyRound className="size-4" />
            Operador
          </Button>
          <Button
            onClick={() => {
              setSetupClient(null);
              setCreateOpen(true);
            }}
          >
            <Plus className="size-4" />
            Novo cliente
          </Button>
        </div>
      </div>

      {/* Totals across all clients */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <TotalTile
          icon={<Building2 className="size-4" />}
          label="Clientes"
          value={String(clients.length)}
        />
        <TotalTile
          icon={<Users className="size-4" />}
          label="Contatos"
          value={String(totals.contacts)}
        />
        <TotalTile
          icon={<MessageSquare className="size-4" />}
          label="Conversas abertas"
          value={String(totals.conversations)}
        />
        <TotalTile
          icon={<Wallet className="size-4" />}
          label="Em funil"
          value={formatCurrency(totals.value, defaultCurrency)}
        />
      </div>

      {/* Filtro por ramo. Só aparece com dois ramos ou mais: com um só,
          filtrar não separa nada e o controle vira ruído. */}
      {segmentos.length > 1 ? (
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Ramo:</span>
          <button
            type="button"
            onClick={() => setSegmentoFiltro(null)}
            className={
              "rounded-full border px-3 py-1 text-xs transition-colors " +
              (segmentoFiltro === null
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground")
            }
          >
            Todos ({clients.length})
          </button>
          {segmentos.map((seg) => {
            const quantos = clients.filter((c) => c.segment === seg).length;
            return (
              <button
                key={seg}
                type="button"
                onClick={() =>
                  setSegmentoFiltro((atual) => (atual === seg ? null : seg))
                }
                className={
                  "rounded-full border px-3 py-1 text-xs transition-colors " +
                  (segmentoFiltro === seg
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground")
                }
              >
                {seg} ({quantos})
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Client list */}
      <div className="mt-6">
        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="h-4 w-32 animate-pulse rounded bg-muted" />
                  <div className="h-5 w-20 animate-pulse rounded-full bg-muted" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="h-10 animate-pulse rounded bg-muted/60" />
                  <div className="h-10 animate-pulse rounded bg-muted/60" />
                  <div className="h-10 animate-pulse rounded bg-muted/60" />
                </div>
                <div className="h-8 animate-pulse rounded-lg bg-muted/60" />
              </div>
            ))}
          </div>
        ) : clientesVisiveis.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-16 text-center">
            <p className="text-sm text-muted-foreground">
              {segmentoFiltro
                ? `Nenhum cliente no ramo "${segmentoFiltro}".`
                : "Nenhum cliente ainda. Crie o primeiro para começar."}
            </p>
            {segmentoFiltro ? (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => setSegmentoFiltro(null)}
              >
                Mostrar todos
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {clientesVisiveis.map((c) => (
              <div
                key={c.account_id}
                className="flex flex-col rounded-xl border border-border bg-card p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {renamingId === c.account_id ? (
                      <div className="flex items-center gap-1.5">
                        <Input
                          value={renameText}
                          onChange={(e) => setRenameText(e.target.value)}
                          maxLength={120}
                          autoFocus
                          className="h-7 text-sm"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void saveRename();
                            if (e.key === "Escape") setRenamingId(null);
                          }}
                        />
                        <Button
                          size="icon-sm"
                          onClick={saveRename}
                          disabled={renamingBusy || !renameText.trim()}
                          aria-label="Salvar nome"
                        >
                          {renamingBusy ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Check className="size-3.5" />
                          )}
                        </Button>
                      </div>
                    ) : (
                      <div className="group/name flex items-center gap-1.5">
                        {/* Logo antes do nome: numa lista de cartoes
                            parecidos, e ela que faz reconhecer o cliente
                            antes de ler. */}
                        <ClientLogo
                          name={c.account_name}
                          logoUrl={c.logo_url}
                          size={24}
                        />
                        <p
                          className="truncate font-semibold text-foreground"
                          title={c.account_name}
                        >
                          {c.account_name}
                        </p>
                        <button
                          onClick={() => startRename(c)}
                          aria-label="Renomear cliente"
                          title="Renomear"
                          className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/name:opacity-100"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                      </div>
                    )}
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      {c.account_id === homeId ? (
                        <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-400">
                          Sua conta
                        </span>
                      ) : null}
                      {c.account_id === activeId ? (
                        <span className="text-[11px] font-medium uppercase tracking-wide text-primary">
                          Ativo agora
                        </span>
                      ) : null}
                      {c.segment ? (
                        <button
                          type="button"
                          onClick={() => setSegmentoFiltro(c.segment)}
                          title={`Ver só clientes de ${c.segment}`}
                          className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                        >
                          {c.segment}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <span
                    className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                      c.whatsapp_connected
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                        : "border-border bg-muted text-muted-foreground"
                    }`}
                  >
                    <span
                      className={`size-1.5 rounded-full ${
                        c.whatsapp_connected ? "bg-emerald-500" : "bg-muted-foreground/50"
                      }`}
                    />
                    {c.whatsapp_connected
                      ? (c.whatsapp_phone ?? "WhatsApp on")
                      : "Sem WhatsApp"}
                    {/* Com mais de um número, o telefone sozinho engana:
                        mostra um só e nada indica que existe outro,
                        possivelmente caído. */}
                    {Number(c.whatsapp_numbers) > 1
                      ? ` +${Number(c.whatsapp_numbers) - 1}`
                      : ""}
                  </span>
                </div>

                <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <Stat label="Contatos" value={String(c.contacts)} />
                  <Stat label="Conversas" value={String(c.open_conversations)} />
                  <Stat label="Negócios" value={String(c.open_deals)} />
                </dl>

                <div className="mt-4 flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={() => enter(c.account_id, "/dashboard")}
                    disabled={busyId === c.account_id}
                  >
                    {busyId === c.account_id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : null}
                    Entrar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      setSetupClient(c);
                      setCreateOpen(true);
                    }}
                    disabled={busyId === c.account_id}
                  >
                    <Settings2 className="size-4" />
                    Configurar
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Adicionar operador"
                    title="Adicionar operador a este cliente"
                    onClick={() => openOperator(c)}
                    className="text-muted-foreground hover:text-primary"
                  >
                    <UserPlus className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Gerar link de conexão"
                    title="Gerar link de conexão para o cliente"
                    onClick={() => setConfirmLink(c)}
                    disabled={linkBusy === c.account_id}
                    className="text-muted-foreground hover:text-primary"
                  >
                    {linkBusy === c.account_id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Link2 className="size-4" />
                    )}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Excluir cliente"
                    title={
                      c.account_id === homeId
                        ? "A conta da agência não pode ser excluída"
                        : "Excluir cliente"
                    }
                    onClick={() => setToDelete(c)}
                    disabled={busyId === c.account_id || c.account_id === homeId}
                    className="text-muted-foreground hover:text-red-500"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <NewClientWizard
        key={setupClient?.account_id ?? "new-client"}
        open={createOpen}
        onOpenChange={(nextOpen) => {
          setCreateOpen(nextOpen);
          if (!nextOpen) setSetupClient(null);
        }}
        onDone={load}
        client={setupClient}
      />

      <Dialog
        open={toDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setToDelete(null);
            setDeleteConfirmText("");
          }
        }}
      >
        <DialogContent className="border-border bg-popover sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Excluir cliente?</DialogTitle>
            <DialogDescription>
              {`"${toDelete?.account_name}" e tudo dele (contatos, conversas, funil, WhatsApp) serão excluídos. Não dá para desfazer.`}
            </DialogDescription>
          </DialogHeader>
          {/* Barreira: digitar o nome do cliente pra habilitar o Excluir —
              atrito proposital numa ação irreversível. */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">
              Digite <b className="text-foreground">{toDelete?.account_name}</b>{" "}
              para confirmar
            </label>
            <Input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={toDelete?.account_name ?? ""}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setToDelete(null);
                setDeleteConfirmText("");
              }}
              disabled={deleting}
            >
              Cancelar
            </Button>
            <Button
              onClick={confirmDelete}
              disabled={
                deleting ||
                deleteConfirmText.trim() !== (toDelete?.account_name ?? "")
              }
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {deleting ? <Loader2 className="size-4 animate-spin" /> : null}
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmação antes de gerar novo link (invalida o anterior enviado). */}
      <Dialog
        open={confirmLink !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmLink(null);
        }}
      >
        <DialogContent className="border-border bg-popover sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Gerar link de conexão?</DialogTitle>
            <DialogDescription>
              {`Isto gera um link novo para "${confirmLink?.account_name}" e invalida qualquer link enviado antes a este cliente. Só continue se ninguém ainda usou o link anterior.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmLink(null)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                const c = confirmLink;
                setConfirmLink(null);
                if (c) void generateLink(c);
              }}
            >
              Gerar link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={linkFor !== null}
        onOpenChange={(open) => {
          if (!open) {
            setLinkFor(null);
            setLink(null);
          }
        }}
      >
        <DialogContent className="border-border bg-popover sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Link de conexão do WhatsApp</DialogTitle>
            <DialogDescription>
              {`Mande este link para o responsável do "${linkFor?.account_name}". Ele abre no celular, sem login, e escaneia o QR com o WhatsApp que vai atender. O link conecta apenas este cliente.`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={link ?? ""}
              onFocus={(e) => e.currentTarget.select()}
              className="font-mono text-xs"
            />
            <Button
              variant="outline"
              size="icon"
              aria-label="Copiar link"
              onClick={copyLink}
              className="shrink-0"
            >
              {copied ? (
                <Check className="size-4 text-emerald-500" />
              ) : (
                <Copy className="size-4" />
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Gerar um link novo invalida o anterior. Não compartilhe
            publicamente: quem tiver o link consegue conectar um número a este
            cliente.
          </p>
          <DialogFooter>
            <Button
              onClick={() => {
                setLinkFor(null);
                setLink(null);
              }}
            >
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={operatorOpen}
        onOpenChange={(open) => {
          if (!open) {
            setOperatorOpen(false);
            setAccessResult(null);
          }
        }}
      >
        <DialogContent className="border-border bg-popover sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar operador</DialogTitle>
            <DialogDescription>
              {operatorScope === "client" && operatorClient
                ? `Cria um login que opera SÓ o cliente "${operatorClient.account_name}" (atendente). Ele pode conectar a própria chave do ClickUp nas Configurações.`
                : "Cria um login de operador da equipe: opera TODOS os clientes (time interno). Ele pode conectar a própria chave do ClickUp nas Configurações."}{" "}
              A senha aparece uma vez pra você repassar.
            </DialogDescription>
          </DialogHeader>

          {accessResult ? (
            <div className="flex flex-col gap-3">
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
                <p className="font-medium text-emerald-300">Acesso criado!</p>
                <p className="mt-2 font-mono text-xs text-foreground">
                  E-mail: {accessResult.email}
                </p>
                <p className="font-mono text-xs text-foreground">
                  Senha: {accessResult.password}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Guarde a senha agora: ela não aparece de novo. Passe esses dados
                pro cliente; ele pode trocar a senha depois nas Configurações.
              </p>
              <div className="flex justify-between">
                <Button variant="outline" onClick={copyAccessMessage}>
                  {accessCopied ? (
                    <Check className="size-4 text-emerald-500" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                  Copiar mensagem
                </Button>
                <Button onClick={() => setOperatorOpen(false)}>Fechar</Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {/* Alcance do operador — escolhível também pelo botão global. */}
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  Alcance do operador
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setOperatorScope("client")}
                    className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                      operatorScope === "client"
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span className="block font-medium">Só um cliente</span>
                    <span className="block text-[11px] opacity-80">
                      {operatorClient?.account_name ?? "Atendente"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setOperatorScope("all")}
                    className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                      operatorScope === "all"
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span className="block font-medium">Todos os clientes</span>
                    <span className="block text-[11px] opacity-80">
                      Time interno
                    </span>
                  </button>
                </div>
              </div>
              {/* Quando "só um cliente" e não veio de um card, escolhe qual. */}
              {operatorScope === "client" ? (
                <select
                  value={operatorClient?.account_id ?? ""}
                  onChange={(e) =>
                    setOperatorClient(
                      clients.find((c) => c.account_id === e.target.value) ?? null,
                    )
                  }
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="">Selecione o cliente...</option>
                  {clients.map((c) => (
                    <option key={c.account_id} value={c.account_id}>
                      {c.account_name}
                    </option>
                  ))}
                </select>
              ) : null}
              <Input
                type="email"
                value={accessEmail}
                onChange={(e) => setAccessEmail(e.target.value)}
                placeholder="email@doresponsavel.com"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") void createAccess();
                }}
              />
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setOperatorOpen(false)}
                  disabled={accessBusy}
                >
                  Cancelar
                </Button>
                <Button
                  onClick={createAccess}
                  disabled={
                    accessBusy ||
                    !accessEmail.trim() ||
                    (operatorScope === "client" && !operatorClient)
                  }
                >
                  {accessBusy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  Criar acesso
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TotalTile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="mt-2 text-xl font-semibold tabular-nums text-foreground">
        {value}
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-base font-semibold tabular-nums text-foreground">
        {value}
      </p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
