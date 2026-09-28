# Portal de Clientes e conexão do WhatsApp: contexto para continuar

Documento de passagem de bastão. Escrito em 12/08/2026 para quem for
continuar o trabalho de aproximar nosso Portal de Clientes e o fluxo de
conexão do WhatsApp da referência (Trizup).

**Leia isto antes de abrir código.** Metade do que parece faltar já
existe e está apenas escondido ou inacabado. Já construímos coisa
duplicada nesta base por não ter checado antes.

---

## 1. O objetivo

O gestor da agência abre **Contas de Clientes** (`/clients`), escolhe um
cliente e configura a conta dele: dados, WhatsApp, Meta Ads, pixel.

Hoje isso está espalhado entre a lista de clientes, um wizard curto de
criação e as telas de Configurações. A referência resolve tudo num
**modal único, com trilha de passos à esquerda**, que dá para abrir a
qualquer momento para editar, não só na criação.

A frase do dono do produto: *"eu acesso aquela tela pelo portal de
clientes, o do Trizup é muito mais organizado e fácil de abrir, o nosso
deveria ser igual"*.

---

## 2. Onde as coisas estão hoje

### Telas

| Arquivo | O que é | Linhas |
|---|---|---|
| `src/app/(dashboard)/clients/page.tsx` | Lista de contas de clientes. Renomear, excluir, gerar link do Portal, atribuir operador | ~850 |
| `src/components/clients/new-client-wizard.tsx` | Wizard de criação, **3 passos**, dentro de um `Dialog` `sm:max-w-lg` | ~430 |
| `src/components/settings/evolution-connect.tsx` | Card de conexão por QR (Evolution) | ~240 |
| `src/components/settings/whatsapp-config.tsx` | Credenciais da API oficial da Meta | grande |
| `src/components/settings/meta-ads-config.tsx` | Meta Ads: conta, página, pixel, CAPI | — |
| `src/components/settings/google-ads-config.tsx` | Google Ads | — |
| `src/app/conectar/[token]/page.tsx` | Página PÚBLICA de conexão, sem login | ~180 |
| `src/app/(dashboard)/settings/page.tsx` | Monta os painéis por `?tab=` | — |

Os passos do wizard atual são: `["Dados do cliente", "Conectar o
WhatsApp", "Tudo pronto"]` (`new-client-wizard.tsx:214`).

### Rotas de API que importam

```
POST /api/whatsapp/evolution/connect          QR para a conta ativa (admin+)
POST /api/whatsapp/evolution/connect-public   QR pelo token público (sem login)
GET  /api/whatsapp/evolution/status           status da conta ativa
GET  /api/whatsapp/evolution/status-public    status pelo token público
POST /api/whatsapp/evolution/disconnect
POST /api/whatsapp/evolution/webhook/[secret] webhook autenticado por segredo no caminho
POST /api/account/workspaces/[id]/connect-link  gera o link público (owner/admin)
GET/POST /api/proxies, /api/proxies/[id], /api/proxies/health
```

---

## 3. O que a referência faz

Reconstruído a partir dos prints. Modal grande, cabeçalho com avatar e
"Editando conta", barra de progresso, e uma **trilha vertical de passos
à esquerda** que fica visível o tempo todo.

**Passo 1, Adicionar Conta**
- Nome da conta, Segmento de atuação (select)
- "Quem será o responsável pelo WhatsApp?" → Outra Pessoa / Eu mesmo
- "Qual plataforma você usará?" → Meta Ads / Google Ads
- Horário de funcionamento: fuso, mesmo horário todos os dias ou por dia,
  dias da semana como chips, abertura e fechamento
- Checkbox "Recalcular tempos de resposta existentes"

**Passo 2, Conectar WhatsApp**
- "Quais conversas o Trizup deve guardar?" com três opções:
  - Todas as conversas (padrão atual)
  - Apenas conversas rastreadas
  - Apenas rastreadas, sem prospecção (recomendado)
