# Contexto do Projeto: opencrm (OpenCRM)

> **Atualização de 12/08/2026:** o quadro antigo de duas branches abaixo é
> histórico. O modelo multi-cliente, Evolution, Portal de Clientes e
> onboarding de anúncios já estão integrados em `main`. Para continuar de
> outra máquina, leia primeiro
> [`continuar-de-outro-pc.md`](./continuar-de-outro-pc.md). Para criar o app
> global da Meta usado por WhatsApp, templates e Meta Ads OAuth, siga
> [`meta-app-configuracao.md`](./meta-app-configuracao.md).

> **Segurança Evolution:** houve relato de mensagens que deixaram de aparecer
> no telefone durante um teste. A auditoria não encontrou operações
> destrutivas no CRM, mas o número afetado deve permanecer desconectado até a
> investigação descrita em `whatsapp-providers.md`. Teste reconexão primeiro
> com número descartável.

> Snapshot de **29/07/2026**. Consolida o estado das duas branches ativas.
> Documento de leitura: descreve o que **existe hoje**, não o que se pretende construir.

> ⚠️ **Leia primeiro**: a documentação detalhada do projeto já existe, mas vive na branch
> `feat/multi-tenant`, não na `main`. São cinco arquivos em `docs/` (README, infra,
> multi-tenant, whatsapp-providers, roadmap, continuar-de-outro-pc). Este documento é o
> mapa consolidado; para o detalhe de cada área, vá nos arquivos originais:
> ```bash
> git checkout feat/multi-tenant   # ou: git show origin/feat/multi-tenant:docs/roadmap.md
> ```

---

## 1. A informação mais importante: onde está o quê

O projeto vive em **duas branches**, e elas contam histórias diferentes. Confundir as duas
é a principal fonte de erro ao entrar no projeto.

| | `main` (produção) | `feat/multi-tenant` (o trabalho real) |
|---|---|---|
| **WhatsApp** | Só Meta Cloud API (oficial) | **Evolution API (Baileys/QR) como principal** + Meta como opção |
| **Contas** | Single-tenant na UI | Multi-cliente (modelo agência, estilo Trizup) |
| **Migrations** | 001 a 030 | 001 a **039** |
| **Portal do Cliente** | Não existe | `/conectar/<token>`, link público sem login |
| **Documentação** | Só `docs/public-api.md` | Seis documentos em `docs/` |
| **Status** | No ar | Construído, validado em parte, **aguardando merge** |

**Consequência prática:** se você olhar só a `main`, vai concluir que o projeto usa API
oficial e que proxy não faz sentido. Está errado. O provedor principal decidido pelo time
é a **Evolution**, e ela está implementada na branch.

---

## 2. O que é o projeto

Fork privado (`agenciaOpenCRM/opencrmOpenCRM`) do template open-source `opencrm`
(`ArnasDon/opencrm`, MIT), evoluído para o **modelo de agência**: uma conta da agência
gerencia vários clientes, cada um isolado, cada um com seu próprio WhatsApp. O cliente
final **não tem login**: é um workspace que a agência opera por ele.

Módulos herdados do template e funcionando:

| Módulo | O que faz |
|---|---|
| Inbox compartilhada | Vários atendentes, atribuição por conversa, status, notas |
| Contatos | Tags, campos customizados, importação CSV, deduplicação por telefone |
| Pipelines | Kanban de vendas, negócios ligados a conversas |
| Broadcasts | Disparo por templates, tracking de entrega e leitura |
| Automações | Gatilhos, condições, esperas, tags, webhooks |
| Flows | Construtor visual de chatbot (botões, listas, mídia, coleta de input) |
| Agentes de IA | BYO-key (OpenAI/Anthropic), rascunho, auto-reply, base de conhecimento com RAG |
| Dashboard | Tempo de resposta, volume, valor do pipeline |
| API REST pública | `/api/v1` com chaves escopadas + webhooks de saída assinados |

---

## 3. Stack e infraestrutura

