# Sino de Notificações no Header — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sino com badge de não-lidas e dropdown de notificações no header, substituindo a página `/notifications` e o item da sidebar.

**Spec:** `docs/superpowers/specs/2026-08-03-sino-notificacoes-design.md` (ler antes de começar).

**Architecture:** Um hook novo (`use-notifications`) concentra lista das últimas 30 + contagem exata de não-lidas + realtime + refetch de 60s + markRead/markAllRead otimistas; ele substitui tanto a lógica da página quanto o hook `use-unread-notifications` que hoje alimenta a badge da sidebar. Um componente `NotificationsBell` (Popover no header) consome o hook. A página, o item da sidebar e o hook antigo são removidos. Zero mudança de banco.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase (client + realtime), base-ui Popover (via `ui/popover.tsx`), lucide, date-fns/ptBR, sonner.

## Global Constraints

- Strings visíveis ao usuário em PT-BR, SEM travessão (—).
- Sem migration e sem mudança de API: as policies atuais de `notifications` (SELECT das próprias, UPDATE só de `read_at`) cobrem tudo.
- Commits em PT-BR (`feat:`/`refactor:`), terminando com `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; `git add` sempre com caminhos específicos (há um arquivo untracked alheio na árvore: `supabase/migrations/052_fix_advisor_warnings.sql` — NUNCA incluí-lo).
- Branch: `feat/sino-notificacoes` (já criada, spec commitado).
- Gates: `npm run typecheck` limpo; `npm test` no baseline (5 falhas pré-existentes de locale); `npm run build` ok.
- Sem teste unitário novo (spec): repo não tem infra de teste de componentes/hooks React; a lógica de dados é a mesma já em produção na página.

---

### Task 1: Hook `useNotifications`

**Files:**
- Create: `src/hooks/use-notifications.ts`

**Interfaces:**
- Consumes: `createClient` de `@/lib/supabase/client`; tipo `Notification` de `@/types`; `toast` de `sonner`.
- Produces: `useNotifications(): UseNotificationsResult` com `{ notifications: Notification[] | null; unreadCount: number; markRead(id: string): Promise<void>; markAllRead(): Promise<void> }`. Task 2 consome exatamente isso.

Nota de design (por que diferente da página antiga): a página filtrava a lista por `account_id` ativo, mas a badge da sidebar (hook `use-unread-notifications`) contava SEM filtro de conta. No sino, badge e lista precisam bater, então o hook não filtra por conta: a RLS (`auth.uid() = user_id`) já escopa ao destinatário, e notificação é pessoal. Segunda decisão: a contagem NUNCA é decrementada pelo eco do realtime (o decremento otimista do `markRead` + o evento UPDATE dobrariam a subtração); em vez disso, todo UPDATE/DELETE dispara um head-count exato barato (`refreshCount`), que converge sempre.

- [ ] **Step 1: Implementar o hook**

```ts
// src/hooks/use-notifications.ts
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
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

