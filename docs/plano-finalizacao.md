# Plano de finalização do CRM OpenCRM

> ## STATUS DA EXECUÇÃO (2026-08-09)
>
> Verificação final: **build de produção compila**, typecheck limpo, **0 erros de lint**,
> **792 testes passando** (as 5 falhas restantes são `currency`/`date-utils`, de
> timezone/locale do Windows, pré-existentes e não-regressão).
>
> | Fase | Status |
> |---|---|
> | 0 — Kong / realtime | **NÃO FEITA — é sua.** Bloqueada pelo guardrail do assistente (escrita em config de infra). Diagnóstico fechado e derriscado. |
> | 1 — Sync (piscar) | ✅ Passos 1.1–1.8 |
> | 2 — CRM + ClickUp | ✅ 2.1–2.6, 2.8–2.14 · ❌ **2.7 (mídia recebida) não feita** |
> | 3 — UI/UX | ✅ 3.1, 3.2, 3.3, 3.5, 3.6 · ⚠️ 3.4 parcial (foco visível feito; alvos de toque de 44px não) |
> | 4 — Segurança | ✅ 4.1–4.7 |
>
> **Pendências honestas (leia antes de confiar):**
> 1. **Passo 2.7 (mídia)** — o executor parou e reportou, como o plano mandava: o formato
>    do payload de mídia da Evolution não está documentado em lugar nenhum do repo.
>    Implementar seria adivinhar o schema. **Áudio/foto do cliente continuam sendo
>    descartados.** Para destravar: capturar um payload real de mensagem de mídia.
> 2. **Passo 2.9 (ACK de entrega)** — implementado sobre o shape nativo do Baileys, mas
>    **não verificado contra a Evolution real**. Pode não correlacionar até alguém conferir
>    um ACK de verdade.
> 3. **Passo 2.10 (paridade)** — os *dispatches* foram replicados, mas quando a automação/
>    fluxo/IA tenta de fato **enviar** a resposta, ela passa por `meta-send.ts`, que só sabe
>    falar com a Meta oficial. Em conta que só tem Evolution, o disparo automático falha
>    (logado, não quebra o webhook). Fazer o `meta-send` conhecer a Evolution é outra rodada.
> 4. **Alvos de toque de 44px (3.4)** — não apliquei porque exigiria uma regra global de
>    tamanho mínimo que eu não consigo validar visualmente sem rodar o app; o risco de
>    quebrar layout denso era maior que o ganho.
>
> Nada foi commitado nem enviado. Migration **052 aplicada e testada apenas no DEV**.

Plano de implementação para fechar o CRM: **sync de mensagens → CRM/ClickUp → UI/UX → segurança**, nessa ordem.

Escrito para ser executado passo a passo. Cada passo diz **o arquivo, o que mudar e como verificar**. Quem executa não deve redesenhar nada: se um passo não bater com o código real, pare e reporte.

## Convenções (valem para todos os passos)

- Verificação obrigatória ao fim de cada fase: `npm run typecheck`, `npm run lint`, `npm run test`.
- Migrations novas começam em **052** (a 051 é `051_tracking_links.sql`, do outro dev).
- Comentários em PT-BR, no mesmo tom dos arquivos vizinhos (explicam o *porquê*, não o *o quê*).
- **Não commitar e não fazer push** — a revisão vem antes.
- Nada de mexer em produção. Migrations novas: aplicar só no banco DEV.
- Testes `currency.test.ts` e `date-utils.test.ts` já falham por timezone/locale do Windows — **não são regressão**, não tente "consertar".

---

# FASE 0 — Infra: consertar o Realtime (causa raiz)

**Contexto.** O Realtime nunca funcionou. Diagnóstico verificado em dev e prod:

| Camada | Estado |
|---|---|
| Containers realtime (dev + prod) | Up, healthy |
| Publication `supabase_realtime` | OK — `messages` e `conversations` publicadas |
| **Kong → realtime** | **Aponta para `realtime-dev.supabase-realtime:4000` — hostname NÃO resolve** |
| Hostname correto | `realtime` — resolve, porta 4000 aberta, serviço responde (403 = vivo, pede auth) |

Kong devolve `503 {"message":"name resolution failed"}` no `/realtime/v1/websocket`, enquanto `/rest/v1/` devolve 200. **É só roteamento do gateway.** Por isso existe o polling de 5s — e é o polling que faz piscar. Consertar o Kong é o que permite remover a gambiarra.

> **Esta fase é de infraestrutura e MEXE NO SERVIDOR. O executor NÃO deve fazê-la.**
> Fica documentada aqui para o dono do projeto aplicar. A Fase 1 foi desenhada para
> funcionar **mesmo se o Realtime continuar quebrado** (degrada para polling leve).

### Passo 0.1 — Corrigir o upstream do Kong (dev primeiro, depois prod)

Em `kong.yml`, nas duas entradas de realtime:

