"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  Folder,
  List as ListIcon,
  Link2,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Task {
  id: string;
  name: string;
  status: string;
  statusColor: string | null;
  url: string;
  assignees: string[];
  due: number | null;
  listId: string;
}
interface Target {
  type: "folder" | "list";
  id: string;
  name: string;
  spaceName: string;
  teamId: string;
}
interface StatusOption {
  status: string;
  color: string | null;
}
interface ListRef {
  id: string;
  name: string;
}
interface CardData {
  internal?: boolean;
  linked?: boolean;
  needsKey?: boolean;
  error?: string;
  refType?: "folder" | "list";
  listName?: string;
  url?: string | null;
  tasks?: Task[];
  nextDue?: number | null;
  owners?: string[];
  health?: string | null;
  csOwner?: string | null;
  statusesByList?: Record<string, StatusOption[]>;
  lists?: ListRef[];
}

const HEALTH: Array<{ key: string; label: string; cls: string; hint: string }> = [
  {
    key: "estavel",
    label: "Estável",
    cls: "border-emerald-500 text-emerald-400",
    hint: "Cliente saudável, sem sinais de risco.",
  },
  {
    key: "monitoramento",
    label: "Monitoramento",
    cls: "border-amber-500 text-amber-400",
    hint: "Requer atenção: acompanhar de perto.",
  },
  {
    key: "churn",
    label: "Possível churn",
    cls: "border-red-500 text-red-400",
    hint: "Risco de perder o cliente.",
  },
];

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/**
 * Painel do ClickUp no inbox (modo Ag�ncia): o "card do cliente" da conversa.
 * Saúde e responsável são campos do CRM (editáveis); tarefas, responsáveis
 * e próxima entrega vêm do alvo (Pasta/Lista) conectado via API. A conexão
 * é por seletor com busca + sugestão automática pelo nome — sem colar link.
 * Só time interno.
 */
