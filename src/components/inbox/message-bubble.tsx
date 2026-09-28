"use client";

import { memo, useState, useEffect, useCallback, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Message, MessageReaction } from "@/types";
import {
  Clock,
  Check,
  CheckCheck,
  XCircle,
  FileText,
  MapPin,
  LayoutTemplate,
  ImageOff,
  CornerDownLeft,
} from "lucide-react";
import { format } from "date-fns";
import { ReplyQuote } from "./reply-quote";
import { MessageReactions } from "./message-reactions";

interface MessageBubbleProps {
  message: Message;
  /** Pre-computed quote info for messages that reply to another. */
  reply?: { authorLabel: string; preview: string } | null;
  reactions?: MessageReaction[];
  currentUserId?: string;
  /**
   * Sets the agent's reaction on `messageId` to `emoji` (empty string
   * removes it). Takes the message id explicitly — rather than a
   * pre-bound `(emoji) => void` per bubble — so the caller can pass one
   * stable callback (e.g. a `useCallback`-wrapped function) shared by
   * every bubble in the thread. That stability is what lets `memo`
   * below actually skip re-renders instead of always seeing a fresh
   * closure prop.
   */
  onToggleReaction?: (messageId: string, emoji: string) => void;
}

const STATUS_LABEL: Record<string, string> = {
  sending: "Enviando",
  sent: "Enviada",
  delivered: "Entregue",
  read: "Lida",
  failed: "Falha ao enviar",
};

function StatusIcon({ status }: { status: Message["status"] }) {
  const label = STATUS_LABEL[status] ?? "";
  let icon: ReactNode = null;
  switch (status) {
    case "sending":
      icon = <Clock className="h-3 w-3 text-muted-foreground" />;
      break;
    case "sent":
      icon = <Check className="h-3 w-3 text-muted-foreground" />;
      break;
    case "delivered":
      icon = <CheckCheck className="h-3 w-3 text-muted-foreground" />;
      break;
    case "read":
      icon = <CheckCheck className="h-3 w-3 text-blue-400" />;
      break;
    case "failed":
      icon = <XCircle className="h-3 w-3 text-red-400" />;
      break;
    default:
      return null;
  }
  // span com title/aria-label — o ícone Lucide não aceita title direto.
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex">
      {icon}
    </span>
  );
}

function MediaUnavailable({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <ImageOff className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span>{label} indisponível</span>
    </div>
  );
}