```yaml
# linha ~137
- name: realtime-v1-ws
  url: http://realtime-dev.supabase-realtime:4000/socket   # ANTES (não resolve)
  url: http://realtime:4000/socket                          # DEPOIS

# linha ~157
- name: realtime-v1-rest
  url: http://realtime-dev.supabase-realtime:4000/api       # ANTES
  url: http://realtime:4000/api                             # DEPOIS
```

Alternativa equivalente (se preferir não editar o kong.yml): adicionar no compose um
`network alias` chamado `realtime-dev.supabase-realtime` ao serviço `realtime`.

Depois: recarregar/reiniciar o Kong e validar com

```bash
curl -o /dev/null -w "%{http_code}" -H "apikey: <ANON>" \
  "<SUPABASE_URL>/realtime/v1/websocket?apikey=<ANON>&vsn=1.0.0"
```

**Aceite:** deixa de ser `503 name resolution failed`. Um `400` de "upgrade required" já
indica roteamento correto. Teste final: abrir o inbox em duas abas e ver a mensagem
aparecer numa quando enviada na outra, **sem recarregar**.

---

# FASE 1 — Sync de mensagens: acabar com o piscar

**Objetivo:** a conversa nunca mais pode sumir da tela; mensagem nova entra sem
remontar a lista; e o app continua correto com o realtime ligado *ou* quebrado.

Diagnóstico (arquivo:linha reais, confirmados):

| # | Problema | Onde |
|---|---|---|
| 1 | `setLoading(true)` roda antes do fetch e o ternário do render **desmonta a subárvore inteira** de mensagens → spinner no lugar da conversa a cada 5s. **É esta a piscada.** Mídia (`MediaImage`) é destruída e re-baixada junto. | `message-thread.tsx:297` + render em `:1042` |
| 2 | `setMessages(loaded)` **substitui o array inteiro** com objetos novos → mata bolha otimista `temp-` e invalida todos os `useMemo` | `page.tsx:532` |
| 3 | `setConversations(loaded)` idem → **ressuscita badge de não-lida** já zerado otimisticamente | `page.tsx:431` |
| 4 | Polling de 5s dispara 3 round-trips por ciclo, por aba | `page.tsx:410-417` |
| 5 | Queries sem `.limit()` — carregam a conversa inteira e todas as conversas | `message-thread.tsx:290-325`, `conversation-list.tsx:126-162` |
| 6 | Nenhum `React.memo` na árvore do inbox → N itens re-renderizam a cada ciclo | `src/components/inbox/*` |
| 7 | Auto-scroll forçado a cada ciclo | `message-thread.tsx:460-468` |
| 8 | Eventos `DELETE` do realtime não são tratados | `page.tsx:226-279`, `:293-341` |

### Passo 1.1 — Nunca mais trocar a conversa por um spinner

Arquivo: `src/components/inbox/message-thread.tsx`

- Na linha ~297, **só** ative o loading quando ainda não há nada na tela. Troque
  `setLoading(true)` por um loading que distingue **primeira carga** de **revalidação**:
  - crie um estado `revalidating` (bool) separado de `loading`;
  - `setLoading(true)` **apenas** se `messages.length === 0` (primeira carga da conversa);
  - caso contrário `setRevalidating(true)` — que **não** troca o render.
- No render (~`:1042`), o ternário do spinner deve olhar só para `loading`. A subárvore
  de mensagens **nunca** pode desmontar durante uma revalidação.
- Opcional e discreto: quando `revalidating`, mostre um indicador sutil no topo
  (ex.: uma barra fina), nunca substituindo o conteúdo.

**Aceite:** com o polling ligado, a lista de mensagens não pisca e uma imagem já
carregada não é re-baixada.

### Passo 1.2 — Reconciliar mensagens por id (parar de substituir o array)

Arquivo: `src/app/(dashboard)/inbox/page.tsx`, `handleMessagesLoaded` (~`:531-533`)

Troque a substituição integral por um merge que:
1. mantém a **identidade dos objetos já existentes** (se o registro não mudou, reusar o
   objeto anterior — comparar por `id` + `status` + `content_text` + `media_url`);
2. **preserva as bolhas otimistas** (`id` começa com `temp-`) que ainda não têm
   correspondente no banco;
3. ordena por `created_at` no fim.

Assinatura sugerida: extraia para `src/lib/inbox/merge-messages.ts` uma função pura
`mergeMessages(prev: Message[], incoming: Message[]): Message[]` — **com teste unitário**
(ver Passo 1.7).

### Passo 1.3 — Reconciliar conversas e não ressuscitar badge

Arquivo: `src/app/(dashboard)/inbox/page.tsx`, `handleConversationsLoaded` (~`:429-473`)

Mesmo tratamento do 1.2, mais uma regra: **não sobrescrever `unread_count` para cima**
numa conversa que está aberta (`activeConversation.id`) — ela foi zerada de propósito.
Extraia `mergeConversations(prev, incoming, activeId)` para `src/lib/inbox/merge-conversations.ts`,
também com teste.

