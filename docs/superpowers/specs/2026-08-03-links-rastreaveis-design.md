# Links Rastreáveis (estilo Trizup)

**Data:** 2026-08-03
**Status:** aprovado (atualizado após o usuário detalhar o fluxo da LP:
captura dinâmica de UTMs no clique)

## Contexto e objetivo

Réplica funcional da aba "Links Rastreáveis" do Trizup: a agência cria
links curtos públicos (`/t/<código>`) que redirecionam para o WhatsApp
do cliente com uma mensagem pré-preenchida. O sistema conta cliques,
atribui conversas geradas ao link (pela mensagem padrão, usada como
assinatura) e mostra tudo numa página com cards de resumo e tabela.

**Fluxo real de uso (detalhado pelo usuário):** o anúncio leva para a
LP/site com UTMs na URL (`?utm_source=googleads&utm_campaign=...`); o
botão de WhatsApp da LP aponta para `/t/<código>` repassando esses
UTMs. No clique, o redirect **captura os UTMs da URL da requisição**,
registra o clique com eles e manda a pessoa para o `wa.me` com a
mensagem pré-definida. Assim dá para bater de qual campanha veio cada
clique e cada lead. Os UTMs configurados no modal são o *padrão*
(fallback) para quando a URL não trouxer nenhum, por exemplo link
colado direto na bio do Instagram.

Valor de CRM: saber de qual campanha/anúncio veio cada lead que chama
no WhatsApp, com a origem gravada no contato.

## Decisões (com o usuário)

| Decisão | Escolha |
|---|---|
| Atribuição de conversas | Assinatura por mensagem, igual ao Trizup: mensagem padrão obrigatória; a primeira mensagem recebida de um contato NOVO que casar com o texto atribui a conversa ao link. |
| Rastreamento | Contadores no link (`clicks_count`, `conversations_count`) para a listagem **+ tabela `link_clicks`** com um registro por clique. A decisão inicial era só contadores; a captura dinâmica de UTMs por clique (fluxo da LP) exige registrar cada clique com seus UTMs. |
| UTMs | Capturados da query string do `/t/<código>` no clique (só os 5 `utm_*` conhecidos). Os campos do modal são o padrão quando a URL não traz UTMs. |
| Número WhatsApp do modal | Select alimentado pelos números conectados + correção do gap: passar a gravar `evolution_instances.phone` quando a instância conecta. Fallback de digitação manual. |
| UTM no lead | Contato ganha `source_link_id` (FK) + snapshot dos UTMs efetivos do clique atribuído (`source_utm` JSONB). Origem visível no painel do contato. |
| Escopo da entrega | Lista completa + CRUD + redirect + captura de UTM + atribuição. SEM tela de analytics por link (gráfico/série temporal fica para fase 2; os dados dela já ficam prontos em `link_clicks`). |

## Design

### Dados (migration `041_tracking_links.sql`)

Tabela `tracking_links`:

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | UUID PK | `uuid_generate_v4()` |
| `account_id` | UUID NOT NULL → accounts | tenancy |
| `user_id` | UUID NOT NULL → auth.users | auditoria (quem criou) |
| `name` | TEXT NOT NULL | nome interno do link |
| `code` | TEXT NOT NULL UNIQUE | 8 caracteres base62 (ex.: `SgK5PPPw`), gerado com aleatoriedade criptográfica; colisão é tratada regenerando (a UNIQUE rejeita) |
| `phone` | TEXT NOT NULL | destino em E.164 |
| `message` | TEXT NOT NULL | mensagem padrão = assinatura de atribuição |
| `utm_source` .. `utm_content` | TEXT NULL | UTMs padrão (source, medium, campaign, term, content), usados quando a URL do clique não traz |
| `active` | BOOLEAN NOT NULL DEFAULT true | toggle da tabela |
| `clicks_count` | INTEGER NOT NULL DEFAULT 0 | agregado para a listagem |
| `conversations_count` | INTEGER NOT NULL DEFAULT 0 | agregado para a listagem |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