- Card do número: telefone, nome, selo Conectado/Desconectado, resumo do
  que está guardando, ícone de link e menu de ações
- "Copie o link abaixo e envie para o responsável" com campo e botão
- "Aguardando conexão automaticamente..."
- Escolha do método: QR Code (padrão) ou Via Extensão (beta)
- Checkbox "Sincronizar conversas anteriores (máximo 7 dias)"
- Contador de instâncias: "Criar Nova Instância (53/58)"

**Passo 3, Meta Ads**
- Estado da conexão com botão Desconectar e "Sincronizar ativos"
- Conta de Anúncio, Páginas do Facebook, WABA (opcional)
- Pixel e API de Conversão, com aviso destacado para usar o **Pixel de
  Mensagens**, não o Pixel Web
- Campo do Pixel ID, campo do token da CAPI (mascarado)
- Toggle "Teste Avançado", "Código de Teste" e botão **Testar Integração**

**Passo 4, Finalizar**
- Checklist do que ficou pronto: Conta Criada (com ID copiável), Mensagem
  Padrão, WhatsApp, Meta Ads, Conta de Anúncio, Pixel e CAPI

**Opcionais** (item separado na trilha, fora da numeração)
- Mensagem padrão
- Webhooks: URL de criação e de atualização de lead, toggle "disparar
  apenas em mudança de etapa"
- Tipo de Pixel: Pixel de Mensagens (`business_messaging` para CTWA,
  `website` para o resto) ou Pixel Web
- Compartilhar WhatsApp entre contas
- Portal do Cliente: toggle de acesso

A **lista de contas** mostra cards com avatar, nome, selo Ativo,
Conectado/Desconectado, agência dona, contagem de leads e conversas, e
botão "Portal do Cliente".

---

## 4. O que já existe e NÃO deve ser reconstruído

Este é o ponto mais importante do documento.

| Parece faltar | Onde já está |
|---|---|
| Link público de conexão | `POST /api/account/workspaces/[id]/connect-link`. Existe desde o antiban e **não estava exposto em interface nenhuma** até o PR #29 |
| Página pública de conexão | `src/app/conectar/[token]/page.tsx`, funcional |
| Polling de conexão e renovação de QR | Nos dois lados, já implementado |
| Pixel e CAPI da Meta | `src/lib/meta-ads/capi.ts` e `meta-ads-config.tsx` |
| Google Ads | `src/lib/google-ads/`, migration `045_google_ads.sql` |
| Links rastreáveis com atribuição | `src/lib/tracking-links/`, migration `051`, atribuição já plugada nos webhooks da Evolution e da Meta |
| Portal do Cliente (link) | Já existe na página `/clients` |
| Wizard de criação | `new-client-wizard.tsx`, 3 passos |

**Não existe hoje** e é trabalho de verdade:

1. Trilha vertical de passos num modal grande, reaproveitável para
   **edição**, não só criação. Hoje o wizard é `sm:max-w-lg` e só de
   criação.
2. Segmento de atuação, responsável pelo WhatsApp, plataforma de campanha.
3. **Horário de funcionamento** com fuso e por dia. Nada disso existe no
   banco. Precisa de migration.
4. **Política de captura de conversa** (todas / apenas rastreadas / sem
   prospecção). Nada no banco nem no webhook. É a mudança de maior
   impacto: mexe no que entra no CRM.
5. Passo "Finalizar" com checklist de status.
6. Seção "Opcionais": mensagem padrão, webhooks de lead, tipo de pixel,
   toggle do portal.
7. Contador de instâncias e limite de plano.
8. "Via Extensão" e "Sincronizar conversas anteriores": dependem da
   Evolution / do provedor, avaliar viabilidade antes de prometer.

---

## 5. Estado dos PRs (12/08/2026)

- **#29, aberto e verde**: refaz a conexão por QR inspirada na referência.
  Página pública com logo, nome do cliente, tokens do tema, QR em dois
  passos, cronômetro, duas colunas. E o card do painel passa a liderar
  com o link para o responsável. **Mergear isto antes de continuar**, ou
  haverá conflito em `evolution-connect.tsx` e em `conectar/[token]`.