### Passo 1.4 — Polling adaptativo (e desligável) em vez de 5s fixo

Arquivo: `src/app/(dashboard)/inbox/page.tsx` (~`:399-417`)

O polling deixa de ser uma rede fixa e passa a ser **fallback**:

- Se o realtime está conectado (`useRealtime` já expõe `isConnected`), o intervalo sobe
  para **60s** (só uma rede de segurança contra evento perdido).
- Se o realtime **não** está conectado, mantém um intervalo curto — **15s**, não 5s.
- Continua respeitando `document.visibilityState === "visible"`.
- Faça um resync imediato ao voltar o foco da aba (`visibilitychange`) e ao reconectar.

Passe `isConnected` do hook para essa decisão. Não invente config nova; use o que o
`use-realtime.ts` já devolve.

### Passo 1.5 — Limitar as queries

- `message-thread.tsx` (~`:290-325`): carregar as **últimas 200** mensagens
  (`.order("created_at", { ascending: false }).limit(200)` e inverter no cliente).
  Não construa paginação infinita agora — só o teto.
- `conversation-list.tsx` (~`:126-162`): `.limit(200)` na lista de conversas.

Se já houver mais que o teto, isso é aceitável nesta fase; anote como dívida no fim do
plano (seção "Fora de escopo").

### Passo 1.6 — Memoizar a árvore do inbox

- `React.memo` em `MessageBubble` (`message-bubble.tsx`) e no `ConversationItem`
  (`conversation-list.tsx:534`).
- Garanta que os callbacks passados a eles sejam estáveis (`useCallback`) — caso
  contrário o memo não serve pra nada.
- **Não** memoize `MessageThread`/`ConversationList` inteiros (recebem muitos props e o
  ganho é duvidoso).

### Passo 1.7 — Testes das funções puras

Crie `src/lib/inbox/merge-messages.test.ts` e `src/lib/inbox/merge-conversations.test.ts`
(vitest, no padrão dos testes existentes). Cubra, no mínimo:

- mensagem nova é adicionada na ordem certa;
- mensagem já existente e inalterada **mantém a mesma referência de objeto**;
- bolha `temp-` sobrevive a um merge que não a contém;
- bolha `temp-` é substituída quando a mensagem real chega;
- `unread_count` da conversa ativa não volta a subir;
- lista vazia de entrada não apaga o estado atual.

### Passo 1.8 — Tratar DELETE do realtime

Arquivo: `src/app/(dashboard)/inbox/page.tsx` (`handleMessageEvent` ~`:226`,
`handleConversationEvent` ~`:293`)

Adicione o ramo `eventType === "DELETE"`: remover a mensagem/conversa do estado pelo id
de `event.old`. (Só a PK vem no payload; é suficiente.)

**Aceite da Fase 1 (todos obrigatórios):**
1. `npm run typecheck`, `npm run lint`, `npm run test` passam (fora as 2 falhas de
   timezone já conhecidas).
2. Com o inbox aberto e o polling rodando, a lista de mensagens **não pisca** e o scroll
   não salta.
3. Enviar uma mensagem: a bolha "enviando" **não some** no meio do caminho.
4. Abrir uma conversa com não-lidas: o badge zera e **não volta**.
5. Os novos testes de merge passam.

---

# FASE 2 — Completar o CRM e a integração ClickUp

Ordenada por **impacto real no usuário**. Os itens 2.1–2.5 são baratos e corrigem
mentiras que o app conta hoje; 2.6–2.10 fecham funcionalidade que falta.

## 2A. ClickUp — parar de mentir e aguentar workspace real

### Passo 2.1 — Checar o `.ok` de TODAS as sub-requisições (falso negativo grave)

Arquivo: `src/lib/clickup/client.ts`

Hoje o resultado de várias chamadas é usado sem verificar se deu certo:
- `:211` — `const raw = (t.data as {tasks?})?.tasks ?? []` — **`t.ok` nunca é checado**. Se
  a busca falha (429/500), o painel afirma **"Tarefas abertas (0) — Nenhuma tarefa aberta"**.
  O CS conclui que o cliente não tem entrega pendente. É o pior bug do módulo.
- `:107-108` (`spacesRes`), `:114-115` e `:125` (`foldersRes`/`listsRes`) — idem; erro vira
  lista vazia e a UI diz "Nenhuma pasta/lista encontrada".

Corrija: se a sub-requisição falhar, **propague o erro** (`{ ok:false, error }`) em vez de
devolver lista vazia. A UI já sabe mostrar `data.error` (`clickup-panel.tsx`), e o estado
"não consegui ler" precisa ser distinto de "não há nada".

### Passo 2.2 — Paginação

Arquivo: `src/lib/clickup/client.ts`

A API do ClickUp devolve no máximo **100 itens por página**.
- `:207-210` (`/list/{id}/task`): pagine com `&page=N` até a página vir vazia ou
  `last_page: true`. Teto de segurança: **10 páginas** (1000 tarefas) — pare aí.
