# Sino de notificações no header (substitui a página)

**Data:** 2026-08-03
**Status:** aprovado

## Contexto e objetivo

As notificações hoje vivem numa página própria (`/notifications`),
acessada pela sidebar. A referência (Trizup) mostra um sino no header
com badge de não-lidas e um dropdown com as notificações e ações
rápidas. Decisão do usuário: o sino **substitui** a página; o dropdown
vira o único lugar de notificações.

A infraestrutura já existe e não muda: tabela `notifications`
(migration 027) com RLS por destinatário (`auth.uid() = user_id`),
UPDATE restrito por privilégio de coluna a `read_at`, índice parcial de
não-lidas, `REPLICA IDENTITY FULL` e realtime funcionando na página
atual. Sem migration nesta feature.

## Decisões (com o usuário)

| Decisão | Escolha |
|---|---|
| Convivência | Substitui: sai o item da sidebar e a rota `/notifications`; o dropdown é o único lugar. |
| Botão "Limpar" (delete) | Fora por ora. Só "Marcar todas como lidas" (o banco hoje não permite DELETE pelo cliente; adicionar depois exigiria migration de policy). |

## Design

### Hook `src/hooks/use-notifications.ts`

Extrai da página atual (`src/app/(dashboard)/notifications/page.tsx`)
a lógica de dados, sem mudança de comportamento:

- Fetch inicial: últimas **30** notificações do usuário, ordenadas por
  `created_at DESC` (a RLS já escopa ao destinatário).
- Canal realtime nos INSERT/UPDATE de `notifications` (mesmo padrão do
  canal `notifications-page` atual), atualizando a lista e a contagem.
- **Refetch a cada 60s** como rede de segurança, seguindo o padrão que
  o Inbox adotou porque o Realtime da VPS vive instável.
- API exposta: `{ notifications, unreadCount, markRead(id),
  markAllRead() }`. `markRead`/`markAllRead` são otimistas com a mesma
  escrita atual (`update read_at ... is('read_at', null)`).

### Componente `src/components/layout/notifications-bell.tsx`

- Sino (`Bell` do lucide) no header, à esquerda do `ModeToggle`,
  mesmo estilo dos botões do header.
- Badge numérica de não-lidas sobre o sino (oculta em 0; cap "99+").
- Clique abre `Popover` (componente já existente em `ui/popover.tsx`):
  - Cabeçalho: "Notificações" + botão "Marcar todas como lidas"
    (desabilitado sem não-lidas).
  - Lista rolável (`ScrollArea`, altura máx ~400px) com os itens:
    título, corpo truncado (2 linhas), tempo relativo em pt-BR
    (`date-fns` + `ptBR`, já usados no projeto), ponto indicador de
    não-lida.
  - Clique no item: `markRead(id)` + navega para
    `/inbox?c=<conversation_id>` (mesmo destino da página atual) e
    fecha o popover.
  - Empty state: ícone de sino + "Nenhuma notificação ainda" +
    "Você verá um alerta aqui quando alguém atribuir uma conversa a
    você." (textos da página atual).
- Acessível: o gatilho é `<button>` com `aria-label="Notificações"` e
  a contagem no label quando houver ("Notificações, 3 não lidas").

### Remoções (a parte "substitui")

- `src/components/layout/sidebar.tsx`: sai o item "Notificações".
- `src/app/(dashboard)/notifications/page.tsx`: rota deletada.
- `src/components/layout/header.tsx`: sai a entrada
  `"/notifications"` do mapa `pageTitles`; entra o
  `<NotificationsBell />`.
- Conferir referências restantes a `/notifications` no app (grep) e
  remover/ajustar as que apontarem para a rota extinta.

### Sem mudanças de dados

Nenhuma migration. As policies atuais cobrem tudo que o sino faz
(SELECT das próprias, UPDATE só de `read_at`).

### Testes e gates

- Sem teste unitário novo: JSX + lógica de dados idêntica à da página
  que já roda em produção; o repo não tem infra de teste de
  componentes React.
- Gates: `npm run typecheck` limpo, `npm test` no baseline (5 falhas
  pré-existentes de locale da máquina), `npm run build` ok, smoke
  visual: badge aparece com não-lida, chega notificação nova ao vivo
  (ou em até 60s), item navega para a conversa, "Marcar todas" zera a
  badge, sidebar sem o item e `/notifications` fora do build.

### Branch

`feat/sino-notificacoes`, criada da `main` atualizada (pós merge do
PR #14). O arquivo untracked `052_fix_advisor_warnings.sql` na árvore
é de outra frente e fica fora dos commits desta feature.

## Critérios de aceite

1. Sino no header com badge mostrando o número de não-lidas do usuário
   logado; badge some quando zera.
2. Dropdown lista as últimas notificações com tempo relativo; não-lidas
   marcadas com ponto.
3. Clicar numa notificação marca como lida e abre a conversa no Inbox.
4. "Marcar todas como lidas" zera a badge e os pontos.
5. Notificação criada com o dropdown fechado atualiza a badge sem
   recarregar a página (realtime, ou em até 60s pelo fallback).
6. Item "Notificações" não existe mais na sidebar e `/notifications`
   não existe mais como rota.
7. Strings em PT-BR, sem travessão em texto visível.

## Fora de escopo

- Botão "Limpar"/delete de notificações (exigiria migration).
- Novos TIPOS de notificação (hoje só `conversation_assigned`; alertas
  de disparos/pixel como no Trizup são outra feature).
- Preferências/silenciar notificações.