### Aplicação
- Next.js **16.2.6** (App Router), React 19.2.4, TypeScript 6, Turbopack.
- Tailwind v4, shadcn/ui, Base UI, ícones Lucide.
- `@xyflow/react` (flows), `@dnd-kit` (kanban), `recharts`, `opus-recorder` (áudio).
- Vitest (~45 arquivos de teste, concentrados em `src/lib/`).

> ⚠️ O `AGENTS.md` avisa: esta versão do Next.js tem breaking changes em relação ao que a
> maioria dos devs e modelos conhece. A documentação canônica está em
> `node_modules/next/dist/docs/`. Consulte antes de mexer em roteamento, server actions ou cache.

### Infra (VPS Hostinger, IP `31.97.249.95`)

Gerenciada por **Easypanel** (Docker Swarm + Traefik com HTTPS automático). 8 GB RAM.

| Serviço | Projeto Easypanel | Observação |
|---|---|---|
| App Next.js | `opencrm-supabase` / serviço `app` | Build por Nixpacks, sem Dockerfile |
| Supabase self-hosted | `opencrm-supabase` | Auth, Storage, Realtime, pgvector |
| **Evolution dedicada ao CRM** | `evolution-crm` | Postgres + Redis próprios, API key própria |
| Evolution antiga (n8n) | `evolution` | **Não mexer**, é de outro sistema |

Também rodam na VPS e **não devem ser tocados**: Supabase antigo, n8n, `OpenCRM-crm`,
`OpenCRM-dashboard`.

**Deploy:** push para a branch que o serviço aponta, depois "Implantar" no Easypanel. Para
testar a `feat/multi-tenant` sem afetar produção, troque o Ramo do serviço `app` e reimplante.

**Migrations:** aplicação manual via `psql` no container do Postgres, cada arquivo em
transação única (`-1`). Comando exato em [`infra.md`](./infra.md).

---

## 4. WhatsApp: os dois provedores

### 4.1 Evolution API (principal, não-oficial, QR)

Implementado em `feat/multi-tenant`. É **Baileys por baixo**: emulação de WhatsApp Web.

**Cliente:** [`src/lib/whatsapp/evolution-api.ts`](../src/lib/whatsapp/evolution-api.ts)
(server-only). Config por env: `EVOLUTION_API_URL` e `EVOLUTION_API_KEY`.

| Função | Uso |
|---|---|
| `createInstance` | Cria a instância com webhook apontado para o CRM, retorna o QR |
| `connectInstance` | Busca um QR fresco |
| `getConnectionState` | `open` / `connecting` / `close` / `unknown` |
| `deleteInstance` | Remove ao excluir o cliente |
| `sendText` | Envia texto (só texto por enquanto) |

**Convenção-chave:** o nome da instância **é o `account_id`**. É assim que o webhook sabe
de qual cliente é a mensagem.

**Tabela** `evolution_instances` (migration 036): `account_id` (PK), `instance_name`,
`status`, `phone`, `connect_token_hash` (039). RLS por membership; leitura escopada à
conta ativa.

**Rotas:**
```
POST /api/whatsapp/evolution/connect          (admin+, gera QR na UI)
POST /api/whatsapp/evolution/connect-public   (público, via token do portal)
GET  /api/whatsapp/evolution/status           (polling autenticado)
GET  /api/whatsapp/evolution/status-public    (polling público)
POST /api/whatsapp/evolution/webhook/<segredo> (recebe messages.upsert + connection.update)
```

O segredo vem de `EVOLUTION_WEBHOOK_SECRET` (env) e é comparado em tempo
constante. Sem a env configurada, a rota não processa nenhum evento
(fail-closed); com a env configurada mas segredo errado no caminho,
responde 404 (não confirma que a rota existe).

**Portal do Cliente** (`/conectar/<token>`): a agência gera um link público no hub de
Clientes; o token é aleatório e só o **hash SHA-256** fica no banco (mesma ideia dos
convites). O cliente abre no celular, escaneia o QR, e a página faz polling até a Evolution
reportar `open`. Gerar um link novo invalida o anterior. O `middleware.ts` libera as rotas
`-public` e `/conectar` sem login.