- `:106` (`/team/{id}/space`), `:111-112` (`/space/{id}/folder`, `/space/{id}/list`):
  mesma paginação, mesmo teto.

Sem isso, "Próxima entrega" (`src/app/api/inbox/clickup/route.ts:99-104`) fica errada em
qualquer cliente com mais de 100 tarefas.

### Passo 2.3 — Timeout, 429 com backoff, e fan-out com limite

Arquivo: `src/lib/clickup/client.ts`

- `call()` (`:19-29`): adicione `AbortController` com **timeout de 10s**.
- Trate **HTTP 429**: leia o header `Retry-After`; tente de novo até **2 vezes** com espera
  (mínimo 1s). Se ainda falhar, devolva um erro legível: *"O ClickUp está limitando as
  requisições. Tente de novo em instantes."*
- `listClickUpTargets` (`:91-141`) e `getTargetWithTasks` para pasta (`:166-168`) fazem
  fan-out sem freio (`Promise.all` sobre todos os spaces/listas). Limite a
  **4 requisições simultâneas** (helper simples de pool; não instale dependência).

### Passo 2.4 — Cache curto do catálogo

O catálogo de pastas/listas é a chamada mais cara e é refeito **a cada troca de conversa**
(o `ClickUpPanel` remonta por `key`). Adicione cache em memória no servidor, por usuário,
com **TTL de 5 minutos**, em `src/app/api/inbox/clickup/targets/route.ts` (um `Map` no
módulo já basta; anote no comentário que é por instância). O botão "Recarregar" da UI deve
poder furar o cache (`?fresh=1`).

### Passo 2.5 — Validar entrada do POST (e fechar a injeção de URL)

Arquivo: `src/app/api/inbox/clickup/route.ts`

- `:168` — `buildTargetUrl(type, body.id, body.teamId)`: hoje `teamId` e `id` vêm do cliente
  **sem validação** e são interpolados numa URL que é salva e depois vira `href` de
  `<a target="_blank">`. Exija `/^\d+$/` nos dois; rejeite com 400 caso contrário.
- `:141-147` — limite `name` a 200 caracteres.
- `:259-260` — `csOwner`: limite a 120 caracteres.
- `src/app/api/account/clickup/route.ts:75-86` — o **DELETE não checa `is_internal`**
  (GET e POST checam). Padronize.

### Passo 2.6 — Escrita no ClickUp: fechar o loop de trabalho

Hoje o painel é somente-leitura — o CS tem que sair do CRM pra qualquer ação. Implemente o
mínimo que fecha o ciclo:

1. `src/lib/clickup/client.ts`: permita método/body em `call()` e adicione
   - `createTask(apiKey, listId, { name, description })` → `POST /list/{id}/task`
   - `updateTaskStatus(apiKey, taskId, status)` → `PUT /task/{id}`
2. `src/app/api/inbox/clickup/task/route.ts` (novo):
   - `POST { conversationId, name, description? }` → cria tarefa na lista mapeada.
     Se o alvo for **pasta**, exija `listId` explícito no body (pasta não recebe tarefa).
   - `PATCH { conversationId, taskId, status }` → muda o status.
   - Ambos: gate `is_internal`, valida que a conversa é da conta (mesmo padrão do
     `route.ts` existente), usa a chave ClickUp **do próprio usuário**.
3. `src/components/inbox/clickup-panel.tsx`: botão **"Nova tarefa"** (abre um campo de
   título; cria na lista mapeada) e, em cada tarefa aberta, um seletor de status com as
   opções que a própria lista devolve.

> Se `GET /list/{id}` não trouxer os status disponíveis, **pare e reporte** — não invente
> uma lista fixa de status.

## 2B. WhatsApp/Evolution — parar de perder informação do cliente

### Passo 2.7 — Aceitar mídia recebida (hoje é descartada em silêncio)

Arquivo: `src/app/api/whatsapp/evolution/webhook/[secret]/route.ts`

Hoje só `conversation` e `extendedTextMessage` são lidos (`:145-148`) e grava-se sempre
`content_type: "text"` (`:174`). Foto, **áudio** (o formato mais usado por cliente),
vídeo e documento chegam e são **jogados fora** — vira mensagem vazia no inbox.
A Evolution já manda `base64: true` (`evolution-api.ts:196`), ou seja, o conteúdo **está
chegando**.

Implemente:
1. Extraia o tipo real da mensagem: `imageMessage`, `audioMessage`, `videoMessage`,
   `documentMessage`, `stickerMessage`, `locationMessage`. Mapeie para o
   `content_type` que o CRM já conhece (`image|audio|video|document|location|text`) —
   veja o enum em `supabase/migrations/001_initial_schema.sql`.
