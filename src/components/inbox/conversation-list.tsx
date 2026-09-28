"use client";

import { memo, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import {
  CONVERSATION_SELECT,
  matchesContactFilters,
  normalizeConversations,
} from "@/lib/inbox/conversations";
import { cn } from "@/lib/utils";
import type { Conversation, ConversationStatus, Tag } from "@/types";
import { Search, ChevronDown, X, MessageSquare, Users } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ConversationListProps {
  /**
   * Conta ativa. OBRIGATÓRIO no filtro da query: a RLS de `conversations`
   * é `is_account_member(account_id)`, que libera QUALQUER conta da qual
   * o usuário é membro. Sem este `.eq`, quem atende dois clientes veria
   * as conversas dos dois embaralhadas numa caixa só. Mesmo raciocínio
   * do funil no dashboard.
   *
   * `null` enquanto o perfil carrega: nesse intervalo não busca nada, em
   * vez de buscar sem filtro.
   */
  accountId: string | null;
  activeConversationId: string | null;
  onSelect: (conversation: Conversation) => void;
  conversations: Conversation[];
  onConversationsLoaded: (conversations: Conversation[]) => void;
  /**
   * Increment to force the fetch effect below to refire. The parent
   * bumps this on realtime reconnect / tab visibility → visible so the
   * list catches up on any events sent while the WS was disconnected
   * or the tab was throttled. Optional so existing callers keep working.
   */
  resyncToken?: number;
}

const STATUS_COLORS: Record<ConversationStatus, string> = {
  open: "bg-primary",
  pending: "bg-amber-500",
  closed: "bg-muted-foreground",
};

// Display-only labels for the status enum (values stay in English in the DB).
const STATUS_LABELS: Record<ConversationStatus, string> = {
  open: "Aberta",
  pending: "Pendente",
  closed: "Fechada",
};

// modo Ag�ncia: saúde da conta tinge a linha do chat (cor lateral) + pílula.
const HEALTH_STYLE: Record<
  string,
  { row: string; accent: string; pill: string; label: string; hint: string }
> = {
  estavel: {
    row: "bg-emerald-500/[0.06]",
    accent: "border-l-emerald-500",
    pill: "border-emerald-500/40 text-emerald-400",
    label: "Estável",
    hint: "Cliente saudável, sem sinais de risco.",
  },
  monitoramento: {
    row: "bg-amber-500/[0.06]",
    accent: "border-l-amber-500",
    pill: "border-amber-500/40 text-amber-400",
    label: "Monitoramento",
    hint: "Requer atenção: acompanhar de perto.",
  },
  churn: {
    row: "bg-red-500/[0.06]",
    accent: "border-l-red-500",
    pill: "border-red-500/40 text-red-400",
    label: "Possível churn",
    hint: "Risco de perder o cliente.",
  },
};

type InboxFilter = ConversationStatus | "all" | "unread";

const FILTER_OPTIONS: { label: string; value: InboxFilter }[] = [
  { label: "Todas", value: "all" },
  { label: "Não lidas", value: "unread" },
  { label: "Abertas", value: "open" },
  { label: "Pendentes", value: "pending" },
  { label: "Fechadas", value: "closed" },
];

export function ConversationList({
  accountId,
  activeConversationId,
  onSelect,
  conversations,
  onConversationsLoaded,
  resyncToken = 0,
}: ConversationListProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<InboxFilter>("all");
  const searchRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  // Contact-based filters (issue #272). Tags use OR logic (a conversation
  // matches if its contact carries any selected tag), consistent with
  // Broadcast audience filtering. Company is an exact match on the field.
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);

  // Keep the latest callback in a ref so the fetch effect below can
  // have a stable, empty-dep identity. Previously the fetch useCallback
  // depended on `onConversationsLoaded`, which depends on the parent's
  // `deepLinkConvId` — so every URL change (including one the parent
  // triggered via router.replace after a click) caused a fresh
  // conversations fetch. That extra refetch was the trigger for the
  // deep-link auto-select running a second time and wiping the active
  // thread's messages.
  // Mutation lives in an effect (not render) per React 19's refs rule;
  // the fetch runs once on mount so it's fine to read the slightly
  // older value — the very next render updates the ref for any
  // subsequent async completion.
  const onConversationsLoadedRef = useRef(onConversationsLoaded);
  useEffect(() => {
    onConversationsLoadedRef.current = onConversationsLoaded;
  });

  useEffect(() => {
    // Sem conta resolvida ainda: não busca. Buscar aqui traria as
    // conversas de todas as contas do usuário (ver comentário em
    // `accountId`, nas props).
    if (!accountId) return;
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select(CONVERSATION_SELECT)
        // A RLS libera qualquer conta da qual o usuário é membro, então
        // o recorte por cliente tem que ser explícito aqui.
        .eq("account_id", accountId)
        .order("last_message_at", { ascending: false })
        // Teto de segurança: sem isto a query carregava TODAS as
        // conversas da conta a cada fetch/poll.
        .limit(200);

      if (cancelled) return;

      if (error) {
        // Supabase errors have non-enumerable properties — log fields explicitly
        console.error("Failed to fetch conversations:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        // Feedback: sem isto, falha de carga parecia "nenhuma conversa".
        toast.error("Não foi possível carregar as conversas");
        setLoading(false);
        return;
      }

      onConversationsLoadedRef.current(normalizeConversations(data ?? []));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus — catches
    // up on any events sent while the WS was disconnected or throttled.
    // `accountId` refaz a busca ao trocar de cliente, senão a caixa
    // continuaria mostrando as conversas do cliente anterior.
  }, [resyncToken, accountId]);

  // Tag definitions for the filter picker — loaded once so labels/colours
  // stay stable regardless of which conversations happen to be loaded.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("tags").select("*").order("name");
      if (!cancelled && data) setTags(data as Tag[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Company options are derived from the loaded conversations — there's no
  // separate companies table, and only companies with a live conversation
  // are worth offering as an inbox filter.
  const companies = useMemo(() => {
    const set = new Set<string>();
    for (const c of conversations) {
      const co = c.contact?.company?.trim();
      if (co) set.add(co);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [conversations]);

  const tagsById = useMemo(() => {
    const m = new Map<string, Tag>();
    for (const t of tags) m.set(t.id, t);
    return m;
  }, [tags]);

  const filtered = useMemo(() => {
    let result = conversations;

    if (filter === "unread") {
      result = result.filter((c) => c.unread_count > 0);
    } else if (filter !== "all") {
      result = result.filter((c) => c.status === filter);
    }

    // Contact-based filters (tags via OR logic, exact company match).
    if (selectedTagIds.length > 0 || selectedCompany !== null) {
      result = result.filter((c) =>
        matchesContactFilters(c, {
          tagIds: selectedTagIds,
          company: selectedCompany,
        })
      );
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) => {
        const name = c.contact?.name?.toLowerCase() ?? "";
        const phone = c.contact?.phone?.toLowerCase() ?? "";
        const lastMsg = c.last_message_text?.toLowerCase() ?? "";
        return name.includes(q) || phone.includes(q) || lastMsg.includes(q);
      });
    }

    return result;
  }, [conversations, filter, search, selectedTagIds, selectedCompany]);

  const toggleTag = useCallback((id: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }, []);

  const clearContactFilters = useCallback(() => {
    setSelectedTagIds([]);
    setSelectedCompany(null);
  }, []);

  // Limpa TUDO (busca + status + filtros de contato) — usado no estado
  // "nenhum resultado" pra o usuário sair do beco sem hunt-and-peck.
  const clearAllFilters = useCallback(() => {
    setSearch("");
    setFilter("all");
    setSelectedTagIds([]);
    setSelectedCompany(null);
  }, []);

  const hasContactFilters = selectedTagIds.length > 0 || selectedCompany !== null;

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
    },
    []
  );

  const handleSelect = useCallback(
    (conv: Conversation) => {
      onSelect(conv);
    },
    [onSelect]
  );

  // Atalhos de teclado (eficiência pra quem atende volume):
  //   /        foca a busca
  //   ↑ / ↓    navega entre as conversas da lista
  // Ignora quando o foco está num campo de texto (não atrapalha digitação).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const typing =
        !!el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable);

      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !typing) {
        if (filtered.length === 0) return;
        e.preventDefault();
        const idx = filtered.findIndex((c) => c.id === activeConversationId);
        const next =
          e.key === "ArrowDown"
            ? Math.min(idx + 1, filtered.length - 1)
            : Math.max(idx - 1, 0);
        const target = filtered[idx === -1 ? 0 : next];
        if (target) onSelect(target);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtered, activeConversationId, onSelect]);

  const activeFilter = FILTER_OPTIONS.find((o) => o.value === filter);

  return (
    // w-full on mobile so the list occupies the whole viewport when it's
    // the single pane showing; fixed 320px on desktop where it shares the
    // row with the thread + contact sidebar.
    <div className="flex h-full w-full flex-col border-r border-[#191528] bg-[#080711] lg:w-[300px]">
      {/* Search + Filter */}
      <div className="flex flex-col gap-2 border-b border-[#191528] p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6f6688]" />
          <Input
            ref={searchRef}
            value={search}
            onChange={handleSearchChange}
            placeholder="Buscar conversa..."
            className="h-9 rounded-md border-[#191528] bg-[#11101d] pl-9 text-xs text-[#efeaff] placeholder:text-[#6f6688] focus:border-[#8800fb]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-center h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted">
                {activeFilter?.label ?? "Todas"}
                <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="border-border bg-popover"
            >
              {FILTER_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => setFilter(opt.value)}
                  className={cn(
                    "text-sm",
                    filter === opt.value
                      ? "text-primary"
                      : "text-popover-foreground"
                  )}
                >
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {tags.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                  selectedTagIds.length > 0
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Tags
                {selectedTagIds.length > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                    {selectedTagIds.length}
                  </span>
                )}
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-64 w-56 border-border bg-popover"
              >
                {tags.map((t) => (
                  <DropdownMenuCheckboxItem
                    key={t.id}
                    checked={selectedTagIds.includes(t.id)}
                    onCheckedChange={() => toggleTag(t.id)}
                    className="text-sm text-popover-foreground"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: t.color }}
                      />
                      <span className="truncate">{t.name}</span>
                    </span>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {companies.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex max-w-40 items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                  selectedCompany
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="truncate">{selectedCompany ?? "Empresa"}</span>
                <ChevronDown className="h-3 w-3 shrink-0" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-64 w-56 border-border bg-popover"
              >
                <DropdownMenuItem
                  onClick={() => setSelectedCompany(null)}
                  className={cn(
                    "text-sm",
                    selectedCompany === null
                      ? "text-primary"
                      : "text-popover-foreground"
                  )}
                >
                  Todas as empresas
                </DropdownMenuItem>
                {companies.map((co) => (
                  <DropdownMenuItem
                    key={co}
                    onClick={() => setSelectedCompany(co)}
                    className={cn(
                      "text-sm",
                      selectedCompany === co
                        ? "text-primary"
                        : "text-popover-foreground"
                    )}
                  >
                    <span className="truncate">{co}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {hasContactFilters && (
          <div className="flex flex-wrap items-center gap-1">
            {selectedTagIds.map((id) => {
              const tag = tagsById.get(id);
              return (
                <button
                  key={id}
                  onClick={() => toggleTag(id)}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground hover:bg-muted/70"
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: tag?.color ?? "var(--muted-foreground)" }}
                  />
                  <span className="max-w-24 truncate">{tag?.name ?? "Tag"}</span>
                  <X className="h-3 w-3" />
                </button>
              );
            })}
            {selectedCompany && (
              <button
                onClick={() => setSelectedCompany(null)}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground hover:bg-muted/70"
              >
                <span className="max-w-24 truncate">{selectedCompany}</span>
                <X className="h-3 w-3" />
              </button>
            )}
            <button
              onClick={clearContactFilters}
              className="px-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              Limpar tudo
            </button>
          </div>
        )}
      </div>

      {/* Conversation Items.
          `min-h-0` is load-bearing: a flex child defaults to
          min-height:auto, so without it this ScrollArea grows to fit
          every conversation instead of shrinking to the remaining
          space — the list then overflows and gets clipped by the
          parent's overflow-hidden with no scrollbar (issue #229). */}
      <ScrollArea className="min-h-0 flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-12 text-center">
            {conversations.length === 0 ? (
              <>
                <MessageSquare className="mx-auto mb-3 size-8 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">
                  Nenhuma conversa ainda
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  As conversas aparecem aqui assim que um contato escrever no
                  WhatsApp deste cliente.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Nenhuma conversa corresponde aos filtros.
                </p>
                <button
                  onClick={clearAllFilters}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted"
                >
                  <X className="size-3.5" />
                  Limpar filtros
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeConversationId}
                onSelect={handleSelect}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (conversation: Conversation) => void;
}

// Memoizado: numa lista com centenas de conversas, o polling/realtime
// re-renderizando a lista inteira a cada ciclo não pode custar N renders
// de item — só o que efetivamente mudou (via mergeConversations, que
// preserva a referência de objeto das conversas inalteradas) deve
// re-renderizar. Só funciona porque `onSelect` (o `handleSelect` do
// ConversationList) é estável entre renders.
const ConversationItem = memo(function ConversationItem({
  conversation,
  isActive,
  onSelect,
}: ConversationItemProps) {
  const contact = conversation.contact;
  const isGroup = Boolean(contact?.is_group);
  const displayName =
    contact?.name || (isGroup ? "Grupo" : contact?.phone) || "Desconhecido";
  const initials = displayName.charAt(0).toUpperCase();
  const health = conversation.health
    ? HEALTH_STYLE[conversation.health]
    : undefined;

  const handleClick = useCallback(() => {
    onSelect(conversation);
  }, [onSelect, conversation]);

  const timeAgo = conversation.last_message_at
    ? formatDistanceToNow(new Date(conversation.last_message_at), {
        addSuffix: false,
        locale: ptBR,
      })
    : "";

  return (
    <button
      onClick={handleClick}
      className={cn(
        "flex w-full items-start gap-3 border-l-2 border-l-transparent px-3 py-3 text-left transition-colors hover:bg-[#120f1f]",
        // Saúde tinge a linha (cor lateral do grupo). Ativo mantém o
        // realce roxo, mas o tom de saúde continua no fundo.
        health && health.row,
        health && !isActive && health.accent,
        isActive && "border-l-[#8800fb] bg-[#1a0b31]"
      )}
    >
      {/* Avatar */}
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#151324] text-xs font-semibold text-[#e9ddff]">
        {contact?.avatar_url ? (
          <img
            src={contact.avatar_url}
            alt={displayName}
            className="h-9 w-9 rounded-full object-cover"
          />
        ) : isGroup ? (
          <Users className="h-5 w-5 text-muted-foreground" />
        ) : (
          initials
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold text-[#f0ecff]">
            {displayName}
          </span>
          <span className="shrink-0 text-[10px] text-[#706787]">{timeAgo}</span>
        </div>
        {health ? (
          <span
            title={health.hint}
            className={cn(
              "mt-1 inline-flex rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase",
              health.pill
            )}
          >
            {health.label}
          </span>
        ) : null}
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="truncate text-xs text-[#8b82a5]">
            {conversation.last_message_text || "Nenhuma mensagem ainda"}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            {/* tabular-nums no contador: ele muda sozinho e, sem isso, a
                largura dança a cada mensagem nova. */}
            {conversation.unread_count > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold tabular-nums text-primary-foreground">
                {conversation.unread_count}
              </span>
            )}
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                STATUS_COLORS[conversation.status]
              )}
              title={STATUS_LABELS[conversation.status]}
            />
          </div>
        </div>
      </div>
    </button>
  );
});
