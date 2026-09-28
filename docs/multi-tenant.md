# Multi-tenant (modelo de agência)

O template original é single-tenant (1 usuário = 1 conta = 1 WhatsApp). A
agência precisa do modelo Trizup: **uma conta da agência gerencia vários
"clientes", cada um isolado, com seu próprio WhatsApp** — e o cliente NÃO
tem login (é um workspace que a agência opera).

Boa parte da fundação já vinha do template (migração 017 "account
sharing"): `account_id` em toda tabela de domínio e RLS via
`is_account_member(account_id, min_role)`. O que faltava era permitir **um
usuário pertencer a várias contas** e **trocar entre elas**.

## Conceitos

- **account** (conta) = um workspace = um cliente. Tem seu próprio
  WhatsApp, contatos, funil, etc. Isolado.
- **account_members** = vínculo N:N usuário ↔ conta, com papel
  (`owner`/`admin`/`agent`/`viewer`). **Fonte da verdade de acesso.**
- **conta ativa** (`profiles.active_account_id`) = o cliente que o usuário
  está operando agora. É só uma preferência; o servidor SEMPRE revalida
  contra `account_members` (fail-closed).
- **Segurança (isolamento)** = `is_account_member` (só vê contas de que é
  membro). **Escopo de visão (cliente ativo)** = `in_active_account` (só a
  conta ativa). São coisas separadas: um bug no escopo de visão mostra
  seus PRÓPRIOS outros clientes (cosmético), nunca dados de outra agência.

## Migrations 031–039

| Migration | O que faz |
|---|---|
| `031_multi_account_membership` | Tabela `account_members` (N:N). Reescreve `is_account_member` para ler dela. Adiciona `profiles.active_account_id`. Atualiza o trigger de signup. Dropa o índice "uma conta por dono". **Retrocompatível.** |
| `032_create_workspace_rpc` | RPC `create_workspace(name)` — cria conta de cliente + vínculo `owner`, atômico, SECURITY DEFINER. |
| `033_scope_reads_to_active_account` | Função `in_active_account(account_id)` = `is_account_member AND conta ativa`. Troca os `*_select` das 14 tabelas-pai para usá-la. Escritas seguem por membership. **Isolamento entre agências segue provado** (estritamente mais restritivo). |
| `034_agency_overview_rpc` | RPC `agency_overview()` — métricas por cliente de todas as contas do usuário (SECURITY DEFINER, restrito a membership). Base do painel/hub. |
| `035_agency_overview_whatsapp` | Adiciona `whatsapp_connected` à `agency_overview` (só Meta ainda). |
| `036_evolution_instances` | Tabela `evolution_instances` (1 por conta): `instance_name`, `status`. WhatsApp por Evolution (QR). Ver [`whatsapp-providers.md`](./whatsapp-providers.md). |
| `037_agency_overview_evolution` | `agency_overview` passa a contar "WhatsApp on" por QUALQUER provedor (Meta **ou** Evolution). |
| `038_delete_workspace_rpc` | RPC `delete_workspace(account_id)` — exclui o cliente (SECURITY DEFINER; só owner). Usada pelo `DELETE /api/account/workspaces/[id]`. |
| `039_evolution_connect_token` | Coluna `connect_token_hash` + índice único: hash do token do **link público** de conexão (Portal do Cliente). |

## Camada de aplicação

- **Servidor** (`src/lib/auth/account.ts`): `getCurrentAccount()` resolve a
  conta ATIVA validando membership (fail-closed: ponteiro para conta
  não-membro cai numa conta válida, nunca dá acesso). Helpers
  `getUserAccounts()` e `setActiveAccount()`.
- **Cliente** (`src/hooks/use-auth.tsx`): carrega a conta ATIVA e o papel
  nela (via `account_members`). Todo `useAuth().accountId` reflete o
  cliente selecionado.
- **Endpoints**:
  - `GET/POST /api/account/workspaces` — listar (+ `activeAccountId`) / criar cliente.
  - `DELETE /api/account/workspaces/[id]` — excluir cliente (owner; limpa a instância Evolution + `delete_workspace`).
  - `POST /api/account/workspaces/[id]/connect-link` — gerar o link público de conexão (owner/admin). Ver [`whatsapp-providers.md`](./whatsapp-providers.md).
  - `POST /api/account/active` — trocar de cliente (fail-closed).
  - `GET /api/account/overview` — dados do hub de clientes.
- **UI**:
  - `src/components/layout/workspace-switcher.tsx` — seletor no rodapé da sidebar (troca rápida + "Novo cliente"). Ao trocar, chama `refreshProfile()` + `router.refresh()`.
  - `src/app/(dashboard)/clients/page.tsx` — hub "Clientes": lista com métricas + status de WhatsApp, "Novo cliente", "Entrar", "Conectar WhatsApp", **gerar link de conexão** (ícone de link → Dialog com a URL para copiar) e **excluir** (com confirmação).

## Como o isolamento foi verificado

Testes RLS no banco (impersonando o JWT do usuário):
- **Isolamento**: membro perde o vínculo → perde o acesso na hora, mesmo com os dados existindo (RLS impõe, não a aplicação).
- **Escopo ativo**: membro de A e B, ativo em A → vê só A; troca para B → vê só B; e o seletor continua listando os dois (accounts/account_members não são escopados por conta ativa, de propósito).

## Pegadinhas para o dev

- `DropdownMenuLabel` é um `GroupLabel` do Base UI: **precisa estar dentro
  de um `DropdownMenuGroup`** (senão estoura "Base UI error #31" e derruba
  a página inteira). Foi essa a causa de um crash geral.
- Tabelas-FILHO (ex.: `messages` nas métricas do dashboard) e tabelas
  periféricas (`notifications`, `api_keys`, `ai_*`) ainda NÃO têm escopo
  por conta ativa — podem agregar entre clientes. É cosmético (não vaza
  entre agências). Escopar depois se incomodar.
- `whatsapp_config` é 1 por conta (`UNIQUE(account_id)`). O webhook da Meta
  roteia por `phone_number_id` para a conta certa (ver `whatsapp-providers.md`).