2. Legenda (`caption`) vai para `content_text`.
3. Mídia: salve no storage do projeto reusando o que o webhook da Meta já faz
   (`src/app/api/whatsapp/webhook/route.ts` usa `getMediaUrl`/`downloadMedia`; para a
   Evolution o base64 vem no payload) e grave a URL em `media_url`.
4. Tipo desconhecido: grave `content_type: "text"` com
   `content_text: "[tipo de mensagem não suportado]"` — **nunca** string vazia.

> Se o formato do payload de mídia da Evolution não estiver claro no código existente,
> **pare e reporte** em vez de adivinhar o caminho do base64.

### Passo 2.8 — Guardar o `message_id` do WhatsApp no envio (destrava o status de entrega)

Arquivos: `src/lib/whatsapp/evolution-api.ts` (`sendText`, `:315-325`) e
`src/lib/whatsapp/send-message.ts` (`:264-291`)

`sendText` hoje descarta o body da resposta e devolve só `{ok, status}`; o
`send-message.ts` grava a mensagem e retorna o **UUID interno** como se fosse o id do
WhatsApp (`:291`). Resultado: mensagem enviada pela Evolution fica **para sempre em
"enviado"**, e o ACK nunca poderá ser correlacionado — nem no futuro.

- `sendText` deve devolver também o `key.id` da resposta da Evolution.
- `send-message.ts` grava esse valor em `messages.message_id`.

### Passo 2.9 — Tratar `MESSAGES_UPDATE` (ACK de entrega)

Arquivo: `src/app/api/whatsapp/evolution/webhook/[secret]/route.ts`

O evento **já é assinado** (`evolution-api.ts:199`) e é **ignorado** (`:242` cai fora).
Adicione o ramo `messages.update`: correlacione pelo `key.id` (que o 2.8 passou a gravar) e
atualize `messages.status` conforme o ACK da Evolution
(`2 → delivered`, `3 → read`, erro → `failed`).

Depende do 2.8. Se o 2.8 não estiver feito, **não faça este** — reporte.

### Passo 2.10 — Paridade da Evolution com a Meta (automações, fluxos, IA, webhooks)

Arquivo: `src/app/api/whatsapp/evolution/webhook/[secret]/route.ts`

O webhook da Meta (`src/app/api/whatsapp/webhook/route.ts`) chama
`runAutomationsForTrigger`, `dispatchInboundToFlows`, `dispatchInboundToAiReply` e
`dispatchWebhookEvent`. O da Evolution **não chama nenhum**. Como a Evolution é o provedor
principal, hoje **automação, fluxo, resposta de IA e webhook de saída simplesmente não
funcionam** para a maioria dos clientes.

Replique as mesmas chamadas, no mesmo ponto do ciclo (depois do insert da mensagem
confirmar), com os mesmos argumentos. **Só para conversas 1:1** — mantenha grupos de fora
(igual ao que já é feito com lead/atribuição, `:193` e `:205`), para não disparar
automação de vendas dentro de grupo de cliente.

### Passo 2.11 — Nome do grupo deixa de ficar congelado

Arquivo: `src/lib/whatsapp/resolve-group.ts` (`:83-85`)

O nome só é buscado na **criação**. Se falhar, o grupo fica para sempre como
`"Grupo 123456"` — e isso quebra a sugestão automática do card do ClickUp, que casa **pelo
nome**.

Faça: quando o contato-grupo já existe **e** o nome ainda é o provisório (`^Grupo \d+$`),
tente buscar o `subject` de novo e atualize. Não busque em toda mensagem — só nesse caso.

### Passo 2.12 — Contato-grupo não pode poluir contatos e disparos

`resolve-group.ts:92` grava o JID (`...@g.us`) na coluna `phone`. Hoje o grupo aparece na
lista de Contatos, entra em **públicos de broadcast** e infla métricas. Risco real de um
disparo em massa ir para o JID de um grupo.

Filtre `is_group = false` (ou `is_group is null`) em:
- listagem de Contatos (`src/app/(dashboard)/contacts/page.tsx`);
- seleção de público de broadcast (`src/components/broadcasts/step2-select-audience.tsx`);
- contagens do dashboard que contam contatos (`src/lib/dashboard/queries.ts`).

Procure outros pontos com `grep -rn "from(\"contacts\")" src` e avalie caso a caso.

### Passo 2.13 — Guarda de grupo nas rotas que assumem telefone

`src/app/api/whatsapp/react/route.ts` usa `sanitizePhoneForMeta(contact.phone)` — para um
grupo isso é o JID, não um telefone. Rejeite com 400 e mensagem clara quando
`contact.is_group` for verdadeiro.

### Passo 2.14 — Tipos alinhados com o banco

`src/types/index.ts` (~`:192`): a interface `Conversation` não tem `clickup_ref_type`,
`clickup_ref_id`, `clickup_ref_name` (migration 050) — as rotas contornam com `as {...}`
inline. Adicione os campos e remova os casts que ficarem desnecessários.

### Passo 2.15 — Testes desta fase

