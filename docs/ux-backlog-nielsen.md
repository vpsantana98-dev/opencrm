# Backlog UX — heurísticas de Nielsen

> **Status: TODOS OS ITENS ABAIXO FORAM IMPLEMENTADOS.**
> A rodada de alto + médio saiu no commit `7473ac5`; a rodada de baixo impacto
> (mais o guard de não-salvo dos Ads) foi implementada em seguida. Um ponto
> segue como ressalva conhecida: o guard de "alterações não salvas" nos Ads
> cobre fechar/recarregar a aba (`beforeunload`), mas **não** intercepta a troca
> de aba/cliente dentro do app (que re-monta o componente) — isso é maior e
> ficou registrado como dívida.

Documento mantido como histórico do que foi auditado e corrigido. Cada item traz: heurística, arquivo(s), esforço e a correção aplicada.

---

## Rápidos (< 30 min cada)

### 1. Pílulas de "Saúde" sem explicação (tooltip)
- **Heurística:** Ajuda e documentação
- **Onde:** `src/components/inbox/conversation-list.tsx` (pílula na lista) e `src/components/inbox/clickup-panel.tsx` (pílulas do painel)
- **Problema:** Estável / Monitoramento / Possível churn aparecem sem dizer o que significam. Depende de o atendente já saber.
- **Correção:** `title`/tooltip curto em cada pílula descrevendo o critério.

### 2. Estado "nenhum resultado" dos filtros do inbox sem atalho para limpar
- **Heurística:** Controle e liberdade do usuário
- **Onde:** `src/components/inbox/conversation-list.tsx` (estado vazio de busca/filtro)
- **Problema:** Quando a busca/filtro não retorna nada, não há botão pra limpar ali mesmo (o "Limpar tudo" só cobre tags/empresa).
- **Correção:** Botão "Limpar filtros" no estado vazio, resetando busca + status + filtros de contato.

### 3. Confirmar desconexão do ClickUp nas Configurações
- **Heurística:** Prevenção de erros
- **Onde:** `src/components/settings/clickup-connect.tsx`
- **Problema:** O botão desconecta na hora (é reversível, mas exige recolar a API key).
- **Correção:** Confirmação leve antes de remover (mesmo padrão inline que já usamos no painel do inbox).

### 4. Campo de moeda ("Purchase") aceita texto livre inválido
- **Heurística:** Prevenção de erros
- **Onde:** `src/components/settings/meta-ads-config.tsx` e `google-ads-config.tsx`
- **Problema:** Aceita "REAL", "R$", "XX" — a API rejeita depois sem explicar.
- **Correção:** Trocar por `<select>` com códigos ISO (BRL, USD, EUR...).

### 5. Nome do cliente sem limite de tamanho no passo 1 do wizard
- **Heurística:** Prevenção de erros
- **Onde:** `src/components/clients/new-client-wizard.tsx` (input do passo 1)
- **Problema:** Só checa não-vazio; nome gigante trunca feio nos cards. (O rename já valida 120 no servidor; falta o `maxLength` no input.)
- **Correção:** `maxLength={120}` no input + feedback.

### 6. Verbos inconsistentes: "Novo…" vs "Adicionar…"
- **Heurística:** Consistência e padrões
- **Onde:** `src/components/dashboard/quick-actions.tsx` ("Novo contato/negócio") vs `contacts/page.tsx` e `pipelines/page.tsx` ("Adicionar…")
- **Correção:** Padronizar um verbo de criação no app todo.

### 7. Ordem do menu: "Dashboard" não é o primeiro item
- **Heurística:** Consistência e padrões
- **Onde:** `src/components/layout/sidebar.tsx` (lista de navItems)
- **Problema:** A logo aponta pra `/dashboard`, mas "Dashboard" aparece abaixo de "Clientes".
- **Correção:** Dashboard no topo (ou agrupar por seção).

