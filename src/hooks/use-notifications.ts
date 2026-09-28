"use client";

// ============================================================
// Dados do sino de notificações do header. Substitui a antiga página
// /notifications e o hook use-unread-notifications (badge da sidebar):
// lista das últimas 30 + contagem EXATA de não-lidas + realtime +
// refetch periódico + ações de marcar como lida.
//
// Sem filtro de conta de propósito: a RLS de notifications
// (auth.uid() = user_id) escopa ao destinatário, e a badge precisa
// bater com a lista em qualquer conta ativa.
//
// Contagem: head-count exato no load e após cada UPDATE/DELETE do
// realtime (refreshCount). O eco do UPDATE não decrementa direto:
// somado ao decremento otimista do markRead, subtrairia em dobro.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import type { Notification } from "@/types";

/** Quantas notificações o dropdown mostra. */
const LIST_LIMIT = 30;
/** Rede de segurança contra o Realtime instável da VPS (padrão do Inbox). */
const REFETCH_INTERVAL_MS = 60_000;

export interface UseNotificationsResult {
  /** Últimas LIST_LIMIT, mais recentes primeiro. null = carregando. */
  notifications: Notification[] | null;
  /** Contagem exata de não-lidas (head count, não derivada da lista). */
  unreadCount: number;
  /** true quando o último fetch da lista falhou. */
  error: boolean;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  /** Refaz o fetch da lista e da contagem. */
  reload: () => Promise<void>;
}

export function useNotifications(): UseNotificationsResult {
  const [notifications, setNotifications] = useState<Notification[] | null>(
    null,
  );
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState(false);

  const refreshCount = useCallback(async () => {
    const supabase = createClient();
    // head:true não busca linhas; só o count vem na resposta.
    const { count, error } = await supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .is("read_at", null);
    if (!error) setUnreadCount(count ?? 0);
  }, []);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data, error: fetchError } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(LIST_LIMIT);
    setError(!!fetchError);
    if (!fetchError) setNotifications((data ?? []) as Notification[]);
    await refreshCount();
  }, [refreshCount]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const timer = setInterval(load, REFETCH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Realtime: lista em dia sem recarregar; contagem via refreshCount
  // (ver comentário do topo). INSERT incrementa direto: é o único
  // evento sem risco de dupla contagem e o que precisa ser instantâneo.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("notifications-bell")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications" },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const row = payload.new as Notification;
            setNotifications((prev) => {
              if (!prev) return [row];
              if (prev.some((n) => n.id === row.id)) return prev;
              return [row, ...prev].slice(0, LIST_LIMIT);
            });
            if (!row.read_at) setUnreadCount((n) => n + 1);
          } else if (payload.eventType === "UPDATE") {
            const row = payload.new as Notification;
            setNotifications(
              (prev) =>
                prev?.map((n) => (n.id === row.id ? { ...n, ...row } : n)) ??
                prev,
            );
            void refreshCount();
          } else if (payload.eventType === "DELETE") {
            const oldRow = payload.old as Partial<Notification>;
            setNotifications(
              (prev) => prev?.filter((n) => n.id !== oldRow.id) ?? prev,
            );
            void refreshCount();
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refreshCount]);

  const markRead = useCallback(
    async (id: string) => {
      // Otimista: lista e badge respondem antes do round-trip. O
      // refreshCount pós-escrita reconcilia com o valor exato.
      const target = notifications?.find((n) => n.id === id);
      const wasUnread = !!target && !target.read_at;
      setNotifications(
        (prev) =>
          prev?.map((n) =>
            n.id === id && !n.read_at
              ? { ...n, read_at: new Date().toISOString() }
              : n,
          ) ?? prev,
      );
      if (wasUnread) setUnreadCount((n) => Math.max(0, n - 1));

      const supabase = createClient();
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id)
        .is("read_at", null);
      if (error) {
        toast.error("Falha ao marcar a notificação como lida");
        void load();
        return;
      }
      void refreshCount();
    },
    [notifications, load, refreshCount],
  );

  const markAllRead = useCallback(async () => {
    if (unreadCount === 0) return;
    const now = new Date().toISOString();
    setNotifications(
      (prev) =>
        prev?.map((n) => (n.read_at ? n : { ...n, read_at: now })) ?? prev,
    );
    setUnreadCount(0);

    const supabase = createClient();
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: now })
      .is("read_at", null);
    if (error) {
      toast.error("Falha ao marcar todas como lidas");
      void load();
      return;
    }
    void refreshCount();
  }, [unreadCount, load, refreshCount]);

  return {
    notifications,
    unreadCount,
    error,
    markRead,
    markAllRead,
    reload: load,
  };
}