Tabela `link_clicks` (um registro por clique):

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | UUID PK | |
| `link_id` | UUID NOT NULL → tracking_links ON DELETE CASCADE | |
| `account_id` | UUID NOT NULL → accounts | denormalizado para RLS direta |
| `utm_source` .. `utm_content` | TEXT NULL | capturados da query string do clique; NULL quando a URL não trouxe |
| `clicked_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | |

- Índice em `(link_id, clicked_at DESC)` (busca do "último clique" na
  atribuição e base do gráfico da fase 2).
- Sanitização na captura: só os 5 parâmetros `utm_*` conhecidos, cada
  valor truncado (limite 255 caracteres); o resto da query é ignorado.
- **Índice único parcial** em `tracking_links (account_id,
  lower(trim(message))) WHERE active` — a assinatura de atribuição
  nunca é ambígua entre links ativos da mesma conta. O modal traduz a
  violação em erro amigável ("já existe um link ativo com esta
  mensagem").
- **RLS no padrão broadcasts** nas duas tabelas: SELECT por
  `in_active_account(account_id)`; escrita de `tracking_links` por
  `is_account_member(account_id, 'agent')`. `link_clicks` só é escrita
  pelo servidor (service role); sem policy de INSERT para usuários.
- `contacts.source_link_id UUID NULL REFERENCES tracking_links(id)
  ON DELETE SET NULL` + índice, e `contacts.source_utm JSONB NULL`
  (snapshot dos UTMs efetivos no momento da atribuição; sobrevive à
  exclusão do link e a qualquer limpeza futura de `link_clicks`).
- RPC `register_link_click(p_code TEXT, p_utm JSONB)` (SECURITY
  DEFINER): se existe link ativo com o código, insere o clique em
  `link_clicks` com os UTMs, incrementa `clicks_count` atomicamente e
  retorna `phone` e `message`; senão retorna vazio. Uma ida ao banco.
- RPC `increment_link_conversations(p_link_id UUID)`: incremento
  atômico usado pela atribuição.

### Redirect público `/t/[code]`

- `src/app/t/[code]/route.ts`, handler GET com service role
  (`supabaseAdmin`), sem login:
  1. Lê os `utm_*` da query string (sanitizados como acima).
  2. Chama `register_link_click(code, utms)`.
  3. Achou: `302` para `https://wa.me/<dígitos do phone>?text=<message
     codificada com encodeURIComponent>`.
  4. Não achou (código inexistente OU link desativado): `404` com corpo
     mínimo em PT-BR ("Link não encontrado"), sem contar clique.
- O `middleware.ts` não muda para o `/t/`: ele só bloqueia os paths
  protegidos listados e `/api/whatsapp/*`.
- Uso na LP (documentação para o usuário, não é código nosso): o botão
  aponta para `/t/<código>` repassando os UTMs da página, por exemplo
  com um script simples que copia `location.search` para o href, ou o
  anúncio aponta direto para `/t/<código>?utm_...`.

### Correção do gap: `evolution_instances.phone`

Hoje a coluna nunca é escrita (o que também mantém morta a preferência
de proxy por DDD da Fase 1 do anti-ban). Passa a ser preenchida:

- Nova função `fetchInstanceInfo(instanceName)` em
  `src/lib/whatsapp/evolution-api.ts`: GET `fetchInstances` da
  Evolution, extrai `ownerJid` (ex.: `5531...@s.whatsapp.net`) e
  devolve o telefone em E.164.
- Nos três pontos em que o estado vira conectado — rota de status
  autenticada, rota `status-public` e webhook `connection.update` —
  se `evolution_instances.phone` está vazio, busca via
  `fetchInstanceInfo` e grava. Falha da busca não quebra o fluxo
  (log e segue).

### Atribuição de conversas

Helper `src/lib/tracking-links/attribution.ts`:

```
attributeLeadToLink(db, accountId, contactId, text, contactCreated)
```

- Só age quando `contactCreated === true` e `text` não vazio (lead
  novo; contato existente que repete a mensagem não conta de novo).
- Normalização: `trim` + comparação sem diferenciar maiúsculas
  (mesmo critério do índice único, `lower(trim(message))`).
- Busca link ativo da conta com a mensagem igual; se achar:
  1. Resolve os **UTMs efetivos**: os do clique mais recente do link;
     se esse clique não trouxe nenhum `utm_*` (ou não há cliques
     registrados), usa os UTMs padrão do link.
  2. Grava `contacts.source_link_id` e `contacts.source_utm`
     (snapshot).
  3. Chama `increment_link_conversations`.
- **Limitação conhecida (aceita):** com a mesma assinatura para todos
  os cliques do link, a associação lead ↔ clique é por "último clique",
  então campanhas simultâneas apontando para o MESMO link podem trocar
  UTMs entre leads próximos no tempo. Para separar campanhas com
  precisão, usa-se um link por campanha (é o modelo do Trizup).
- Nunca lança: try/catch com `console.error`; a atribuição jamais
  derruba o processamento da mensagem no webhook.

Pontos de chamada (os dois provedores):

- Webhook Evolution (`messages.upsert`): após
  `resolveConversationByPhone`, que já retorna `contactCreated`.
- Webhook Meta (`/api/whatsapp/webhook`): no ponto equivalente onde o
  contato é criado a partir da mensagem inbound.

### Página "Links Rastreáveis"

- Sidebar: item "Links Rastreáveis", ícone `Link2`, rota
  `/tracking-links`, posicionado após "Funis". Adicionar
  `/tracking-links` aos `protectedPaths` do middleware.
- `src/app/(dashboard)/tracking-links/page.tsx`, client component no
  padrão broadcasts (supabase client + RLS; `useCan` + `GatedButton`
  para escrita):
  - **4 cards de resumo**: Total de Links, Cliques Totais, Conversas
    Geradas, Taxa de Conversão (conversas/cliques, `0%` sem cliques).
    Agregados client-side da lista carregada.
  - **Tabela**: Nome, Link (`/t/<code>` + botão copiar a URL completa
    com `window.location.origin`, feedback de copiado), Origem (badge
    com o `utm_source` padrão; sem badge quando vazio), Cliques,
    Conversas, Taxa (por link), Status (switch que grava `active`),
    Ações (editar, excluir com diálogo de confirmação).
  - **Empty state**: ícone de link + "Nenhum link rastreável criado
    ainda" + "Crie seu primeiro link para começar a rastrear suas
    conversas", igual à referência.
- **Modal criar/editar** (mesmo componente, dois modos):
  - Nome* (placeholder "Ex: Campanha Instagram Janeiro").
  - Número WhatsApp*: select com os números conectados da conta ativa
    (hoje, na prática, o `phone` da instância Evolution; a config Meta
    guarda só `phone_number_id`, sem número discável). Se nenhum número
    aparecer, campo de digitação manual com validação E.164.
  - Parâmetros UTM (padrão/fallback): Source, Medium, Campaign, Term,
    Content, todos opcionais, com os placeholders da referência.
  - Mensagem Padrão*: textarea + hints ("Obrigatória. Usada como
    assinatura para atribuição precisa do lead ao link." / "Esta
    mensagem será preenchida automaticamente ao abrir o WhatsApp").
  - Validações: obrigatórios preenchidos; erro amigável quando o
    índice único de mensagem rejeitar.
- Strings em PT-BR, sem travessão em texto visível ao usuário.

### Origem no painel do contato

No painel de detalhes do contato do Inbox: quando o contato tem
`source_link_id`, mostrar bloco "Origem" com o nome do link e os UTMs
do snapshot `source_utm`. Somente leitura.

### Testes e gates

- Vitest (padrão do repo, `src/lib/`):
  - geração de código (formato, tamanho, alfabeto);
  - sanitização de UTMs da query (só os 5 conhecidos, truncamento);
  - `attributeLeadToLink`: casa e atribui com UTMs do último clique;
    fallback para os UTMs padrão do link; não roda quando
    `contactCreated=false`; normalização (espaços, maiúsculas); não
    lança quando o banco falha.
- Gates: `npm run typecheck`, `npm test` no baseline, `npm run build`,
  smoke visual com `npm run dev`.

### Branch

`feat/links-rastreaveis`, criada do HEAD atual de
`feat/whatsapp-config-recolhivel` (linha multi-tenant). O WIP
não commitado de `whatsapp-config.tsx` segue intocado e fora dos
commits desta feature.

## Critérios de aceite

1. Criar um link no modal (nome, número, mensagem) gera código único e
   ele aparece na tabela com 0 cliques / 0 conversas.
2. Abrir `/t/<code>` sem login redireciona para o `wa.me` do número com
   a mensagem pré-preenchida e incrementa Cliques.
3. Abrir `/t/<code>?utm_source=googleads&utm_campaign=x` registra o
   clique com esses UTMs (visível em `link_clicks`).
4. Com o link desativado no switch, `/t/<code>` responde 404 e não
   conta clique.
5. Simulando uma mensagem inbound de um número novo com o texto da
   mensagem padrão, o contato é criado com `source_link_id` do link e
   `source_utm` com os UTMs do último clique (ou os padrão do link se
   o clique não trouxe UTM); Conversas incrementa e a Taxa reflete
   conversas/cliques.
6. Mensagem inbound de contato JÁ existente com o mesmo texto não
   incrementa Conversas.
7. Tentar criar segundo link ativo com a mesma mensagem na mesma conta
   mostra erro amigável.
8. Os 4 cards batem com a soma da tabela.
9. Papel `viewer` vê a página mas não cria/edita/exclui (gates de UI e
   RLS).
10. Após conectar uma instância Evolution, `evolution_instances.phone`
    fica preenchido e o número aparece no select do modal.
11. Excluir um link não apaga contatos; `source_link_id` fica NULL e o
    snapshot `source_utm` permanece.

## Fora de escopo (fase 2+)

- Tela de gráfico/analytics por link (série temporal); os dados já
  ficam prontos em `link_clicks`.
- Limpeza/retenção de `link_clicks` antigos.
- Filtros por origem na página Contatos.
- Pixel/GA no redirect.
- Domínio curto próprio para os links.
- Atribuição por janela de tempo pós-clique.