Crie testes (vitest, padrão dos existentes):
- `src/lib/clickup/client.test.ts` — cobrindo: sub-requisição que falha **não** vira lista
  vazia (2.1); paginação junta as páginas e respeita o teto (2.2); 429 tenta de novo e
  depois desiste com erro legível (2.3).
- `src/lib/whatsapp/resolve-group.test.ts` — criação, reuso do contato existente, corrida
  (unique violation) e a atualização do nome provisório (2.11).

**Aceite da Fase 2:**
1. `typecheck`, `lint`, `test` passam.
2. Falha de leitura do ClickUp aparece como **erro** na UI, nunca como "0 tarefas".
3. Lista com mais de 100 tarefas mostra todas (até o teto) e a "próxima entrega" bate.
4. Áudio/imagem recebidos pela Evolution aparecem no inbox com o conteúdo acessível.
5. Mensagem enviada pela Evolution guarda o `message_id` do WhatsApp.
6. Conversa 1:1 recebida pela Evolution dispara automação/fluxo/IA/webhook.
7. Grupo não aparece na lista de Contatos nem em público de broadcast.

---

# FASE 3 — UI/UX

Duas rodadas de heurísticas de Nielsen já foram feitas (ver `docs/ux-backlog-nielsen.md`).
O que sobra aqui foi **verificado no código agora** — não é lista genérica.

### Passo 3.1 — Respeitar `prefers-reduced-motion` (acessibilidade, crítico)

Verificado: **não existe nenhuma** ocorrência de `prefers-reduced-motion` ou `motion-reduce`
no projeto, e o app usa animação em vários lugares (`animate-spin`, `animate-pulse`,
`animate-ping`, `transition-*`).

Em `src/app/globals.css`, adicione um bloco global:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Isso cobre o app inteiro de uma vez, sem caçar componente por componente.

### Passo 3.2 — Altura do inbox quebra em mobile (`100vh`)

`src/app/(dashboard)/inbox/page.tsx:597` usa `h-[calc(100vh-3.5rem)]`. Em navegador mobile
`100vh` **inclui a barra do navegador**, então o composer fica escondido atrás dela — o
usuário não vê o que está digitando.

Troque por `100dvh` (`h-[calc(100dvh-3.5rem)]`). É a única ocorrência de `100vh` no projeto.

### Passo 3.3 — Imagens sem dimensão (layout shift)

Há 7 `<img>` em `src/components`. Em cada um, garanta `width`/`height` **ou**
`aspect-ratio` via classe, para reservar o espaço antes do carregamento. Onde a dimensão
real é desconhecida (mídia recebida), use um contêiner com proporção fixa e
`object-cover`. Adicione `loading="lazy"` nas que não estão na primeira dobra.

### Passo 3.4 — Alvos de toque e foco visível nos botões "crus"

Vários `<button>` sem componente (os de ícone que foram adicionados nas rodadas
anteriores — painel ClickUp, lista de conversas, header, bolha de mensagem) têm
área menor que 44×44px e **nenhum anel de foco** (o componente `Button` do projeto já tem;
esses não).

Em cada `<button>` cru de ícone dessas telas:
- garanta área mínima de toque (ex.: `p-2` + `min-h-11 min-w-11` no mobile, ou `hitbox`
  via `before:absolute before:-inset-2`);
- adicione `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`.

Não altere o componente `Button` — só os `<button>` soltos.

### Passo 3.5 — Números tabulares onde há contagem

Contadores que mudam sozinhos (badge de não-lidas, "Tarefas abertas (N)", estatísticas dos
cards de cliente) devem usar `tabular-nums` para não "dançar" a cada atualização. Vários já
usam; padronize os que faltam.

### Passo 3.6 — Indicador de revalidação (fecha a Fase 1)

Do Passo 1.1 sobrou o indicador sutil: quando `revalidating` for verdadeiro no
`MessageThread`, mostre uma barra fina de 2px animada no topo da thread (ou um ponto
discreto ao lado do título) — **nunca** substituindo o conteúdo. Respeite o 3.1.

**Aceite da Fase 3:**
1. Com "reduzir movimento" ligado no sistema, nada mais pulsa/gira.
2. No mobile (375px), o composer do inbox fica visível e acessível.
3. `typecheck`, `lint`, `test` passam.

---

# FASE 4 — Segurança

Auditoria feita e **confirmada de primeira mão** nos pontos críticos. Nota: o item
"chaves padrão do Supabase" que aparece em `docs/backlog.md` (P0.1) **já foi resolvido** —
as chaves foram rotacionadas e validadas. Ignore-o.

### Passo 4.1 — 🔴 CRÍTICO: fechar a escrita cross-tenant via `profiles`

**Confirmado no código.** A policy permite ao usuário editar o próprio `account_id`:

```sql
-- supabase/migrations/017_account_sharing.sql:614-616
CREATE POLICY profiles_update ON profiles FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);   -- sem restrição de COLUNA
```