export function useNotifications(): UseNotificationsResult {
  const [notifications, setNotifications] = useState<Notification[] | null>(
    null,
  );
  const [unreadCount, setUnreadCount] = useState(0);

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
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(LIST_LIMIT);
    if (!error) setNotifications((data ?? []) as Notification[]);
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

  return { notifications, unreadCount, markRead, markAllRead };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: limpo.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-notifications.ts
git commit -m "feat: hook useNotifications (lista, contagem exata, realtime, acoes)"
```

---

### Task 2: Componente `NotificationsBell` + montagem no header

**Files:**
- Create: `src/components/layout/notifications-bell.tsx`
- Modify: `src/components/layout/header.tsx` (import + render antes do `<ModeToggle />`, linha ~87)

**Interfaces:**
- Consumes: `useNotifications` (Task 1); `Popover/PopoverTrigger/PopoverContent` de `@/components/ui/popover` (base-ui: o Trigger JÁ renderiza um `<button>` e aceita `className` — ver uso em `src/components/inbox/message-actions.tsx`); `Notification` de `@/types`.
- Produces: `NotificationsBell()` sem props, usada só pelo header.

Desvio deliberado do spec: a lista rolável usa `div` com
`max-h-[min(400px,60vh)] overflow-y-auto` em vez do componente
`ScrollArea` citado no spec. Mesmo efeito visual, sem depender da API
do wrapper; o requisito do spec é "lista rolável com altura máx
~400px", que isto cumpre.

- [ ] **Step 1: Implementar o componente**

```tsx
// src/components/layout/notifications-bell.tsx
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
  const { notifications, unreadCount, markRead, markAllRead } =
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
          unreadCount > 0
            ? `Notificações, ${unreadCount} não lidas`
            : "Notificações"
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
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:cursor-default disabled:opacity-50"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Marcar todas
          </button>
        </div>

        {notifications === null ? (
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
```

Observação: se o `PopoverTrigger` local não aceitar `className` direto (conferir contra `src/components/inbox/message-actions.tsx`), usar o mesmo idioma daquele arquivo (ex.: prop `render`) e anotar o ajuste no report.

- [ ] **Step 2: Montar no header**

Em `src/components/layout/header.tsx`: adicionar o import

```tsx
import { NotificationsBell } from "@/components/layout/notifications-bell";
```

e no bloco da direita (linha ~86-88), renderizar antes do toggle:

```tsx
      <div className="flex items-center gap-1 sm:gap-2">
        <NotificationsBell />
        <ModeToggle />
      </div>
```

- [ ] **Step 3: Typecheck + smoke rápido**

Run: `npm run typecheck`
Expected: limpo. Se houver dev server, conferir o sino no header abrindo o dropdown.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/notifications-bell.tsx src/components/layout/header.tsx
git commit -m "feat: sino de notificacoes com badge e dropdown no header"
```

---

### Task 3: Remoções (página, item da sidebar, hook antigo)

**Files:**
- Delete: `src/app/(dashboard)/notifications/page.tsx` (diretório inteiro `notifications/`)
- Delete: `src/hooks/use-unread-notifications.ts`
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/components/layout/header.tsx` (mapa `pageTitles`)

**Interfaces:**
- Consumes: nada das tasks anteriores (edits independentes; o sino já cobre a funcionalidade).

- [ ] **Step 1: Confirmar que só a sidebar consome o hook antigo**

Run: `grep -rn "use-unread-notifications" src`
Expected: apenas `src/components/layout/sidebar.tsx`. Se aparecer outro consumidor, PARAR e reportar (o plano assume um só).

- [ ] **Step 2: Editar a sidebar**

Em `src/components/layout/sidebar.tsx`, remover:
1. O import `import { useUnreadNotifications } from "@/hooks/use-unread-notifications";` (linha ~11).
2. A chamada `const unreadNotifications = useUnreadNotifications();` (localizar por `useUnreadNotifications(`).
3. O item de navegação (linha ~107): `{ href: "/notifications", label: "Notificações", icon: Bell },`.
4. O bloco da badge: a const `showNotificationBadge` (linha ~306-307, com seu comentário) e o JSX que renderiza quando `showNotificationBadge` é true (localizar por `showNotificationBadge` no arquivo; remover todas as ocorrências).
5. `Bell` do import do lucide SE não sobrar nenhum uso (conferir com grep no próprio arquivo).

- [ ] **Step 3: Editar o header**

Em `src/components/layout/header.tsx`, remover a linha do mapa `pageTitles`:

```tsx
  "/notifications": "Notificações",
```

- [ ] **Step 4: Deletar página e hook antigo**

```bash
git rm -r "src/app/(dashboard)/notifications"
git rm src/hooks/use-unread-notifications.ts
```

- [ ] **Step 5: Varredura de referências restantes**

Run: `grep -rn "/notifications\|use-unread-notifications" src`
Expected: nenhuma ocorrência (a rota e o hook deixaram de existir).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: limpo.

- [ ] **Step 7: Commit**

```bash
git add src/components/layout/sidebar.tsx src/components/layout/header.tsx
git commit -m "refactor: remove pagina, item da sidebar e hook antigo de notificacoes"
```

(O `git rm` do Step 4 já deixou as deleções staged; este `git add` cobre só os dois modificados.)

---

### Task 4: Gates finais

**Files:** nenhum novo.

- [ ] **Step 1: Suite completa**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck limpo; testes só com as 5 falhas pré-existentes de locale (nenhuma nova); build ok e SEM a rota `/notifications` na lista de rotas.

- [ ] **Step 2: Smoke visual (se houver dev server e notificações no banco)**

1. Sino aparece no header com badge quando há não-lidas.
2. Dropdown lista as notificações com tempo relativo e ponto nas não-lidas.
3. Clicar num item abre `/inbox?c=<id>` e o ponto some.
4. "Marcar todas" zera badge e pontos.
5. Sidebar sem o item "Notificações"; acessar `/notifications` direto responde 404.

O que não der para validar (ex.: sem notificação de teste no banco), reportar como pendência, não como concluído.
