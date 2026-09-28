"use client";

import {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { usePresence } from "@/hooks/use-presence";
import { PresenceDot } from "@/components/presence/presence-dot";
import { presenceLabel } from "@/lib/presence";
import { cn } from "@/lib/utils";
import type {
  Conversation,
  Message,
  MessageReaction,
  Contact,
  ConversationStatus,
  MessageTemplate,
  Profile,
} from "@/types";
import {
  MessageSquare,
  ChevronDown,
  UserPlus,
  Check,
  Clock,
  ArrowLeft,
  RefreshCw,
  PanelRightOpen,
  PanelRightClose,
  Trash2,
} from "lucide-react";
import { format, isToday, isYesterday, differenceInHours } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MessageBubble } from "./message-bubble";
import { MessageActions } from "./message-actions";
import {
  MessageComposer,
  CHAT_MEDIA_BUCKET,
  type SendMediaPayload,
} from "./message-composer";
import { deleteAccountMedia } from "@/lib/storage/upload-media";
import { TemplatePicker } from "./template-picker";
import { buildReplyPreview } from "./reply-quote";
import { toast } from "sonner";

interface ReplyDraft {
  id: string;
  authorLabel: string;
  preview: string;
}

function renderTemplateBody(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw) => {
    const idx = Number(raw) - 1;
    return params[idx] ?? `{{${raw}}}`;
  });
}

interface MessageThreadProps {
  conversation: Conversation | null;
  contact: Contact | null;
  messages: Message[];
  onMessagesLoaded: (messages: Message[]) => void;
  onNewMessage: (message: Message) => void;
  onUpdateMessage: (id: string, updates: Partial<Message>) => void;
  onRemoveMessage: (id: string) => void;
  onStatusChange: (conversationId: string, status: ConversationStatus) => void;
  onAssignChange: (
    conversationId: string,
    assignedAgentId: string | null
  ) => void;
  /**
   * On mobile, the thread is shown full-screen with the conversation list
   * hidden. This callback lets the page deselect the active conversation
   * and reveal the list again. Rendered as a back-arrow in the header on
   * mobile only.
   */
  onBack?: () => void;
  /**
   * Increment to force the messages + reactions fetch effects to refire.
   * Parent bumps this on realtime reconnect / tab visibility → visible
   * so the open thread catches up on any events sent while the WS was
   * disconnected or the tab was throttled. Optional so existing callers
   * keep working.
   */
  resyncToken?: number;
  /**
   * Fired by the manual-refresh button in the thread header. The parent
   * typically bumps the same `resyncToken` it controls — this gives the
   * user a way to force a refetch when they suspect realtime missed an
   * event (or they're impatient). Optional so existing callers keep
   * working; the button is only rendered when this is provided.
   */
  onRefresh?: () => void;
  /**
   * Desktop-only contact-panel toggle. The page owns the open/closed
   * state (it's the one that renders the sidebar), so the thread just
   * reflects it and asks the page to flip it. Both optional so existing
   * callers keep working; the toggle button only renders when
   * `onToggleContactPanel` is wired up.
   */
  contactPanelOpen?: boolean;
  onToggleContactPanel?: () => void;
}

function formatDateSeparator(dateStr: string): string {
  const date = new Date(dateStr);
  if (isToday(date)) return "Hoje";
  if (isYesterday(date)) return "Ontem";
  return format(date, "d 'de' MMMM 'de' yyyy", { locale: ptBR });
}

function groupMessagesByDate(messages: Message[]) {
  const groups: { date: string; messages: Message[] }[] = [];
  let currentDate = "";

  for (const msg of messages) {
    const day = format(new Date(msg.created_at), "yyyy-MM-dd");
    if (day !== currentDate) {
      currentDate = day;
      groups.push({ date: msg.created_at, messages: [msg] });
    } else {
      groups[groups.length - 1].messages.push(msg);
    }
  }

  return groups;
}

const STATUS_OPTIONS: {
  label: string;
  value: ConversationStatus;
  color: string;
}[] = [
  { label: "Aberta", value: "open", color: "text-primary" },
  { label: "Pendente", value: "pending", color: "text-amber-400" },
  { label: "Fechada", value: "closed", color: "text-muted-foreground" },
];

/**
 * WhatsApp-style doodle background applied to the chat area (both the
 * active thread and the empty state). The SVG tile lives at
 * `/public/inbox-doodle.svg`; the slate-950 colour sits underneath so
 * the doodles read as a subtle pattern rather than a stark grid.
 *
 * Defined once at module scope so the two render paths can't drift —
 * if we ever switch the asset, both spots update together.
 */
const DOODLE_BG_CLASSES = "bg-[#0b0913]";