E duas rotas usam esse valor como chave de tenancy **escrevendo com service role**
(que ignora RLS):
- `src/app/api/automations/route.ts:36-47` → `supabaseAdmin()` na linha 97
- `src/app/api/flows/route.ts:57-68` → `admin.from('flows').insert(...)` (`:100`, `:149`)

Cadeia de ataque: usuário troca o próprio `account_id` para o UUID de outro cliente →
`POST /api/automations` com passo `send_webhook` → passa a receber, no servidor dele, cada
mensagem que chega no WhatsApp do cliente-alvo.

**São dois consertos independentes. Faça os dois.**

**(a) Migration `052_lock_profile_privileged_columns.sql`** — trigger `BEFORE UPDATE ON
profiles` que rejeita alteração das colunas privilegiadas quando o autor não é service
role. Colunas a proteger: `account_id`, `active_account_id`, `account_role`, `is_internal`,
`is_client_login`, `agency_owner_id`.

Esboço (ajuste ao estilo das migrations existentes):

```sql
CREATE OR REPLACE FUNCTION public.guard_profile_privileged_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- service_role escreve livre (rotas server-side já validam posse).
  IF current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF NEW.account_id IS DISTINCT FROM OLD.account_id
     OR NEW.active_account_id IS DISTINCT FROM OLD.active_account_id
     OR NEW.account_role IS DISTINCT FROM OLD.account_role
     OR NEW.is_internal IS DISTINCT FROM OLD.is_internal
     OR NEW.is_client_login IS DISTINCT FROM OLD.is_client_login
     OR NEW.agency_owner_id IS DISTINCT FROM OLD.agency_owner_id
  THEN
    RAISE EXCEPTION 'coluna privilegiada de profiles nao pode ser alterada pelo usuario';
  END IF;
  RETURN NEW;
END $$;
```

> **Cuidado:** a troca de conta ativa legítima passa por `setActiveAccount`
> (`src/lib/auth/account.ts`). **Verifique por qual cliente ela escreve.** Se ela usa o
> cliente do usuário (anon/RLS) e não o service role, o trigger vai quebrá-la — nesse caso
> ela precisa passar a escrever via service role (ela já revalida a posse contra
> `account_members`, então é seguro). **Confirme isso antes de aplicar; se ficar em dúvida,
> pare e reporte.**

**(b)** Trocar a resolução de conta nas duas rotas por `getCurrentAccount()`
(`src/lib/auth/account.ts`), que já revalida contra `account_members` e é fail-closed —
exatamente como as outras rotas fazem. Remover a leitura direta de `profiles.account_id`.

**Aplicar a migration só no banco DEV.**

### Passo 4.2 — 🟠 SSRF no passo `send_webhook` das automações

`src/lib/automations/engine.ts:530-541` faz `fetch(cfg.url, ...)` direto na URL informada
pelo usuário, sem nenhuma validação. O projeto **já tem** a proteção pronta e a usa no
outro caminho: `src/lib/webhooks/deliver.ts:93` chama `isDeliverableUrl` de
`src/lib/webhooks/ssrf.ts:64-79` (bloqueia IP privado/reservado e trata redirect).

Aplique `isDeliverableUrl` antes do `fetch` em `engine.ts`. Se a URL for recusada, registre
a falha no log da automação (do jeito que os outros erros de passo já são registrados) e
siga — não derrube a automação inteira.

Isso importa porque o Supabase é **self-hosted na mesma VPS**: sem o guard, dá pra fazer o
servidor chamar `http://kong:8000`, `127.0.0.1` ou a rede interna.

### Passo 4.3 — 🟡 Gate de `/api/account/team-member`

`src/app/api/account/team-member/route.ts:33-42` só exige "ser owner de alguma conta" —
mas **todo signup vira owner da própria conta** (documentado em
`src/lib/auth/platform-admin.ts:7-14`). Ou seja, qualquer usuário logado consegue chamar
`admin.auth.admin.createUser` e criar logins arbitrários, com a senha devolvida na resposta.

Troque o gate por `requirePlatformAdmin()` (mesmo padrão de
`src/app/api/admin/users/route.ts:20`).

> Isto **muda quem pode criar operador**. Se hoje algum fluxo legítimo depende de um
> não-platform-admin criar operador, **pare e reporte** em vez de quebrar o fluxo.

### Passo 4.4 — 🟡 `connect-link` não pode confiar no header `Host`

`src/app/api/account/workspaces/[id]/connect-link/route.ts:55-60` monta a URL do link
público a partir de `x-forwarded-host`/`host`. Com um header forjado, o link devolvido
aponta para um domínio do atacante **carregando o token de conexão**.

A rota irmã já faz certo e explica o porquê:
`src/app/api/whatsapp/evolution/connect-public/route.ts:55-72` usa
`resolveConfiguredBaseUrl()` e recusa com 503 se não estiver configurado. Use a mesma
função aqui.