function MediaImage({ url, alt }: { url: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadImage = useCallback(async () => {
    if (!url) return;

    // Proxy URLs need auth fetch to create blob URL
    if (url.startsWith("/api/whatsapp/media/")) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to load media");
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        setSrc(blobUrl);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    } else {
      setSrc(url);
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    loadImage();
    return () => {
      if (src?.startsWith("blob:")) {
        URL.revokeObjectURL(src);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadImage]);

  if (error) {
    return (
      <div className="flex h-40 w-60 items-center justify-center rounded-lg bg-muted">
        <ImageOff className="h-8 w-8 text-muted-foreground" />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-40 w-60 items-center justify-center rounded-lg bg-muted">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <img
      src={src ?? ""}
      alt={alt}
      loading="lazy"
      // min-h casa com a caixa do placeholder acima (h-40), pra a troca
      // "carregando → imagem" não empurrar a thread para baixo.
      className="max-h-64 min-h-40 max-w-60 rounded-lg object-cover"
      onError={() => setError(true)}
    />
  );
}

function MessageContent({ message }: { message: Message }) {
  switch (message.content_type) {
    case "text":
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text}
        </p>
      );

    case "image":
      return (
        <div>
          {message.media_url ? (
            <MediaImage url={message.media_url} alt="Imagem compartilhada" />
          ) : (
            <MediaUnavailable label="Imagem" />
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "video":
      return (
        <div>
          {message.media_url ? (
            <video
              src={message.media_url}
              controls
              className="max-h-64 max-w-60 rounded-lg"
            />
          ) : (
            <MediaUnavailable label="Vídeo" />
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "audio":
      return (
        <div>
          {message.media_url ? (
            <audio src={message.media_url} controls className="max-w-60" />
          ) : (
            <MediaUnavailable label="Áudio" />
          )}
        </div>
      );

    case "document":
      if (!message.media_url) {
        return <MediaUnavailable label={message.content_text || "Documento"} />;
      }
      return (
        <a
          href={message.media_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm hover:bg-muted"
        >
          <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
          <span className="truncate">
            {message.content_text || "Documento"}
          </span>
        </a>
      );

    case "template":
      return (
        <div>
          <span className="mb-1 inline-flex items-center gap-1 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            <LayoutTemplate className="h-3 w-3" />
            Modelo
          </span>
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "location":
      return (
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>{message.content_text || "Localização compartilhada"}</span>
        </div>
      );

    case "interactive": {
      // Customer tapped a reply button or list row on a message the bot
      // sent. We show the tapped option's title (already in content_text,
      // set by parseMessageContent in the webhook) with a small affordance
      // so agents reading the inbox can tell at a glance that this is a
      // tap rather than the customer typing the same words.
      return (
        <div className="flex flex-col gap-0.5">
          <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <CornerDownLeft className="h-3 w-3" />
            Resposta de botão
          </span>
          <p className="whitespace-pre-wrap break-words text-sm">
            {message.content_text || "[Resposta interativa]"}
          </p>
        </div>
      );
    }

    default:
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text || "[Tipo de mensagem não suportado]"}
        </p>
      );
  }
}

// Memoizado: numa thread com centenas de mensagens, um estado que muda em
// UMA bolha (reação, patch de status) não pode re-renderizar todas as
// outras. Só funciona porque o chamador (message-thread.tsx) mantém `msg`,
// `reactions` e `onToggleReaction` estáveis entre re-renders quando nada
// daquela bolha específica mudou.
export const MessageBubble = memo(function MessageBubble({
  message,
  reply,
  reactions,
  currentUserId,
  onToggleReaction,
}: MessageBubbleProps) {
  const isAgent = message.sender_type === "agent" || message.sender_type === "bot";
  const time = format(new Date(message.created_at), "HH:mm");

  // A semântica de "toggle" (clicar de novo na mesma reação remove) é
  // calculada aqui, não no chamador — o chamador só precisa passar o
  // primitivo estável `(messageId, emoji) => void`.
  const ownReaction = reactions?.find(
    (r) => r.actor_type === "agent" && r.actor_id === currentUserId,
  );
  const handleToggle = useCallback(
    (emoji: string) => {
      const next = ownReaction?.emoji === emoji ? "" : emoji;
      onToggleReaction?.(message.id, next);
    },
    [message.id, onToggleReaction, ownReaction?.emoji],
  );

  // Row alignment + width cap are owned by <MessageActions> so its hover
  // group matches the bubble's content area, not the full row.
  return (
    <div
      className={cn(
        "flex flex-col",
        isAgent ? "items-end" : "items-start",
      )}
    >
      <div
        className={cn(
          "relative rounded-lg px-3.5 py-2.5 shadow-lg",
          isAgent
            ? "bg-[#9900ff] text-white shadow-[#9900ff]/10"
            : "bg-[#171527] text-[#f0ecff] shadow-black/20",
        )}
      >
        {/* Em grupo, quem falou aparece acima do texto (estilo WhatsApp). */}
        {!isAgent && message.sender_name ? (
          <p className="mb-0.5 text-xs font-semibold text-primary">
            {message.sender_name}
          </p>
        ) : null}
        {reply && (
          <ReplyQuote
            authorLabel={reply.authorLabel}
            preview={reply.preview}
            onPrimary={isAgent}
          />
        )}
        <MessageContent message={message} />
        <div
          className={cn(
            "mt-1 flex items-center gap-1",
            isAgent ? "justify-end" : "justify-start",
          )}
        >
          <span
            className={cn(
              "text-[10px]",
              // Outbound bubbles sit on the primary fill, so the
              // timestamp must read against that (not the neutral
              // foreground) — otherwise it goes low-contrast in light
              // mode. Inbound bubbles use the muted surface.
            isAgent ? "text-white/65" : "text-[#857b9f]",
            )}
          >
            {time}
          </span>
          {isAgent && <StatusIcon status={message.status} />}
        </div>
      </div>
      {reactions && reactions.length > 0 && onToggleReaction && (
        <MessageReactions
          reactions={reactions}
          currentUserId={currentUserId}
          onToggle={handleToggle}
        />
      )}
    </div>
  );
});