**Envio** ([`send-message.ts`](../src/lib/whatsapp/send-message.ts) na branch): se a conta
tem instância `connected`, o envio vai pela Evolution. Se o tipo não for `text`, rejeita com
"por enquanto a Evolution envia apenas texto". A escolha de provedor é implícita
(tem instância conectada? usa Evolution; senão, Meta), ainda não há coluna `provider`.

### 4.2 Meta Cloud API (opção, oficial)

Herdado do template, funcionando, conectado a um **número de teste** com token permanente
(System User). Toda a camada está em [`meta-api.ts`](../src/lib/whatsapp/meta-api.ts)
(~1.100 linhas, `graph.facebook.com/v21.0`): texto, mídia, templates, reações, botões,
listas, upload resumable, ciclo de vida de templates.

O webhook da Meta (`/api/whatsapp/webhook`, 1.068 linhas) valida HMAC-SHA256 com
`META_APP_SECRET`, roteia por `phone_number_id` para a conta certa, e trata a escada de
status `pending → sent → delivered → read → replied` sem regressão.

**Correção do 9º dígito BR** ([`phone-utils.ts`](../src/lib/whatsapp/phone-utils.ts), commit
`d5d10fc`): a Meta às vezes entrega o WA ID de celular brasileiro sem o 9 inicial (forma
legada de 8 dígitos), enquanto o número discável tem 9. O `phoneVariants()` gera as duas
formas, além das variantes com e sem 0 de tronco. Quando uma variante funciona, o telefone
do contato é corrigido no banco.

---

## 5. Multi-tenant (migrations 031 a 039)

O template era single-tenant. A fundação já vinha da migration 017 (`account_id` em toda
tabela + RLS por `is_account_member`). Faltava permitir **um usuário em várias contas**.

| Migration | O que faz |
|---|---|
| `031` | Tabela `account_members` (N:N). Reescreve `is_account_member`. Adiciona `profiles.active_account_id` |
| `032` | RPC `create_workspace(name)`, atômico |
| `033` | Função `in_active_account()`. Troca os `*_select` de 14 tabelas para usá-la |
| `034` | RPC `agency_overview()`, métricas por cliente |
| `035` | Adiciona `whatsapp_connected` ao overview (só Meta) |
| `036` | Tabela `evolution_instances` |
| `037` | Overview conta WhatsApp de **qualquer** provedor |
| `038` | RPC `delete_workspace()`, só owner |
| `039` | Coluna `connect_token_hash` (link público) |

**Distinção importante:** `is_account_member` é **segurança** (isolamento entre agências,
imposto por RLS). `in_active_account` é **escopo de visão** (qual cliente estou operando).
Um bug no escopo mostra seus próprios outros clientes (cosmético); nunca vaza entre agências.

Isolamento verificado por testes RLS no banco, impersonando JWT: membro perde o vínculo,
perde o acesso na hora, mesmo com os dados existindo.

---

## 6. A questão do PROXY: o outro dev está certo

> **Atualização (Fase 1 do anti-ban, branch `feat/antiban-fase1`)**: os itens 1 a 3 da
> lista "O que precisa ser feito" abaixo (proxy residencial/móvel, por instância, sticky)
> estão implementados em código nesta branch: pool próprio (tabela `proxies`), atribuição
> automática, checagem de saúde e detecção de vazamento de IP. O item 4 (geo-alvo por DDD)
> tem a lógica pronta, mas hoje é código morto em produção: `evolution_instances.phone`
> nunca é escrito em lugar nenhum, então a seleção nunca chega a casar a região do proxy
> com o DDD do número. Falta a validação de ponta a ponta com uma instância real conectada
> (ver seção 7). O texto abaixo descreve o raciocínio original que motivou o trabalho; para
> o estado atual e o detalhe técnico, veja [`whatsapp-providers.md`](./whatsapp-providers.md).

Preciso corrigir o que eu disse antes. Minha primeira leitura foi só da `main`, onde só
existe a API oficial da Meta, e ali proxy realmente não teria efeito. **Mas o provedor
principal do projeto é a Evolution**, e isso muda tudo.

### Por que agora se aplica

