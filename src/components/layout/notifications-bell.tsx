"use client";

// ============================================================
// Sino de notificações do header (único lugar de notificações desde
// que a página /notifications foi substituída). Badge com contagem
// exata de não-lidas; dropdown com as últimas notificações, "Marcar
// todas" e navegação para a conversa ao clicar.
// ============================================================

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, Loader2, UserPlus } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

import { useNotifications } from "@/hooks/use-notifications";
import type { Notification } from "@/types";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// Ícone por tipo. Um tipo hoje; futuros viram uma linha.
const TYPE_ICON: Record<Notification["type"], typeof Bell> = {
  conversation_assigned: UserPlus,
};

export function NotificationsBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { notifications, unreadCount, error, markRead, markAllRead, reload } =
    useNotifications();

  const handleItemClick = useCallback(
    (n: Notification) => {
      if (!n.read_at) void markRead(n.id);
      setOpen(false);
      if (n.conversation_id) router.push(`/inbox?c=${n.conversation_id}`);
    },
    [markRead, router],
  );

  const badge = unreadCount > 99 ? "99+" : String(unreadCount);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={
          unreadCount === 0
            ? "Notificações"
            : unreadCount === 1
              ? "Notificações, 1 não lida"
              : `Notificações, ${unreadCount} não lidas`
        }
        className="relative flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none font-semibold text-primary-foreground"
          >
            {badge}
          </span>
        )}
      </PopoverTrigger>

      <PopoverContent align="end" sideOffset={8} className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <span className="text-sm font-semibold text-foreground">
            Notificações
          </span>
          <button
            type="button"
            disabled={unreadCount === 0}
            onClick={() => void markAllRead()}
            aria-label="Marcar todas como lidas"
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:cursor-default disabled:opacity-50"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Marcar todas
          </button>
        </div>

        {error && !notifications?.length ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <p className="text-xs text-muted-foreground">
              Não foi possível carregar as notificações
            </p>
            <button
              type="button"
              onClick={() => void reload()}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Tentar novamente
            </button>
          </div>
        ) : notifications === null ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-8 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <Bell className="h-5 w-5 text-primary" />
            </div>
            <p className="mt-3 text-sm font-medium text-foreground">
              Nenhuma notificação ainda
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Você verá um alerta aqui quando alguém atribuir uma conversa a
              você.
            </p>
          </div>
        ) : (
          <div className="max-h-[min(400px,60vh)] overflow-y-auto">
            <ul className="p-1">
              {notifications.map((n) => {
                const Icon = TYPE_ICON[n.type] ?? Bell;
                const isUnread = !n.read_at;
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => handleItemClick(n)}
                      className={cn(
                        "flex w-full items-start gap-2.5 rounded-md p-2.5 text-left transition-colors hover:bg-muted",
                        isUnread && "bg-primary/5",
                      )}
                    >
                      <div
                        aria-hidden
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                          isUnread ? "bg-primary/15" : "bg-muted",
                        )}
                      >
                        <Icon
                          className={cn(
                            "h-4 w-4",
                            isUnread ? "text-primary" : "text-muted-foreground",
                          )}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "truncate text-sm font-medium",
                              isUnread
                                ? "text-foreground"
                                : "text-muted-foreground",
                            )}
                          >
                            {n.title}
                          </span>
                          {isUnread && (
                            <span
                              aria-label="Não lida"
                              className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                            />
                          )}
                        </div>
                        {n.body && (
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                            {n.body}
                          </p>
                        )}
                        <p className="mt-1 text-[11px] text-muted-foreground/70">
                          {formatDistanceToNow(new Date(n.created_at), {
                            addSuffix: true,
                            locale: ptBR,
                          })}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