export function MessageThread({
  conversation,
  contact,
  messages,
  onMessagesLoaded,
  onNewMessage,
  onUpdateMessage,
  onRemoveMessage,
  onStatusChange,
  onAssignChange,
  onBack,
  resyncToken = 0,
  onRefresh,
  contactPanelOpen,
  onToggleContactPanel,
}: MessageThreadProps) {
  const { user, accountId, accountRole } = useAuth();
  // Apagar conversa e' de owner/admin. A checagem aqui so ESCONDE o
  // botao; quem garante e a rota, que repete a verificacao no servidor.
  const podeApagar = accountRole === "owner" || accountRole === "admin";
  const [confirmarApagar, setConfirmarApagar] = useState(false);
  const [apagando, setApagando] = useState(false);

  // A janela de 24h é regra da API OFICIAL da Meta, não do WhatsApp.
  // Quando a conta atende por uma instância Evolution conectada, ela não
  // existe: dá para mandar texto livre a qualquer momento, e modelo é
  // que NÃO dá (send-message.ts recusa template no caminho da Evolution).
  // Sem esta checagem, o atendente via "sessão expirada" e era empurrado
  // para Modelos, que ia falhar. Fonte da verdade é a mesma do envio: a
  // conta tem instância com status `connected`.
  const [viaEvolution, setViaEvolution] = useState(false);
  useEffect(() => {
    if (!accountId) return;
    let stop = false;
    fetch("/api/whatsapp/evolution/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((body: { connected?: boolean }) => {
        if (!stop) setViaEvolution(!!body?.connected);
      })
      .catch(() => {
        // Sem resposta, mantém a janela ligada: errar para o lado
        // restritivo evita um envio que a Meta recusaria.
      });
    return () => {
      stop = true;
    };
  }, [accountId]);
  const { getPresence, getRow, now } = usePresence();
  const [loading, setLoading] = useState(false);
  // Revalidação (refetch com a thread já carregada) NÃO usa `loading` — só
  // a primeira carga de uma conversa pode desmontar a subárvore de
  // mensagens pro spinner. Ver o efeito de fetch abaixo.
  const [revalidating, setRevalidating] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const initiallyScrolledConversationRef = useRef<string | null>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  // Purely visual spin state for the manual-refresh button. The actual
  // refetch is fire-and-forget through `onRefresh` (which bumps the
  // parent's resyncToken); the 700ms spin is just feedback so the click
  // doesn't feel like a no-op. Cleared via the timer ref on unmount.
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);
  const refreshingRef = useRef(false);
  const prevLoadingRef = useRef(false);
  const handleApagarConversa = useCallback(async () => {
    if (!conversation) return;
    setApagando(true);
    try {
      const res = await fetch(`/api/conversations/${conversation.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const corpo = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        toast.error(corpo?.error ?? "Nao foi possivel apagar a conversa.");
        return;
      }
      toast.success("Conversa apagada do CRM.");
      setConfirmarApagar(false);
      // Volta para a lista: a conversa aberta deixou de existir, e
      // continuar mostrando as mensagens dela seria uma tela mentindo.
      onBack?.();
      onRefresh?.();
    } catch {
      toast.error("Nao foi possivel apagar a conversa.");
    } finally {
      setApagando(false);
    }
  }, [conversation, onBack, onRefresh]);

  const handleRefreshClick = useCallback(() => {
    if (isRefreshing || !onRefresh) return;
    setIsRefreshing(true);
    refreshingRef.current = true;
    onRefresh();
    // Rede de segurança: se o refetch não sinalizar (token igual, etc.),
    // para o spin após 6s pra não girar pra sempre.
    refreshTimerRef.current = setTimeout(() => {
      setIsRefreshing(false);
      refreshingRef.current = false;
      refreshTimerRef.current = null;
    }, 6000);
  }, [isRefreshing, onRefresh]);
  // Para o spin quando o refetch REAL termina (loading vai de true -> false),
  // em vez de um tempo fixo que mente em rede lenta.
  useEffect(() => {
    if (prevLoadingRef.current && !loading && refreshingRef.current) {
      refreshingRef.current = false;
      setIsRefreshing(false);
      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    }
    prevLoadingRef.current = loading;
  }, [loading]);
  const [replyTo, setReplyTo] = useState<ReplyDraft | null>(null);

  // Profiles are bounded by RLS to rows the current user is allowed to
  // see — today that's just the current user, but the dropdown keeps the
  // shape ready for shared-team workspaces without a refactor.
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("*")
      .order("full_name")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("Failed to fetch profiles:", error);
          return;
        }
        setProfiles((data as Profile[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 24-hour session timer. Só se aplica à API oficial da Meta: pela
  // Evolution não há janela, então nada expira e o contador some.
  const sessionInfo = useMemo(() => {
    if (viaEvolution) return { expired: false, remaining: "" };
    if (!messages.length) return { expired: false, remaining: "" };

    // Find last customer message
    const lastCustomerMsg = [...messages]
      .reverse()
      .find((m) => m.sender_type === "customer");

    if (!lastCustomerMsg)
      return { expired: true, remaining: "Sem mensagens do cliente" };

    const hoursSince = differenceInHours(
      new Date(),
      new Date(lastCustomerMsg.created_at)
    );
    const expired = hoursSince >= 24;

    if (expired) {
      return { expired: true, remaining: "Expirada" };
    }

    const hoursLeft = 24 - hoursSince;
    const remaining =
      hoursLeft >= 1
        ? `${Math.floor(hoursLeft)}h restantes`
        : `${Math.floor(hoursLeft * 60)}m restantes`;

    return { expired, remaining };
  }, [messages, viaEvolution]);

  // Store latest callback in a ref so fetchMessages doesn't need to
  // depend on `onMessagesLoaded` — otherwise parent re-renders cause
  // fetchMessages to change → useEffect re-fires → refetch → realtime
  // UPDATE on conversations.unread_count → parent re-renders → LOOP.
  // The ref is written inside an effect so the mutation doesn't happen
  // during render (React 19 refs rule); consumers only read `.current`
  // inside the async fetch completion, which runs after the render.
  const onMessagesLoadedRef = useRef(onMessagesLoaded);
  useEffect(() => {
    onMessagesLoadedRef.current = onMessagesLoaded;
  });

  const conversationId = conversation?.id;
  const hasUnread = (conversation?.unread_count ?? 0) > 0;

  // Espelho (em ref) de "já tem mensagem na tela para esta conversa" — lido
  // (não "dependido") pelo efeito de fetch abaixo pra decidir entre
  // `loading` e `revalidating` sem colocar `messages` nas deps do efeito
  // (o que faria toda bolha otimista / patch de realtime re-disparar o
  // fetch). Mesmo padrão do `onMessagesLoadedRef` acima.
  const hasMessagesRef = useRef(false);
  useEffect(() => {
    hasMessagesRef.current = messages.length > 0;
  });

  // Opening a thread should start at its latest message. This is separate
  // from the new-message auto-scroll below because, during the first load,
  // scrollTop is still zero and therefore does not count as "near the end".
  useLayoutEffect(() => {
    if (!conversationId || loading || messages.length === 0) return;
    if (initiallyScrolledConversationRef.current === conversationId) return;

    const frame = requestAnimationFrame(() => {
      const element = scrollRef.current;
      if (!element) return;
      element.scrollTop = element.scrollHeight;
      initiallyScrolledConversationRef.current = conversationId;
    });

    return () => cancelAnimationFrame(frame);
  }, [conversationId, loading, messages.length]);

  // Fetch messages whenever the selected conversation changes. Kept
  // separate from the unread-reset effect so that incoming messages
  // arriving while the thread is open don't trigger a full refetch —
  // they only flip hasUnread, which only the reset effect listens to.
  useEffect(() => {
    if (!conversationId) return;

    const supabase = createClient();
    let cancelled = false;

    (async () => {
      // Só a PRIMEIRA carga de uma conversa pode acionar o spinner (que
      // desmonta a subárvore de mensagens no render abaixo). Todo refetch
      // subsequente (polling, resync) é uma revalidação silenciosa — a
      // tela não pode piscar nem redisparar o download de mídia já
      // carregada.
      if (hasMessagesRef.current) {
        setRevalidating(true);
      } else {
        setLoading(true);
      }

      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        // Teto de segurança: sem isto a query carregava a conversa
        // inteira a cada fetch. Paginação de histórico fica para outra
        // rodada (ver "Fora de escopo" no plano).
        .order("created_at", { ascending: false })
        .limit(200);

      if (cancelled) return;

      if (error) {
        console.error("Failed to fetch messages:", error);
        // Feedback: sem isto, uma falha de carga parecia "conversa vazia".
        toast.error("Não foi possível carregar as mensagens");
      } else {
        // A query acima vem mais-recente-primeiro (por causa do
        // `.limit`); inverte no cliente para a ordem cronológica normal.
        onMessagesLoadedRef.current((data ?? []).slice().reverse());
      }

      if (!cancelled) {
        setLoading(false);
        setRevalidating(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus —
    // realtime is best-effort and any message events sent while the WS
    // was disconnected or throttled are otherwise lost.
  }, [conversationId, resyncToken]);

  // Reactions fetch — pulls the current state from the DB. Kept separate
  // from the channel subscription below so a `resyncToken` bump just
  // refetches the rows without also tearing down and rebuilding the
  // realtime channel.
  useEffect(() => {
    if (!conversationId) {
      setReactions([]);
      return;
    }
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("message_reactions")
        .select("*")
        .eq("conversation_id", conversationId);
      if (cancelled) return;
      if (error) {
        console.error("Failed to fetch reactions:", error);
        return;
      }
      setReactions((data as MessageReaction[]) ?? []);
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, resyncToken]);

  // Reactions realtime subscription per conversation. Subscribing here
  // (not at the page level) keeps the channel scoped to the visible
  // conversation and avoids cross-conversation chatter on a busy inbox.
  useEffect(() => {
    if (!conversationId) return;
    const supabase = createClient();

    const channel = supabase
      .channel(`reactions:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as MessageReaction;
          setReactions((prev) => {
            if (prev.some((r) => r.id === row.id)) return prev;
            // Swap any matching optimistic temp row for the real one so
            // the pill doesn't double up after a successful POST.
            const tempIdx = prev.findIndex(
              (r) =>
                r.id.startsWith("temp-") &&
                r.message_id === row.message_id &&
                r.actor_type === row.actor_type &&
                r.actor_id === row.actor_id
            );
            if (tempIdx >= 0) {
              const copy = prev.slice();
              copy[tempIdx] = row;
              return copy;
            }
            return [...prev, row];
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as MessageReaction;
          setReactions((prev) => prev.map((r) => (r.id === row.id ? row : r)));
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const old = payload.old as Partial<MessageReaction>;
          if (!old?.id) return;
          setReactions((prev) => prev.filter((r) => r.id !== old.id));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  // Clear any in-progress reply draft when the active conversation changes —
  // a quote pulled from conversation A shouldn't bleed into conversation B.
  useEffect(() => {
    setReplyTo(null);
  }, [conversationId]);

  // Reset the server-side unread_count to 0 whenever an unread count
  // surfaces on the active conversation — covers both (a) opening a
  // conversation that had unread messages and (b) new messages arriving
  // while the user is already viewing the thread (webhook server-bumps
  // unread_count to N+1; the realtime UPDATE propagates it into the
  // client, which re-runs this effect and flips it back to 0).
  //
  // Guarding on hasUnread prevents the eq-update loop: once unread_count
  // is 0 the condition is false, so no further UPDATE is issued.
  useEffect(() => {
    if (!conversationId || !hasUnread) return;
    const supabase = createClient();
    supabase
      .from("conversations")
      .update({ unread_count: 0 })
      .eq("id", conversationId)
      .then(({ error }) => {
        if (error) console.error("Failed to reset unread_count:", error);
      });
  }, [conversationId, hasUnread]);

  // Auto-scroll para o fim em mensagens novas — mas SÓ se o agente já
  // estiver perto do fim. Se ele rolou pra cima pra reler o histórico, não
  // arrancamos a tela dele de volta pro fim (controle do usuário).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 160) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const handleSend = useCallback(
    async (text: string, replyToId?: string): Promise<boolean> => {
      if (!conversation) return false;

      const tempId = `temp-${Date.now()}`;

      // Optimistic update — shows the message immediately with "sending" status
      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        content_type: "text",
        content_text: text,
        status: "sending",
        created_at: new Date().toISOString(),
        reply_to_message_id: replyToId,
      };
      onNewMessage(optimisticMsg);
      setReplyTo(null);

      try {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: "text",
            content_text: text,
            reply_to_message_id: replyToId,
          }),
        });

        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = payload?.error || `HTTP ${res.status}`;
          console.error("Failed to send message:", reason);
          toast.error(`Falha ao enviar: ${reason}`);
          // Texto: remove a bolha otimista (o composer restaura o texto pra
          // reenviar), pra não deixar uma bolha falhada órfã junto do texto.
          onRemoveMessage(tempId);
          return false;
        }

        // Success — the realtime INSERT event will replace the temp bubble
        // with the real DB row. If realtime hasn't arrived yet, at least
        // flip status to 'sent' so the UI stops showing "sending".
        onUpdateMessage(tempId, { status: "sent" });
        return true;
      } catch (err) {
        console.error("Failed to send message:", err);
        const reason = err instanceof Error ? err.message : "erro de rede";
        toast.error(`Falha ao enviar: ${reason}`);
        onRemoveMessage(tempId);
        return false;
      }
    },
    [conversation, onNewMessage, onUpdateMessage, onRemoveMessage]
  );

  const handleSendMedia = useCallback(
    async (payload: SendMediaPayload) => {
      if (!conversation) return;

      // Documents show their filename in our own bubble (and to the
      // recipient as the Meta caption when no caption was typed); other
      // kinds use the caption as-is. Audio carries no caption.
      const contentText =
        payload.kind === "document"
          ? payload.caption || payload.filename || "Documento"
          : payload.caption;

      const tempId = `temp-${Date.now()}`;
      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        content_type: payload.kind,
        content_text: contentText,
        media_url: payload.mediaUrl,
        status: "sending",
        created_at: new Date().toISOString(),
        reply_to_message_id: payload.replyToId,
      };
      onNewMessage(optimisticMsg);
      setReplyTo(null);

      try {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: payload.kind,
            media_url: payload.mediaUrl,
            content_text: contentText,
            filename: payload.filename,
            reply_to_message_id: payload.replyToId,
          }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = data?.error || `HTTP ${res.status}`;
          console.error("Failed to send media:", reason);
          toast.error(`Falha ao enviar: ${reason}`);
          onUpdateMessage(tempId, { status: "failed" });
          // The upload never reached the recipient — GC the orphaned
          // object rather than leaving it in the public bucket forever.
          void deleteAccountMedia(CHAT_MEDIA_BUCKET, payload.path).catch(
            () => {}
          );
          return;
        }

        onUpdateMessage(tempId, { status: "sent" });
      } catch (err) {
        console.error("Failed to send media:", err);
        const reason = err instanceof Error ? err.message : "erro de rede";
        toast.error(`Falha ao enviar: ${reason}`);
        onUpdateMessage(tempId, { status: "failed" });
        void deleteAccountMedia(CHAT_MEDIA_BUCKET, payload.path).catch(
          () => {}
        );
      }
    },
    [conversation, onNewMessage, onUpdateMessage]
  );

  const handleStatusChange = useCallback(
    async (status: ConversationStatus) => {
      if (!conversation) return;

      const supabase = createClient();
      const { error } = await supabase
        .from("conversations")
        .update({ status })
        .eq("id", conversation.id);

      // Sem checar o erro, a UI mostrava o novo status mas o banco ficava no
      // antigo (divergência silenciosa). Só reflete na UI se salvou mesmo.
      if (error) {
        console.error("Failed to update status:", error);
        toast.error("Não foi possível mudar o status da conversa");
        return;
      }
      toast.success("Status atualizado");
      onStatusChange(conversation.id, status);
    },
    [conversation, onStatusChange]
  );

  const handleOpenTemplates = useCallback(() => {
    setTemplateModalOpen(true);
  }, []);

  const handleSendTemplate = useCallback(
    async (
      template: MessageTemplate,
      values: {
        body: string[];
        headerText?: string;
        buttonParams?: Record<number, string>;
      }
    ) => {
      if (!conversation) return;

      const renderedBody = renderTemplateBody(template.body_text, values.body);
      const tempId = `temp-${Date.now()}`;

      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        content_type: "template",
        content_text: renderedBody,
        template_name: template.name,
        status: "sending",
        created_at: new Date().toISOString(),
      };
      onNewMessage(optimisticMsg);

      try {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: "template",
            template_name: template.name,
            template_language: template.language,
            // Structured params drive the new send-builder path
            // (header media + URL button substitution). Body values
            // are mirrored under both shapes so the route can fall
            // back if the template row isn't found locally.
            template_message_params: {
              body: values.body,
              headerText: values.headerText,
              buttonParams: values.buttonParams,
            },
            template_params: values.body,
            content_text: renderedBody,
          }),
        });

        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = payload?.error || `HTTP ${res.status}`;
          console.error("Failed to send template:", reason);
          toast.error(`Falha ao enviar modelo: ${reason}`);
          onUpdateMessage(tempId, { status: "failed" });
          return;
        }

        onUpdateMessage(tempId, { status: "sent" });
      } catch (err) {
        console.error("Failed to send template:", err);
        const reason = err instanceof Error ? err.message : "erro de rede";
        toast.error(`Falha ao enviar modelo: ${reason}`);
        onUpdateMessage(tempId, { status: "failed" });
      }
    },
    [conversation, onNewMessage, onUpdateMessage]
  );

  // Build a quick id → Message map so reply quotes can be rendered without
  // an extra fetch — the thread already holds the full conversation.
  const messagesById = useMemo(() => {
    const map = new Map<string, Message>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  // Bucket reactions by their target message_id for O(1) per-bubble lookup.
  const reactionsByMessageId = useMemo(() => {
    const map = new Map<string, MessageReaction[]>();
    for (const r of reactions) {
      const bucket = map.get(r.message_id);
      if (bucket) bucket.push(r);
      else map.set(r.message_id, [r]);
    }
    return map;
  }, [reactions]);

  const contactDisplayName = contact?.name || contact?.phone || "Cliente";

  // Author label for a quoted message: "You" when we sent the parent,
  // contact name when the customer sent it.
  const authorLabelFor = useCallback(
    (m: Message): string => {
      const isAgentMsg = m.sender_type === "agent" || m.sender_type === "bot";
      return isAgentMsg ? "Você" : contactDisplayName;
    },
    [contactDisplayName]
  );

  const handleStartReply = useCallback(
    (msg: Message) => {
      setReplyTo({
        id: msg.id,
        authorLabel: authorLabelFor(msg),
        preview: buildReplyPreview(msg),
      });
    },
    [authorLabelFor]
  );

  // Single reaction-set primitive. emoji === "" removes; otherwise adds/swaps.
  // The "toggle" semantic (pill click) is computed at the call site where the
  // current reactions for the bubble are already in scope — keeps this
  // function dependency-free w.r.t. the reaction list.
  const postReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!user?.id || !conversation) {
        console.warn("[reactions] missing user or conversation");
        return;
      }
      if (messageId.startsWith("temp-")) {
        toast.error("Aguarde a mensagem terminar de enviar");
        return;
      }

      const convId = conversation.id;
      const userId = user.id;
      let snapshot: MessageReaction[] = [];

      // Functional updater — captures the freshest reactions list, never a
      // stale closure. Snapshot stored for rollback on POST failure.
      setReactions((prev) => {
        snapshot = prev;
        const own = prev.find(
          (r) =>
            r.message_id === messageId &&
            r.actor_type === "agent" &&
            r.actor_id === userId
        );
        if (emoji === "") return own ? prev.filter((r) => r !== own) : prev;
        if (own) return prev.map((r) => (r === own ? { ...own, emoji } : r));
        return [
          ...prev,
          {
            id: `temp-${Date.now()}`,
            message_id: messageId,
            conversation_id: convId,
            actor_type: "agent",
            actor_id: userId,
            emoji,
            created_at: new Date().toISOString(),
          },
        ];
      });

      try {
        const res = await fetch("/api/whatsapp/react", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message_id: messageId, emoji }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.error || `HTTP ${res.status}`);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : "erro de rede";
        toast.error(`Falha na reação: ${reason}`);
        setReactions(snapshot);
      }
    },
    [conversation, user?.id]
  );

  const handleAssignChange = useCallback(
    async (agentId: string | null) => {
      if (!conversation) return;

      const supabase = createClient();
      const { error } = await supabase
        .from("conversations")
        .update({ assigned_agent_id: agentId })
        .eq("id", conversation.id);

      if (error) {
        console.error("Failed to update assignment:", error);
        toast.error("Falha ao atualizar a atribuição");
        return;
      }

      onAssignChange(conversation.id, agentId);
    },
    [conversation, onAssignChange]
  );

  // Empty state — same WhatsApp-style doodle background as the active
  // thread below, so swapping between empty/selected doesn't change the
  // pattern under the user's eye.
  if (!conversation || !contact) {
    return (
      <div
        className={cn(
          "flex flex-1 flex-col items-center justify-center",
          DOODLE_BG_CLASSES
        )}
      >
        <div className="bg-muted flex h-16 w-16 items-center justify-center rounded-full">
          <MessageSquare className="text-muted-foreground h-8 w-8" />
        </div>
        <h3 className="text-muted-foreground mt-4 text-sm font-medium">
          Selecione uma conversa
        </h3>
        <p className="text-muted-foreground mt-1 text-xs">
          Escolha uma conversa à esquerda para começar a conversar
        </p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const messageGroups = groupMessagesByDate(messages);
  const currentStatus = STATUS_OPTIONS.find(
    (s) => s.value === conversation.status
  );
  const assignedAgentId = conversation.assigned_agent_id ?? null;
  const currentAssignee = profiles.find((p) => p.user_id === assignedAgentId);
  const assignLabel = assignedAgentId
    ? (currentAssignee?.full_name ?? "Atribuída")
    : "Atribuir";

  return (
    // `min-w-0` is load-bearing: the page already puts min-w-0 on the
    // thread's flex *wrapper* (issue #165), but this root keeps the
    // default `min-width: auto`, so a single wide message (long unbroken
    // URL/word) expands the whole thread past its flex share and the chat
    // paints on top of the contact sidebar at lg+ — outgoing bubbles get
    // clipped and the hover toolbar overlaps the Tags panel. Letting the
    // root shrink lets the bubbles' break-words / max-w caps apply.
    // Issue #257.
    <div className={cn("flex min-w-0 flex-1 flex-col", DOODLE_BG_CLASSES)}>
      {/* Header — solid card surface sits on top of the doodle so the
          name/avatar/dropdowns stay legible. */}
      <div className="flex h-14 items-center justify-between gap-2 border-b border-[#191528] bg-[#0d0b16] px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          {/* Back-to-list button — mobile only. Hidden on lg+ where the
              conversation list is always visible next to the thread. */}
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Voltar às conversas"
              className="text-muted-foreground hover:bg-muted hover:text-foreground flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md lg:hidden"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          {/* Foto do contato. A inicial fica como reserva — e é o que
              aparecia SEMPRE aqui antes, porque este cabeçalho nunca
              tinha usado `avatar_url`. A lista de conversas e o painel
              do contato já mostravam a foto, então o mesmo contato
              aparecia com foto à esquerda e com letra aqui em cima. */}
          <div className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-emerald-500/20 text-sm font-bold text-emerald-300 ring-1 ring-emerald-400/30">
            {/* A inicial fica SEMPRE embaixo, e a foto por cima. Assim,
                se a imagem falhar em carregar, basta escondê-la e a
                inicial reaparece — num ternário ela não voltaria, porque
                só existiria no outro ramo. Importa porque a URL de foto
                do WhatsApp expira. */}
            <span aria-hidden>{displayName.charAt(0).toUpperCase()}</span>
            {contact.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={contact.avatar_url}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            ) : null}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-[#f1edff]">
              {displayName}
            </h2>
            <p className="truncate text-xs text-[#8f86a8]">{contact.phone}</p>
          </div>
          {/* Session timer badge — hidden on the narrowest phones so
              the name + back arrow keep their room, e some por completo
              quando não há janela para contar (Evolution). Sem isso
              sobrava um selo só com o relógio e nenhum texto. */}
          {sessionInfo.remaining ? (
            <Badge
              variant="outline"
              className={cn(
                "ml-1 hidden gap-1 rounded-full border-[#163d2c] bg-emerald-500/10 text-[10px] font-bold uppercase sm:ml-2 sm:inline-flex",
                sessionInfo.expired ? "border-red-500/40 text-red-400" : "text-emerald-300"
              )}
            >
              <Clock className="h-3 w-3" />
              {sessionInfo.remaining}
            </Badge>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {/* Contact-panel toggle — desktop only. The contact sidebar
              eats a chunk of horizontal width that crowds the thread on
              smaller laptops; this lets agents reclaim it when they just
              want to read and reply. Hidden on mobile, where the sidebar
              never renders as a permanent panel anyway. Issue #258. */}
          {onToggleContactPanel && (
            <button
              type="button"
              onClick={onToggleContactPanel}
              aria-label={
                contactPanelOpen
                  ? "Ocultar painel do contato"
                  : "Mostrar painel do contato"
              }
              aria-pressed={contactPanelOpen}
              title={contactPanelOpen ? "Ocultar contato" : "Mostrar contato"}
              className={cn(
                "hover:bg-muted hover:text-foreground hidden h-7 w-7 items-center justify-center rounded-md transition-colors lg:inline-flex",
                contactPanelOpen ? "text-primary" : "text-muted-foreground"
              )}
            >
              {contactPanelOpen ? (
                <PanelRightClose className="h-4 w-4" />
              ) : (
                <PanelRightOpen className="h-4 w-4" />
              )}
            </button>
          )}

          {/* Manual refresh — forces a refetch of the messages + the
              conversation list (the parent bumps its resyncToken). Useful
              when realtime missed an event or the agent just wants to be
              sure nothing's stale. Only rendered when the parent wires
              up `onRefresh`. */}
          {onRefresh && (
            <button
              type="button"
              onClick={handleRefreshClick}
              disabled={isRefreshing}
              aria-label="Atualizar conversa"
              title="Atualizar"
              className={cn(
                "text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:opacity-60"
              )}
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")}
              />
            </button>
          )}

          {/* Status dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "hover:bg-muted inline-flex h-7 items-center justify-center gap-1 rounded-md px-2 text-xs",
                currentStatus?.color ?? "text-muted-foreground"
              )}
            >
              {currentStatus?.label ?? "Status"}
              <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="border-border bg-popover"
            >
              {STATUS_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => handleStatusChange(opt.value)}
                  className={cn("text-sm", opt.color)}
                >
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Assign dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "hover:bg-muted inline-flex h-7 items-center justify-center gap-1 rounded-md px-2 text-xs",
                assignedAgentId ? "text-primary" : "text-muted-foreground"
              )}
            >
              <UserPlus className="h-3 w-3" />
              <span className="hidden sm:inline">{assignLabel}</span>
              <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="border-border bg-popover"
            >
              {profiles.length === 0 ? (
                <DropdownMenuItem
                  disabled
                  className="text-muted-foreground text-sm"
                >
                  Nenhum colega disponível
                </DropdownMenuItem>
              ) : (
                profiles.map((p) => {
                  const isSelected = p.user_id === assignedAgentId;
                  const presence = getPresence(p.user_id);
                  return (
                    <DropdownMenuItem
                      key={p.id}
                      onClick={() => handleAssignChange(p.user_id)}
                      className={cn(
                        "text-sm",
                        isSelected ? "text-primary" : "text-popover-foreground"
                      )}
                    >
                      <PresenceDot
                        status={presence}
                        label={presenceLabel(
                          presence,
                          getRow(p.user_id)?.last_seen_at ?? null,
                          now
                        )}
                        className="mr-2"
                      />
                      <span className="flex-1">
                        {p.full_name}
                        {p.user_id === user?.id ? " (eu)" : ""}
                      </span>
                      {isSelected && <Check className="ml-2 h-3 w-3" />}
                    </DropdownMenuItem>
                  );
                })
              )}
              {assignedAgentId && (
                <>
                  <DropdownMenuSeparator className="bg-border" />
                  <DropdownMenuItem
                    onClick={() => handleAssignChange(null)}
                    className="text-muted-foreground text-sm"
                  >
                    Remover atribuição
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Apagar conversa — só owner/admin. Fica separado do menu de
              status de propósito: status é rotina, apagar não tem
              desfazer. Um item destrutivo dentro do mesmo menu de uso
              diário é convite para clique errado. */}
          {podeApagar && (
            <button
              type="button"
              onClick={() => setConfirmarApagar(true)}
              disabled={apagando}
              aria-label="Apagar conversa do CRM"
              title="Apagar conversa do CRM"
              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Confirmação. O texto diz explicitamente o que NÃO acontece —
          a dúvida de quem clica é "isso apaga no celular do cliente?". */}
      <AlertDialog open={confirmarApagar} onOpenChange={setConfirmarApagar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar esta conversa do CRM?</AlertDialogTitle>
            <AlertDialogDescription>
              A conversa com <strong>{displayName}</strong> e todas as suas
              mensagens saem <strong>deste CRM</strong>. Nada é apagado no
              WhatsApp: o histórico continua no aparelho do cliente e no seu.
              <br />
              <br />
              Não há como desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={apagando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleApagarConversa}
              disabled={apagando}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {apagando ? "Apagando…" : "Apagar do CRM"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Barra fina de revalidação: sinaliza o refetch em andamento SEM
          desmontar a conversa (era o `setLoading(true)` que fazia a tela
          piscar a cada ciclo de polling). Puramente informativa. */}
      <div className="relative h-0.5 shrink-0 overflow-hidden" aria-hidden>
        {revalidating ? (
          <div className="bg-primary/40 h-full w-full animate-pulse" />
        ) : null}
      </div>

      {/* Messages Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="border-primary h-5 w-5 animate-spin rounded-full border-2 border-t-transparent" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <p className="text-muted-foreground text-sm">
              Nenhuma mensagem ainda
            </p>
            <p className="text-muted-foreground text-xs">
              Envie um modelo para iniciar a conversa
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {messageGroups.map((group) => (
              <div key={group.date}>
                {/* Date separator */}
                <div className="mb-4 flex items-center justify-center">
                  <span className="rounded-full bg-[#11101d] px-3 py-1 text-[10px] font-semibold text-[#756c8f] uppercase">
                    {formatDateSeparator(group.date)}
                  </span>
                </div>
                {/* Messages */}
                <div className="flex flex-col gap-2">
                  {group.messages.map((msg) => {
                    const parent = msg.reply_to_message_id
                      ? messagesById.get(msg.reply_to_message_id)
                      : null;
                    const reply = parent
                      ? {
                          authorLabel: authorLabelFor(parent),
                          preview: buildReplyPreview(parent),
                        }
                      : null;
                    const msgReactions = reactionsByMessageId.get(msg.id);
                    return (
                      <MessageActions
                        key={msg.id}
                        message={msg}
                        onReply={() => handleStartReply(msg)}
                        onReact={(emoji) => {
                          if (emoji) void postReaction(msg.id, emoji);
                        }}
                      >
                        <MessageBubble
                          message={msg}
                          reply={reply}
                          reactions={msgReactions}
                          currentUserId={user?.id}
                          onToggleReaction={postReaction}
                        />
                      </MessageActions>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Composer */}
      <MessageComposer
        conversationId={conversation.id}
        sessionExpired={sessionInfo.expired}
        onSend={handleSend}
        onSendMedia={handleSendMedia}
        onOpenTemplates={handleOpenTemplates}
        replyTo={replyTo}
        onClearReply={() => setReplyTo(null)}
      />

      <TemplatePicker
        open={templateModalOpen}
        onOpenChange={setTemplateModalOpen}
        onSelect={handleSendTemplate}
      />
    </div>
  );
}