- `status-public` passou a devolver `account_name` (usado pela página
  pública para dizer "Conectando para: X").

---

## 6. Armadilhas deste repositório

Aprendidas na marra nesta semana. Ignorar qualquer uma custa horas.

**Lint**
- `react-hooks/set-state-in-effect` é **erro**, não aviso. `setState`
  síncrono dentro de efeito quebra o CI.
- Pôr `await Promise.resolve()` no topo de uma função `async` **não**
  resolve: a regra analisa o corpo inteiro. O que resolve é o `setState`
  estar dentro de um `.then`. Ver `dashboard/page.tsx` e o `loadAll` dele
  como referência de formato correto.

**CI**
- Node 22 obrigatório: `undici@8` exige `>=22.19`. No Node 20 o import
  estoura com `webidl.util.markAsUncloneable is not a function`.
- O build baixa fontes do Google (`next/font/google` no `layout.tsx`).
  Quando o `fonts.gstatic.com` devolve 404, o build morre. **Aconteceu
  duas vezes em dois dias.** Se falhar com "Turbopack build failed",
  confira se é 404 de fonte e rode de novo. Correção definitiva pendente:
  migrar para `next/font/local`.
- `src/lib/currency.test.ts` falha em máquina Windows pt-BR (usa
  `Intl.NumberFormat(undefined, ...)`, pega o locale do sistema). Passa
  no runner Linux. Não tente "consertar" achando que quebrou.
- **`main` não tem proteção de branch** (repo privado em plano gratuito,
  o GitHub recusa com 403). O `main` já ficou vermelho por dias sem
  ninguém perceber. Confira o CI do `main` antes de partir do zero.

**Ambiente**
- Migrations vão até `052`, aplicadas **manualmente por psql**, cada
  arquivo em transação única. Idempotentes. Postgres não tem
  `CREATE POLICY IF NOT EXISTS`: use `DROP POLICY IF EXISTS` antes.
- Deploy é **EasyPanel** (VPS Hostinger), projeto `opencrm-supabase`,
  serviço `app`, build Nixpacks. Variáveis na aba Ambiente, que é a fonte
  da verdade: o painel reescreve o `.env` a cada deploy. Ver `docs/infra.md`.
- Supabase é **self-hosted**, não `*.supabase.co`. Isso já quebrou o CSP
  uma vez (corrigido no PR #24, derivando de `NEXT_PUBLIC_SUPABASE_URL`).
- Envs da Evolution são fail-closed e cada ausência dá uma mensagem
  diferente. Tabela no `.env.local.example`.

**Produto**
- Idioma: **Português do Brasil** em tudo que o usuário vê.
- **Sem travessões** (`—`) em texto visível. Use vírgula, dois-pontos ou
  parênteses. É decisão registrada em commit ("cara de IA").
- `AGENTS.md`: esta versão do Next tem breaking changes, consulte
  `node_modules/next/dist/docs/` antes de mexer em rota ou cache.

---

## 7. Ordem sugerida

1. Mergear o #29.
2. Extrair a casca do modal: trilha vertical de passos, barra de
   progresso, cabeçalho, rodapé Voltar/Continuar. Sem lógica nova, só a
   estrutura, reaproveitável por criação e edição.
3. Mover para dentro dela o que já existe: dados do cliente,
   `EvolutionConnect`, `MetaAdsConfig`, `GoogleAdsConfig`. Nada de
   reescrever esses componentes, só hospedá-los.
4. Passo "Finalizar" com o checklist, lendo o estado real de cada peça.
5. Seção "Opcionais".
6. Só então os campos novos que exigem migration: horário de
   funcionamento e política de captura. Nessa ordem, porque são os únicos
   que mexem em banco e em comportamento de ingestão.

O passo 3 é o que dá o ganho percebido de "muito mais organizado" com o
menor risco. Os passos 1 a 4 não precisam de migration nenhuma.