Evolution API roda **Baileys**: emulação de WhatsApp Web. A diferença arquitetural é toda:

| | Meta Cloud API (oficial) | **Evolution / Baileys (o que vocês usam)** |
|---|---|---|
| Quem conecta ao WhatsApp | A Meta, na infra dela | **A sua VPS**, fingindo ser um navegador |
| Seu IP importa? | Não | **Sim: é o IP da sessão do número** |
| Proxy ajuda? | Não | **Sim, é a principal mitigação de IP** |
| Risco de ban | Baixo | **Alto, e inerente** |

Hoje **todas as instâncias saem pelo mesmo IP de datacenter da VPS** (`31.97.249.95`). Para
o WhatsApp, isso é o pior cenário possível: dezenas de números de clientes diferentes,
espalhados pelo Brasil, todos conectando do mesmo IP de datacenter em Hostinger. É
exatamente o padrão que os sistemas de detecção procuram.

### O que precisa ser feito

O `whatsapp-providers.md` já documenta os requisitos corretos:

1. **Proxy residencial ou móvel**, não datacenter. Instalar um proxy *na VPS* não resolve:
   o IP continua sendo de datacenter, que é justamente o que o WhatsApp marca. Precisa
   rotear a saída por um serviço de IP residencial.
2. **Por instância**, não global. A Evolution suporta proxy por instância, então cada
   cliente pode sair por um IP próprio.
3. **Sticky / dedicado**: o mesmo IP persistente por número. IP que troca toda hora é
   suspeito por si só.
4. **Geo-alvo**: provedores de proxy residencial permitem escolher cidade/estado. O ideal é
   o IP bater com o DDD do número do cliente.

Custo: pago, por GB ou por IP/mês. A VPS só hospeda o cliente de proxy que roteia para o
serviço residencial.

### O que proxy **não** resolve

Proxy trata o vetor de IP. Não trata comportamento. O risco de ban no não-oficial é
**inerente e não eliminável**, só redutível. Continua sendo necessário:

- **Aquecimento** de número novo (volume crescente, não sair disparando).
- **Rate limit com intervalo aleatório** entre envios, nunca rajada.
- **Nunca disparo idêntico em massa**: variar o texto.
- **Opt-out** respeitado (`PARAR` / `SAIR`).

Disparo em massa é o uso que mais queima número, com ou sem proxy.

---

## 7. Pendências, por prioridade

### 🔴 Bloqueadores de produção (segurança)

1. **As chaves do Supabase são as PADRÃO do template.** A anon key em runtime tem
   `iss: supabase-demo`. Se o `JWT_SECRET` também for o padrão (provável, já que a anon
   demo é aceita), **qualquer pessoa consegue forjar um token `service_role` e ler ou
   escrever tudo no banco**. Regenerar `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`,
   `SECRET_KEY_BASE` e `VAULT_ENC_KEY`, atualizar as envs do Supabase e do app, reiniciar.
2. **Verify token de webhook fraco** (`1234567890` no teste). Trocar antes de número de produção.
3. **SMTP desligado**: convites de equipe e recuperação de senha não enviam e-mail.

### 🟡 Infra

- **Realtime falhando** (503 no WebSocket, tenant `realtime-dev`). Efeito: mensagens novas
  só aparecem ao recarregar. Não bloqueia.
- **Backups do banco** não configurados. Hoje, se o disco morrer, perde tudo.
- **Domínio próprio** no lugar do `...easypanel.host`.

### 🔵 WhatsApp Evolution

1. **Testar o envio real** pelo CRM. Deu erro no primeiro teste, ainda não validado.
2. **Testar o link público ponta a ponta** com um cliente remoto real.
3. **Validar o pool de proxies em produção**. Implementado em código na Fase 1 (pool
   global, atribuição automática, checagem de saúde, detecção de vazamento; a preferência
   por DDD ainda não tem efeito, ver seção 6). Falta confirmar `GET /api/proxies/health`
   sem vazamento e o proxy de fato aplicado numa instância real conectada.