### 8. Item de menu ativo: dois `<h1>` por página
- **Heurística:** Consistência/semântica (acessibilidade)
- **Onde:** `src/components/layout/header.tsx` (h1 do título) + h1 das páginas (dashboard, contatos, funil...)
- **Problema:** Dois `h1` na mesma página confundem leitores de tela.
- **Correção:** Rebaixar o título do header pra não-heading (ou `h2`), deixando 1 `h1` por página.

---

## Esforço médio

### 9. Estados de carregamento: skeleton em vez de spinner central
- **Heurística:** Visibilidade do status do sistema
- **Onde:** `clients/page.tsx`, `meta-ads-config.tsx`, `google-ads-config.tsx` (spinner central) e mistura geral (dashboard usa skeleton, contatos usa spinner na tabela, funil usa barras pulsando)
- **Correção:** Padronizar skeletons que espelham o layout final; reservar spinner só pro gate de auth.

### 10. Menu de conta duplicado no desktop (header + rodapé da sidebar)
- **Heurística:** Consistência e padrões / Minimalismo
- **Onde:** `src/components/layout/header.tsx` e `src/components/layout/sidebar.tsx`
- **Problema:** O mesmo dropdown (Perfil/Config/Sair) aparece duas vezes no desktop.
- **Correção:** Manter um único ponto (provavelmente o do rodapé da sidebar, que já traz conta+role), deixando no header só o ModeToggle/ações contextuais.

### 11. Breadcrumb / "voltar" em rotas de detalhe
- **Heurística:** Visibilidade do status / Controle e liberdade
- **Onde:** `broadcasts/[id]`, `automations/[id]/edit`, `automations/[id]/logs`, `flows/[id]`, `flows/[id]/runs`
- **Problema:** Sem breadcrumb nem "voltar" consistente; depende do botão do navegador.
- **Correção:** Breadcrumb ou botão "voltar" no header pra rotas aninhadas (ex.: "Disparos › Nome").

### 12. Botão de refresh do inbox gira por tempo fixo (700ms)
- **Heurística:** Visibilidade do status do sistema
- **Onde:** `src/components/inbox/message-thread.tsx`
- **Problema:** O spin é cosmético (timer), não reflete o fim real do refetch — em rede lenta "para" antes dos dados chegarem.
- **Correção:** Amarrar o "atualizando" à conclusão real do fetch.

### 13. Wizard não detecta conexão do WhatsApp pra avançar/comemorar
- **Heurística:** Visibilidade do status do sistema
- **Onde:** `src/components/clients/new-client-wizard.tsx` (passo 2 QR / passo 3)
- **Problema:** O `EvolutionConnect` detecta a conexão por dentro, mas o wizard não reage; o passo final dá mensagem genérica.
- **Correção:** Propagar o status de conexão pra avançar/ajustar a mensagem automaticamente.

### 14. [MÉDIO — entregue em versão leve] Aviso ao sair com alterações não salvas (Ads)
- **Heurística:** Prevenção de erros
- **Onde:** `src/components/settings/meta-ads-config.tsx` e `google-ads-config.tsx`
- **Feito:** "Testar" desabilitado com edição pendente + aviso visível.
- **Falta:** Guardar as edições ao trocar de aba/cliente (o componente re-monta por `key` e perde o que foi digitado). Precisa de um guard de navegação/`beforeunload` — maior e mais arriscado, por isso ficou pra cá.

---

## Esforço grande

### 15. Navegação por teclado no inbox
- **Heurística:** Flexibilidade e eficiência de uso
- **Onde:** `src/components/inbox/conversation-list.tsx` e `src/app/(dashboard)/inbox/page.tsx`
- **Problema:** Só há Enter/Shift+Enter no composer. Falta ↑/↓ entre conversas, `/` pra focar busca, `Esc` pra fechar a thread.
- **Correção:** Atalhos de teclado + uma legenda curta. Alto valor pra quem atende volume, mas requer cuidado pra não conflitar com inputs.

---

## Fonte
Auditoria de 3 frentes (inbox+OpenCRM, clientes+config+onboarding, global+dashboard+funil) rodada em 2026-08-02. Os itens de **alto e médio impacto** já foram corrigidos no commit `7473ac5`.