export function ClickUpPanel({
  conversationId,
  contactName,
}: {
  conversationId: string;
  contactName?: string;
}) {
  const [data, setData] = useState<CardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingOwner, setEditingOwner] = useState(false);
  const [ownerDraft, setOwnerDraft] = useState("");
  const [confirmDisc, setConfirmDisc] = useState(false);

  // Nova tarefa (Passo 2.6): título + lista (só quando o alvo é Pasta).
  const [creatingTask, setCreatingTask] = useState(false);
  const [newTaskName, setNewTaskName] = useState("");
  const [newTaskListId, setNewTaskListId] = useState("");
  const [creatingSaving, setCreatingSaving] = useState(false);
  // Id da tarefa cujo status está sendo salvo (pra desabilitar só o seletor dela).
  const [statusSaving, setStatusSaving] = useState<string | null>(null);

  // Catálogo de alvos do ClickUp (carregado sob demanda pro seletor).
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [targetsNeedKey, setTargetsNeedKey] = useState(false);
  const [query, setQuery] = useState("");

  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const res = await fetch(
        `/api/inbox/clickup?conversationId=${encodeURIComponent(conversationId)}`,
        { cache: "no-store" },
      );
      // Sem checar res.ok, uma resposta de erro ({}) fazia o painel cair no
      // seletor como se nunca tivesse sido conectado. Agora sinaliza falha.
      if (!res.ok) {
        setLoadFailed(true);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as CardData;
      setData(body);
      setPicking(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadTargets = useCallback(async (fresh?: boolean) => {
    setTargetsLoading(true);
    try {
      const res = await fetch(
        `/api/inbox/clickup/targets${fresh ? "?fresh=1" : ""}`,
        { cache: "no-store" },
      );
      const body = (await res.json().catch(() => ({}))) as {
        targets?: Target[];
        needsKey?: boolean;
        error?: string;
      };
      setTargetsNeedKey(Boolean(body.needsKey));
      setTargets(body.targets ?? []);
      if (body.error) toast.error(`ClickUp: ${body.error}`);
    } finally {
      setTargetsLoading(false);
    }
  }, []);

  // Ao abrir o seletor (ou numa conversa ainda sem conexão), busca o catálogo.
  const pickerOpen = picking || (data && !data.linked && !data.needsKey);
  useEffect(() => {
    if (pickerOpen && targets === null && !targetsLoading) void loadTargets();
  }, [pickerOpen, targets, targetsLoading, loadTargets]);

  // Sugestão automática: alvo cujo nome casa com o do grupo/contato.
  const suggestion = useMemo(() => {
    if (!contactName || !targets) return null;
    const c = norm(contactName);
    return (
      targets.find((t) => norm(t.name) === c) ??
      targets.find((t) => norm(t.name).includes(c) || c.includes(norm(t.name))) ??
      null
    );
  }, [contactName, targets]);

  const matchCount = useMemo(() => {
    if (!targets) return 0;
    const q = norm(query);
    return q ? targets.filter((t) => norm(t.name).includes(q)).length : targets.length;
  }, [targets, query]);

  const filtered = useMemo(() => {
    if (!targets) return [];
    const q = norm(query);
    const list = q ? targets.filter((t) => norm(t.name).includes(q)) : targets;
    return list.slice(0, 50);
  }, [targets, query]);

  async function connect(t: Target) {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/inbox/clickup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId,
          type: t.type,
          id: t.id,
          name: t.name,
          teamId: t.teamId,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(body.error ?? "Não foi possível conectar");
        return;
      }
      toast.success(`Conectado a "${t.name}"`);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/inbox/clickup?conversationId=${encodeURIComponent(conversationId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        toast.error("Não foi possível desconectar");
        return;
      }
      toast.success("Chat desconectado do ClickUp");
      setConfirmDisc(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function patchField(patch: { health?: string | null; csOwner?: string | null }) {
    setData((d) => (d ? { ...d, ...patch } : d));
    const res = await fetch("/api/inbox/clickup", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId, ...patch }),
    });
    if (!res.ok) {
      toast.error("Não foi possível salvar");
      await load();
    }
  }

  async function submitNewTask() {
    const name = newTaskName.trim();
    if (!name || creatingSaving) return;
    if (data?.refType === "folder" && !newTaskListId) {
      toast.error("Escolha em qual lista da pasta criar a tarefa");
      return;
    }
    setCreatingSaving(true);
    try {
      const res = await fetch("/api/inbox/clickup/task", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId,
          name,
          listId: data?.refType === "folder" ? newTaskListId : undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(body.error ?? "Não foi possível criar a tarefa");
        return;
      }
      toast.success("Tarefa criada no ClickUp");
      setNewTaskName("");
      setNewTaskListId("");
      setCreatingTask(false);
      await load();
    } finally {
      setCreatingSaving(false);
    }
  }

  async function changeTaskStatus(taskId: string, status: string) {
    if (statusSaving) return;
    setStatusSaving(taskId);
    try {
      const res = await fetch("/api/inbox/clickup/task", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, taskId, status }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "Não foi possível mudar o status");
        return;
      }
      await load();
    } finally {
      setStatusSaving(null);
    }
  }

  // Não é time interno -> painel não aparece.
  if (!loading && data && data.internal === false) return null;

  const effectiveOwner =
    data?.csOwner || (data?.owners?.length ? data.owners.join(", ") : "");

  function renderPicker() {
    if (targetsNeedKey) {
      return (
        <p className="text-xs text-amber-400">
          Conecte seu ClickUp em Configurações → Seu perfil pra escolher o
          cliente.
        </p>
      );
    }
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">
          Escolha a <b>operação do cliente</b> no ClickUp (Pasta ou Lista).
        </p>

        {suggestion ? (
          <button
            onClick={() => connect(suggestion)}
            disabled={saving}
            className="flex items-center justify-between gap-2 rounded-lg border border-primary/50 bg-primary/10 px-3 py-2 text-left text-sm hover:bg-primary/15"
          >
            <span className="flex min-w-0 items-center gap-2">
              {suggestion.type === "folder" ? (
                <Folder className="size-4 shrink-0 text-primary" />
              ) : (
                <ListIcon className="size-4 shrink-0 text-primary" />
              )}
              <span className="min-w-0">
                <span className="block truncate text-foreground">
                  {suggestion.name}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  Sugerido · {suggestion.spaceName}
                </span>
              </span>
            </span>
            {saving ? <Loader2 className="size-4 shrink-0 animate-spin" /> : null}
          </button>
        ) : null}

        <div className="relative">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar cliente..."
            className="h-8 pl-7 text-xs"
          />
        </div>

        {targetsLoading ? (
          <div className="flex items-center py-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {targets && targets.length === 0
              ? "Nenhuma pasta/lista encontrada no ClickUp."
              : "Nada bate com a busca."}
          </p>
        ) : (
          <ul className="max-h-56 overflow-y-auto rounded-lg border border-border">
            {filtered.map((t) => (
              <li key={`${t.type}-${t.id}`}>
                <button
                  onClick={() => connect(t)}
                  disabled={saving}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-muted"
                >
                  {t.type === "folder" ? (
                    <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <ListIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-foreground">{t.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {t.spaceName}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {matchCount > filtered.length ? (
          <p className="text-[11px] text-muted-foreground">
            Mostrando {filtered.length} de {matchCount}. Refine a busca pra ver o
            resto.
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => loadTargets(true)}
            disabled={targetsLoading}
          >
            <RefreshCw className="size-3.5" />
            Recarregar
          </Button>
          {data?.linked ? (
            <Button size="sm" variant="ghost" onClick={() => setPicking(false)}>
              Cancelar
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-b border-[#191528] bg-[#080711] p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wide text-[#756c8f]">
          Cliente · ClickUp
        </span>
        {data?.linked && !picking ? (
          <div className="flex items-center gap-1">
            <button
              onClick={load}
              title="Atualizar"
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <RefreshCw className="size-3.5" />
            </button>
            <button
              onClick={() => setPicking(true)}
              title="Trocar cliente"
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Link2 className="size-3.5" />
            </button>
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="flex items-center py-4 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
        </div>
      ) : loadFailed ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-xs text-amber-400">
            Não foi possível carregar o card do ClickUp.
          </p>
          <Button size="sm" variant="outline" onClick={load}>
            <RefreshCw className="size-3.5" />
            Recarregar
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4 rounded-xl border border-[#191528] bg-[#0d0b16] p-3">
          {/* --- Saúde (campo do CRM) --- */}
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-[#756c8f]">
              Saúde
            </p>
            <div className="flex flex-wrap gap-1.5">
              {HEALTH.map((h) => {
                const active = data?.health === h.key;
                return (
                  <button
                    key={h.key}
                    title={h.hint}
                    onClick={() => patchField({ health: active ? null : h.key })}
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                      active
                        ? h.cls
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {h.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* --- Responsável (CS) --- */}
          <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[#756c8f]">
              Responsável (CS)
            </p>
            {editingOwner ? (
              <div className="flex gap-2">
                <Input
                  value={ownerDraft}
                  onChange={(e) => setOwnerDraft(e.target.value)}
                  placeholder="Nome do CS"
                  className="h-8 text-xs"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      void patchField({ csOwner: ownerDraft });
                      setEditingOwner(false);
                    }
                    if (e.key === "Escape") setEditingOwner(false);
                  }}
                />
                <Button
                  size="sm"
                  onClick={() => {
                    void patchField({ csOwner: ownerDraft });
                    setEditingOwner(false);
                  }}
                >
                  OK
                </Button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setOwnerDraft(data?.csOwner ?? "");
                  setEditingOwner(true);
                }}
                className="group flex items-center gap-1.5 text-sm text-[#f1edff]"
              >
                <span>{effectiveOwner || "—"}</span>
                <Pencil className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
              </button>
            )}
          </div>

          {/* --- Próxima entrega (do ClickUp) --- */}
          {data?.linked && !data?.needsKey && !data?.error && !picking ? (
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[#756c8f]">
                Próxima entrega
              </p>
              <p className="text-sm text-[#f1edff]">
                {data?.nextDue
                  ? new Date(data.nextDue).toLocaleDateString("pt-BR", {
                      day: "2-digit",
                      month: "short",
                    })
                  : "Sem data"}
              </p>
            </div>
          ) : null}

          {/* --- Seção ClickUp: seletor / tarefas --- */}
          {data?.needsKey ? (
            <p className="text-xs text-amber-400">
              Conecte seu ClickUp em Configurações → Seu perfil pra ver as
              tarefas.
            </p>
          ) : picking || !data?.linked ? (
            renderPicker()
          ) : data?.error ? (
            <p className="text-xs text-amber-400">ClickUp: {data.error}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {data?.listName ? (
                <p className="text-sm font-medium text-foreground">
                  {data.listName}
                </p>
              ) : null}
              {/* Ações claras: trocar de cliente ou desconectar (undo).
                  Confirmação inline (sem window.confirm, consistente com o
                  design). */}
              {confirmDisc ? (
                <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-2">
                  <span className="flex-1 text-xs text-muted-foreground">
                    Desconectar do ClickUp? Saúde e responsável continuam.
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={disconnect}
                    disabled={saving}
                    className="text-red-400 hover:text-red-300"
                  >
                    {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    Desconectar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmDisc(false)}
                    disabled={saving}
                  >
                    Cancelar
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPicking(true)}
                    disabled={saving}
                  >
                    <Link2 className="size-3.5" />
                    Trocar cliente
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmDisc(true)}
                    disabled={saving}
                    className="text-red-400 hover:text-red-300"
                  >
                    <Trash2 className="size-3.5" />
                    Desconectar
                  </Button>
                </div>
              )}
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[#756c8f]">
                    Tarefas abertas ({data?.tasks?.length ?? 0})
                  </p>
                  {!creatingTask ? (
                    <button
                      onClick={() => setCreatingTask(true)}
                      className="flex items-center gap-1 text-[11px] text-primary hover:underline"
                    >
                      <Plus className="size-3" />
                      Nova tarefa
                    </button>
                  ) : null}
                </div>

                {creatingTask ? (
                  <div className="mb-2 flex flex-col gap-2 rounded-lg border border-border p-2">
                    <Input
                      value={newTaskName}
                      onChange={(e) => setNewTaskName(e.target.value)}
                      placeholder="Título da tarefa"
                      className="h-8 text-xs"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void submitNewTask();
                        if (e.key === "Escape") setCreatingTask(false);
                      }}
                    />
                    {data?.refType === "folder" ? (
                      <select
                        value={newTaskListId}
                        onChange={(e) => setNewTaskListId(e.target.value)}
                        className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                      >
                        <option value="">Escolha a lista...</option>
                        {(data.lists ?? []).map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    <div className="flex gap-2">
                      <Button size="sm" onClick={submitNewTask} disabled={creatingSaving}>
                        {creatingSaving ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : null}
                        Criar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setCreatingTask(false)}
                        disabled={creatingSaving}
                      >
                        Cancelar
                      </Button>
                    </div>
                  </div>
                ) : null}

                {(data?.tasks?.length ?? 0) === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nenhuma tarefa aberta.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {data!.tasks!.map((t) => {
                      const statusOptions = data?.statusesByList?.[t.listId] ?? [];
                      return (
                        <li key={t.id} className="flex items-center gap-2 rounded-lg border border-[#191528] bg-[#080711] px-2 py-2 text-sm">
                          <a
                            href={t.url || undefined}
                            target="_blank"
                            rel="noreferrer"
                            className="min-w-0 flex-1 truncate text-[#f1edff] hover:text-[#9900ff] hover:underline"
                          >
                            {t.name}
                          </a>
                          {statusOptions.length > 0 ? (
                            <select
                              value={t.status}
                              disabled={statusSaving === t.id}
                              onChange={(e) => changeTaskStatus(t.id, e.target.value)}
                              className="shrink-0 rounded-full border bg-background px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-foreground"
                              style={{ borderColor: t.statusColor ?? undefined }}
                            >
                              {statusOptions.map((s) => (
                                <option key={s.status} value={s.status}>
                                  {s.status}
                                </option>
                              ))}
                            </select>
                          ) : t.status ? (
                            <span
                              className="shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
                              style={{
                                borderColor: t.statusColor ?? undefined,
                                color: t.statusColor ?? undefined,
                              }}
                            >
                              {t.status}
                            </span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              {data?.url ? (
                <a
                  href={data.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#9900ff]/60 px-3 py-1.5 text-sm text-[#f1edff] hover:bg-[#9900ff]/10"
                >
                  <ExternalLink className="size-4" />
                  Ver no ClickUp
                </a>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