4. **Mídia e template** no envio via Evolution (hoje só texto).
5. **Fases 2 a 4 do anti-ban**: fila com throttle, aquecimento, opt-out, saúde por número.
   A Fase 1 cobriu só a camada de rede (proxy). Ver
   [`superpowers/specs/2026-07-29-antiban-evolution-design.md`](./superpowers/specs/2026-07-29-antiban-evolution-design.md).
6. **Abstração de provedor** limpa (coluna `provider` no config) no lugar do "tem instância
   conectada?" implícito de hoje.

### 🟢 Multi-tenant

- **Merge `feat/multi-tenant` → `main`** quando aprovado.
- Escopo por conta ativa das tabelas-filho (`messages` nas métricas, `notifications`,
  `api_keys`, `ai_*`). Cosmético.
- **Convites de equipe**: hoje `redeem_invitation` (migration 019) **move** o usuário de
  conta. No multi-conta deve **adicionar** um vínculo em `account_members`, senão o
  convidado perde a conta anterior.

---

## 8. Lacunas herdadas do template (valem para os dois provedores)

Encontradas lendo o código, não estão documentadas no `roadmap.md`:

- **Broadcast sem throttle.** [`broadcast-core.ts`](../src/lib/whatsapp/broadcast-core.ts)
  percorre até 1.000 destinatários em laço `for` chamando a API o mais rápido que ela
  responder. Sem sleep, jitter ou pacing. Com Evolution isso é especialmente perigoso.
- **Sem opt-out.** Nenhum tratamento de `PARAR` / `SAIR` na entrada, nenhum campo no
  contato, nenhum filtro no disparo.
- **Retry cobre só o erro `131030`** (Meta). Códigos que pedem recuo (`130429`, `80007`,
  `131049`, `131047`) viram `failed` direto.
- **Rate limiter em memória** ([`rate-limit.ts`](../src/lib/rate-limit.ts)), por processo.
  Derrotado por deploy multi-instância. O próprio arquivo documenta isso.
- **CSP em `Report-Only`**: não bloqueia nada ainda.
- **Webhook da Meta não assina** `phone_number_quality_update` nem `account_update`. Se o
  número cair de qualidade ou for restringido, o CRM não fica sabendo.

---

## 9. Convenções do repositório

- **Idioma do produto: Português do Brasil.** Toda string visível ao usuário em PT-BR.
- **Sem travessões (`—`) em prosa visível ao usuário**: "passa cara de IA". Use dois-pontos,
  vírgula ou parênteses. Foi o motivo do commit `c31f762`.
- A tradução é por strings hardcoded: **não há biblioteca de i18n**. Adicionar um segundo
  idioma exige introduzir `next-intl` ou equivalente e extrair tudo.
- **Pegadinha do Base UI**: `DropdownMenuLabel` precisa estar dentro de um
  `DropdownMenuGroup`, senão estoura "Base UI error #31" e derruba a página inteira. Já
  causou um crash geral.

### Remotes

- `origin` = `github.com/ArnasDon/opencrm` (upstream público do template)
- `OpenCRM` = `github.com/agenciaOpenCRM/opencrmOpenCRM` (privado da agência, **é o nosso**)

Push: `git push OpenCRM <branch>:<branch>`

### Comandos

```bash
npm run dev          # desenvolvimento
npm run build        # build de produção
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run test         # vitest run
npm run format       # prettier --write .
```

---

## 10. Documentação original (branch `feat/multi-tenant`)

| Arquivo | Conteúdo |
|---|---|
| `docs/README.md` | Índice e visão geral |
| `docs/infra.md` | VPS, Easypanel, Supabase self-hosted, Evolution, deploy, migrations |
| `docs/multi-tenant.md` | Modelo de contas, isolamento RLS, conta ativa, seletor, página Clientes |
| `docs/whatsapp-providers.md` | Meta + Evolution, conectar, receber, enviar, Portal do Cliente, **anti-ban** |
| `docs/roadmap.md` | Pendências, riscos e alertas de segurança. **Ler antes de produção** |
| `docs/continuar-de-outro-pc.md` | Retomar o trabalho de outra máquina (GitHub + SSH da VPS) |
| `docs/public-api.md` | API REST pública (também na `main`) |