### Passo 4.5 — 🟡 Rate limit nos endpoints públicos

O projeto já tem `checkRateLimit` (`src/lib/rate-limit.ts`) e o usa em outras rotas.
Aplique **por IP** em:
- `src/app/api/whatsapp/evolution/status-public/route.ts` (cada request bate na Evolution
  e faz UPDATE);
- `src/app/api/whatsapp/evolution/connect-public/route.ts` (cria/reconfigura instância e
  consome vaga de proxy);
- `src/app/t/[code]/route.ts` (registra clique a cada GET).

Use como referência `src/app/api/invitations/[token]/peek/route.ts:59-61`.
Não é força bruta de token (32 bytes aleatórios), é **amplificação/DoS**.

### Passo 4.6 — 🟡 Comparação de segredo em tempo constante no cron

`src/app/api/automations/cron/route.ts:22-25` compara com `!==`. A rota irmã
`src/app/api/flows/cron/route.ts:38-46` usa `timingSafeEqual` com pré-checagem de tamanho.
Padronize pelo jeito correto.

### Passo 4.7 — Teste de regressão do isolamento

Crie `src/app/api/automations/route.test.ts` (ou estenda o existente, se houver) cobrindo:
- criar automação usa a conta resolvida por `getCurrentAccount()`, **não** o
  `profiles.account_id` cru;
- `account_id` vindo do body/perfil adulterado **não** é respeitado.

**Aceite da Fase 4:**
1. Trocar `profiles.account_id` pelo cliente do browser passa a falhar.
2. `POST /api/automations` cria na conta validada, mesmo com perfil adulterado.
3. `send_webhook` para `127.0.0.1`/IP privado é recusado e registrado.
4. Endpoints públicos respondem 429 sob repetição.
5. `typecheck`, `lint`, `test` passam.

---

# ⚠️ PRÉ-REQUISITOS DE DEPLOY (bloqueantes)

Levantados na revisão. **Sem isto, o deploy quebra coisa que hoje funciona.**

### 1. `PLATFORM_ADMIN_USER_IDS` precisa existir em produção

O Passo 4.3 troca o gate de `POST /api/account/team-member` ("Adicionar operador") para
`requirePlatformAdmin()`, que é **fail-closed**: env ausente ou vazia = **ninguém** é admin
de plataforma.

**Verificado no container de produção: a variável está AUSENTE.** Consequências:
- depois do deploy, o botão "Adicionar operador" passaria a responder 403 para todo mundo;
- (efeito colateral já existente hoje: as rotas `/api/proxies/*`, que já usavam esse gate,
  já estão inertes em produção pelo mesmo motivo).

**Antes de subir**, defina no Easypanel (projeto `OpenCRM-crm`, serviço `api`, aba Ambiente):

```
PLATFORM_ADMIN_USER_IDS=473e4660-8452-4f6a-929e-b8c2e4436e13,6e6080ea-1367-46d9-ab27-7607cdbbf7f5
```

(São os dois UUIDs de dono já usados no ambiente de desenvolvimento. Confirme que são os
mesmos usuários em produção antes de colar.)

### 2. Migrations a aplicar em produção

- **051** (`051_tracking_links.sql`, do outro dev) — nunca foi aplicada em produção.
- **052** (`052_lock_profile_privileged_columns.sql`) — a correção crítica desta rodada.
  Já aplicada e testada **no DEV**.

### 3. Kong (Fase 0) — dev e prod

Sem isso o realtime continua morto e o inbox segue no polling de 15s (funcional, mas longe
do ideal). Ver Fase 0.

---

# Fora de escopo desta rodada (dívida consciente)

Registrado para não parecer esquecimento:

- **Paginação real** do inbox (scroll infinito). A Fase 1 põe teto de 200; carregar
  histórico antigo fica para depois.
- **ClickUp: comentários e anexos/materiais.** O Passo 2.6 entrega criar tarefa e mudar
  status; comentário e anexo são outra rodada.
- **Webhook de entrada do ClickUp** (status mudou lá → reflete aqui). Hoje só há refresh
  manual e o cache de 5 min.
- **Participantes de grupo** (JID real de quem falou, menções). Hoje só `pushName`.
- **Eventos de ciclo de vida do grupo** (`GROUPS_UPDATE`, `GROUP_PARTICIPANTS_UPDATE`,
  sair/entrar do grupo).
- **Envio de mídia em grupo pela Evolution** (o Passo 2.7 resolve o **recebimento**; o
  envio segue só texto). No mínimo, a UI deveria desabilitar o anexo em conversa de grupo
  — se sobrar tempo, faça isso no `message-composer.tsx`.
- **Validador de schema** (zod) nas rotas. Hoje toda validação é manual.
- **Rate limiter distribuído** (hoje é `Map` em memória, por processo).
- **Migration 051** (links rastreáveis, do outro dev) **não foi aplicada em produção** —
  quem for pro deploy precisa aplicar.

