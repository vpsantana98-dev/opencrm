# Design: anti-ban para WhatsApp via Evolution API

**Data:** 29/07/2026
**Base:** branch `feat/multi-tenant` (migrations 001 a 039)
**Status:** aprovado, aguardando planos de implementação por fase

---

## 1. Problema

O CRM usa a Evolution API (Baileys) como provedor principal de WhatsApp. Baileys emula o
WhatsApp Web: a conexão parte da nossa VPS, e o IP dela é o IP da sessão do número.

Hoje todas as instâncias saem pelo mesmo IP de datacenter (`31.97.249.95`, Hostinger). Para
o WhatsApp, dezenas de números de clientes diferentes, espalhados pelo país, conectando da
mesma origem de datacenter é um dos padrões mais fáceis de detectar.

Além do IP, o disparo atual não tem ritmo: `deliverBroadcast()` percorre até 1.000
destinatários em laço `for` chamando a API o mais rápido que ela responder, sem intervalo,
sem teto, sem janela horária e sem opt-out.

### Parâmetros da operação (definidos com o time)

| Parâmetro | Decisão |
|---|---|
| Escala | 50+ instâncias, foco em disparo |
| Provedor | Tudo pela Evolution; Meta oficial descartada para este ciclo |
| Tier de proxy | Móvel 4G/5G compartilhado, 3 a 5 instâncias por IP |
| Freios | Automáticos e duros: o sistema barra o disparo, não só alerta |

### Risco aceito, registrado

Baileys viola os Termos de Serviço do WhatsApp. Ban é sem aviso e sem apelação, e o número
pertence ao cliente, então a agência carrega o prejuízo da relação. O time foi informado e
optou por seguir. Este design **reduz** probabilidade de ban; não a elimina.

---

## 2. As quatro camadas

Cada camada ataca um vetor diferente. Proxy sozinho resolve um quarto do problema.

| Camada | Vetor | Mecanismo |
|---|---|---|
| Rede | IP de datacenter, muitos números na mesma origem | Pool de proxies móveis, um por instância |
| Identidade | Número novo com volume de número maduro | Aquecimento com rampa e teto diário |
| Comportamento | Rajada, texto idêntico, madrugada | Fila com throttle, jitter, spintax, janela |
| Consentimento | Denúncia e bloqueio do destinatário | Opt-out obrigatório, saúde por número, freio |

O vetor dominante em operação de disparo é o último. Proxy evita o flag de origem; ele não
salva um número que dispara para lista fria.

---

## 3. Arquitetura: fila no Postgres drenada por cron

### Por que

Com throttle real, uma campanha de 1.000 contatos a 45s por mensagem leva 12 horas. Isso não
cabe em `after()` do Next.js, que morre com o request. Throttle exige fila persistente com
worker.

Escolhida a fila no Postgres drenada por rota de cron, em vez de worker dedicado ou n8n,
porque **o padrão já existe no código**: `automation_pending_executions` mais
`/api/automations/cron` protegido por secret é exatamente a mesma forma. Zero infra nova,
estado sobrevive a redeploy, e a curva de aprendizado para o time é nula.

A lógica de drenagem fica em função pura, então graduar para worker dedicado depois é trocar
quem a chama, sem reescrever.

### Alternativas descartadas

- **Worker dedicado em container:** mais robusto, mas adiciona deploy e monitoramento para um
  ganho que só aparece muito acima do volume atual.
- **n8n como orquestrador:** dispersa lógica que precisa de auditoria fina em dois sistemas,
  e a Evolution do n8n está marcada como "não mexer".

---

## 4. Camada 1: rede (pool de proxies)

### Ordem obrigatória na criação da instância

**O proxy precisa estar ativo antes de gerar o QR.** Hoje `createInstance()` cria a instância
e já devolve o QR. Aplicar proxy depois faz o handshake de pareamento sair pelo IP da VPS, o
WhatsApp registra essa origem na sessão, e o número nasce comprometido.

> **Superado pela seção 12.** Esta seção propunha a ordem "criar instância, aplicar proxy,
> pedir QR". A leitura do código-fonte da Evolution mostrou que o `/instance/create` aceita
> os campos de proxy diretamente, então o proxy vai **na própria criação**. É melhor: elimina
> por construção qualquer janela em que a instância exista sem proxy, em vez de depender da
> ordem das chamadas. Ver a seção 12 para o contrato confirmado.

### Tabela `proxies` (global da agência)

```
id, label                 "Móvel SP-01"
kind                      mobile | isp | residential
protocol                  http | socks5
host, port, username
password_encrypted        AES-256-GCM com ENCRYPTION_KEY
region                    'BR-SP', casa com o DDD do número
max_instances             default 4
status                    active | degraded | disabled
last_check_at, last_exit_ip, last_latency_ms
rotate_url                endpoint de rotação do provedor, opcional
```

Vínculo: `evolution_instances.proxy_id → proxies.id`.

Proxy é infraestrutura compartilhada entre clientes, por isso a tabela é global e não
escopada por conta. É o que viabiliza o rateio de 3 a 5 instâncias por IP móvel.

**RLS fail-closed:** `USING (false)` para cliente. Ninguém lê proxy pelo browser, nem owner.
Todo acesso passa por rota server-side com `requireRole('owner')`. A senha nunca sai do
servidor, nem mascarada. Mesmo princípio já aplicado ao `access_token` da Meta.

### Atribuição

`assignProxy(accountId)`, nesta ordem:

1. Proxy `active`, com vaga (`instâncias < max_instances`), `region` casando com o DDD.
2. Proxy `active` com vaga, menos carregado.
3. Nenhum disponível: **falha explícita, a instância não é criada.**

O item 3 é deliberado. É melhor a agência ver "sem IP disponível, compre mais um" do que um
cliente conectar em silêncio pelo IP da VPS e contaminar os outros números que estão lá.

### Saúde do pool

Cron `/api/proxies/health`, mesmo padrão protegido por secret de `/api/automations/cron`.
Para cada proxy, requisição de echo de IP através dele; grava `last_exit_ip` e latência.

- 3 falhas seguidas: `degraded`, não recebe instância nova, as existentes seguem.
- 10 falhas: `disabled`, notificação, instâncias entram em remanejamento.

### Teste de aceite da camada

> **Corrigido na execução.** Esta seção pedia `last_exit_ip` **por instância**, o que é
> inalcançável: a Evolution não expõe o IP de saída por instância, e `last_exit_ip` é coluna
> de `proxies`. O que foi implementado é a composição de dois sinais, que é o que a seção 12
> prescreve: o proxy sai por um IP diferente do da VPS, **e** a instância tem proxy aplicado
> do lado da Evolution (`GET /proxy/find/{instance}`). A rota de saúde também sinaliza
> instâncias `connected` com `proxy_id` nulo, que é o estado de toda a frota conectada antes
> desta fase.
>
> Limite que permanece: se a Evolution voltar a conectar direto **sem** alterar a configuração
> do proxy, isso segue invisível. Registrado em `docs/antiban-fase1-follow-ups.md`.

### Verificação pendente: resolvida

O formato do body foi confirmado no código-fonte da Evolution. Ver a seção 12, incluindo a
ressalva sobre a versão implantada e a checagem de aceite que a cobre.

---

## 5. Camada 2: comportamento (fila, throttle, janela)

### A fila é `broadcast_recipients`

Sem tabela nova. `broadcast_recipients` já tem `status`, `sent_at` e `error_message`, e a
trigger agregadora das migrations 003 e 005 já mantém as contagens em `broadcasts`. Falta
só o "quando":

```
+ scheduled_for  TIMESTAMPTZ
+ attempts       INT DEFAULT 0
```

Reusar mantém as contagens funcionando e evita duplicar a fonte da verdade.

### `deliverBroadcast()` se divide em duas

- **`enqueueBroadcast()`** roda no request, calcula os horários escalonados, grava, retorna.
- **`drainDueMessages()`** função pura chamada pelo cron, pega o que venceu e envia.

### Concorrência: obrigatório, não opcional

O cron roda de minuto em minuto. Execução que passe de um minuto faz a próxima entrar em cima
e **enviar a mesma mensagem duas vezes**. Mensagem duplicada gera exatamente a denúncia que
o design existe para evitar.

```sql
SELECT ... FROM broadcast_recipients
WHERE status = 'pending' AND scheduled_for <= now()
ORDER BY scheduled_for
FOR UPDATE SKIP LOCKED
LIMIT n
```

`FOR UPDATE SKIP LOCKED` faz cada execução pegar linhas distintas. Execuções sobrepostas
passam a ser seguras, e drains paralelos ficam possíveis sem mudança.

O `LIMIT n` é o teto de mensagens que **uma execução** do cron processa, não o teto da
campanha. Com cron de um em um minuto e intervalo médio de 45s, cada tick tem no máximo uma
ou duas mensagens vencidas por instância. `n = 50` global dá folga larga para 50 instâncias
sem deixar um tick rodar por minutos e atropelar o próximo.

### Ritmo

**Intervalo com jitter.** Nunca fixo. Default 45s ± 20s (uniforme entre 25 e 65). Intervalo
constante é assinatura de robô. O valor base vem do estágio de aquecimento (camada 3), não é
configuração solta.

**Janela horária.** Só entre 08h e 20h no fuso do cliente. Exige `accounts.timezone` (hoje só
existe `default_currency`, migration 021). Fora da janela a mensagem é **reagendada** para a
próxima abertura, não falha.

**Spintax.** `{Oi|Olá|Bom dia}, {tudo bem|como vai}?` resolve para combinação diferente por
destinatário. Resolução no envio, por destinatário, não no enfileiramento. Mil mensagens
byte-a-byte idênticas do mesmo número é sinal fácil de detectar.

### Falha e retentativa

Erro da Evolution incrementa `attempts` e reagenda com backoff exponencial: 2min, 8min,
32min. No terceiro fracasso, `failed` com a mensagem de erro. O comportamento atual marca
`failed` na primeira falha, misturando "número inválido" com "proxy piscou".

### Consequência a alinhar com o comercial

45s de intervalo em janela de 12h entrega cerca de **950 mensagens por dia por número**, no
teto absoluto, e bem menos durante aquecimento. Campanha de 10.000 contatos leva 11 dias em
um número, ou 1 dia distribuída em 11 números.

Isso é a realidade do canal, não limitação da implementação. A pressão por "acelerar só dessa
vez" é o que mata número, e o freio duro vai barrar essa tentativa.

O teto de 1.000 destinatários por chamada de `createBroadcast()` fica como está, agora só
como limite de request.

---

## 6. Camada 3: identidade (aquecimento e tetos)

### Escada

Teto e intervalo derivam de `evolution_instances.first_connected_at`:

| Dias conectado | Teto/dia | Intervalo base | Disparo? |
|---|---|---|---|
| 1 a 3 | 30 | 120s ± 40 | Não, só atendimento |
| 4 a 7 | 50 | 90s ± 30 | Sim |
| 8 a 14 | 150 | 60s ± 25 | Sim |
| 15 a 21 | 300 | 50s ± 20 | Sim |
| 22 a 29 | 600 | 45s ± 20 | Sim |
| 30+ | 950 | 45s ± 20 | Sim |

Os 3 primeiros dias sem disparo são **decisão de julgamento, não fato técnico**. Raciocínio:
número que conectou há 2 horas e já manda mensagem para desconhecido é o perfil clássico de
conta descartável. Nesses dias o número faz só atendimento, gerando conversa real com quem
respondeu. É o primeiro parâmetro a afrouxar se for inviável comercialmente.

### O contador conta tudo

Contar só broadcast é erro: se o teto é 150 e o número respondeu 400 na inbox, o volume real
foi 550, e o WhatsApp não distingue.

```
instance_daily_usage
  account_id, day DATE, sent_count INT
  PRIMARY KEY (account_id, day)
```

Incremento atômico com `INSERT ... ON CONFLICT DO UPDATE SET sent_count = sent_count + 1`,
chamado em `send-message.ts` no caminho da Evolution, por onde passam os dois usos. Evita join
na tabela `messages` a cada tick, e vira o histórico que o painel de saúde usa.

Teto estourado para o disparo daquela instância até o dia virar; mensagens ficam `pending` e
são reagendadas. **O atendimento continua**: bloquear resposta a quem escreveu seria pior que
o risco evitado, e mensagem dentro de conversa iniciada pelo destinatário é a de menor risco.

### Aquecimento orgânico, não sintético

Não fazer números conversarem entre si para aquecer, prática comum no mercado. É detectável
(grafo fechado, sem entrada externa, horários regulares) e vira sinal negativo. O aquecimento
aqui é só a rampa de volume sobre tráfego real.

### O `override` só desce

`daily_cap_override` existe, mas o valor efetivo é `MIN(escada, override)`. O operador pode
ser mais conservador que a escada, nunca mais agressivo.

É a implementação literal do freio duro. Sem essa regra, o campo vira a válvula que esvazia as
outras três camadas na primeira sexta-feira de meta apertada. Furar o teto de verdade deve
exigir mudar a escada no código, com commit e revisão.

---

## 7. Camada 4: consentimento (opt-out, saúde, freios)

### Opt-out

Colunas em `contacts`: `opted_out_at`, `opt_out_source` (`keyword` | `manual` | `import`).

**Detecção conservadora.** Substring é armadilha: "vou parar aí amanhã" descadastraria um
cliente em negociação. A regra:

- Normaliza (minúscula, sem acento, sem pontuação), e
- Casa **exato** contra a lista (`parar`, `sair`, `cancelar`, `descadastrar`, `remover`,
  `pare`, `stop`), **ou**
- Mensagem com menos de 30 caracteres que **começa** com a palavra-chave.

Nunca substring no meio de frase.

Ao casar, em sequência: marca `opted_out_at`, envia **uma** confirmação, cancela todas as
linhas `pending` daquele contato em `broadcast_recipients`, e nunca mais enfileira. O
cancelamento da fila é essencial: sem ele o contato pede para sair e segue recebendo o que já
estava agendado, que é o caminho direto para denúncia.

Opt-out é por contato, logo por conta. Sair da lista do cliente A não afeta o cliente B, o que
está correto: são empresas diferentes.

**Exceção estreita ao "irrevogável"**, aprovada: reversão manual só por `owner`, só se o
contato enviou mensagem **depois** do opt-out, com registro de quem reverteu e quando. Cobre
o caso do "parar" acidental sem abrir a porta para reativação em massa.

### Saúde: o limite honesto

**O WhatsApp não informa denúncia.** Não existe API, oficial ou não, que reporte
"12 pessoas denunciaram esse número hoje". Todo produto que promete isso está inferindo. O
semáforo aqui é proxy, e um número pode ir de verde a banido com pouco aviso.

Quatro sinais por instância, janela de 24h:

| Sinal | Origem |
|---|---|
| Taxa de entrega | ACK de entrega por mensagem enviada |
| Taxa de resposta | Contatos distintos que responderam em 24h após disparo |
| Desconexões | `connection.update` com `close`, principalmente logout forçado |
| Falha de envio | Erros retornados pela Evolution |

**Mudança concreta necessária:** `createInstance()` hoje assina só
`["MESSAGES_UPSERT", "CONNECTION_UPDATE"]`. Precisa incluir **`MESSAGES_UPDATE`**, por onde
vem o ACK. Sem isso a taxa de entrega não existe e o semáforo fica cego no sinal mais
importante. Queda de entrega é o melhor indicador indireto de bloqueio em massa: quem
bloqueou para de receber ACK.

### Semáforo e freio

```
Verde     entrega ≥ 90%, sem logout forçado
Amarelo   entrega 70-90%, ou queda >50% na taxa de resposta vs. média de 7d,
          ou 2+ desconexões em 24h
Vermelho  entrega < 70%, ou logout forçado, ou 5+ desconexões em 24h
```

- **Amarelo:** teto diário efetivo cai pela metade, sem confirmação. Efetivo significa
  `MIN(escada, override) / 2`, ou seja, o corte se aplica depois do `override`, nunca antes,
  para que um `override` conservador não seja anulado pelo semáforo.
- **Vermelho:** disparo pausado na instância, campanhas em andamento vão para `paused`,
  notificação pela tabela `notifications` (migration 027).

**O atendimento nunca é bloqueado, em nenhum estado.**

Snapshot a cada 15 minutos em `instance_health_snapshots`, que guarda o histórico, alimenta o
painel e dá a base móvel de 7 dias do critério de queda de resposta.

### O que este design não cobre

Nada aqui detecta denúncia direta, prevê ban silencioso ou recupera número banido. A camada
reduz probabilidade e dá aviso antecipado em parte dos casos. A mitigação real de negócio
continua sendo **lista com consentimento e número sobrando**.

---

## 8. Modelo de dados

### Migrations (a branch está em 039)

| # | Conteúdo |
|---|---|
| `040_proxies` | Tabela `proxies`, `evolution_instances.proxy_id`, RLS fail-closed |
| `041_broadcast_queue` | `scheduled_for` e `attempts` em `broadcast_recipients`; `accounts.timezone` |
| `042_instance_warmup` | `first_connected_at`, `daily_cap_override`; tabela `instance_daily_usage` |
| `043_contact_optout` | `opted_out_at`, `opt_out_source` em `contacts` |
| `044_instance_health` | Tabela `instance_health_snapshots` |
| `045_status_constraints` | Amplia os dois `CHECK` e atualiza a trigger agregadora |

### Os dois `CHECK` e a armadilha da trigger

Estado atual:

```sql
broadcasts.status            IN ('draft','scheduled','sending','sent','failed')
broadcast_recipients.status  IN ('pending','sent','delivered','read','replied','failed')
```

Precisam de `paused` em `broadcasts` (freio do vermelho) e `cancelled` em
`broadcast_recipients` (cancelamento por opt-out).

**Armadilha:** as contagens de `broadcasts` vêm da trigger agregadora das migrations 003 e
005, derivadas dos status dos destinatários. Introduzir `cancelled` sem ensinar a trigger a
tratá-lo faz as contagens divergirem em silêncio, e ninguém percebe até alguém questionar um
relatório. A migration 045 altera o `CHECK` **e** a função da trigger na mesma transação.

### Arquivos novos

```
src/lib/whatsapp/proxy-pool.ts     assignProxy, releaseProxy, checkProxyHealth
src/lib/whatsapp/warmup.ts         escada, effectiveDailyCap = MIN(escada, override)
src/lib/whatsapp/health.ts         score dos 4 sinais, semáforo
src/lib/broadcasts/queue.ts        enqueueBroadcast, drainDueMessages
src/lib/broadcasts/throttle.ts     jitter, janela horária, spintax
src/lib/contacts/optout.ts         matchOptOutKeyword

rotas: /api/broadcasts/drain  /api/proxies  /api/proxies/health
```

### Alterações em arquivos existentes

| Arquivo | Mudança |
|---|---|
| `src/lib/whatsapp/evolution-api.ts` | `setProxy`; `createInstance` aplica proxy antes do QR; assina `MESSAGES_UPDATE` |
| `src/lib/whatsapp/broadcast-core.ts` | `deliverBroadcast` vira `enqueueBroadcast` |
| `src/lib/whatsapp/send-message.ts` | Incrementa `instance_daily_usage` no caminho Evolution |
| `src/app/api/whatsapp/evolution/webhook/route.ts` | Autenticação (ver fase 1); trata `messages.update` |

---

## 9. Testes

A lógica de risco está em funções puras de propósito, então quase tudo é testável em Vitest
sem banco. Casos prioritários, porque são os que quebram feio:

- **Opt-out, falso positivo:** `"vou parar aí amanhã"` **não** descadastra. `"PARAR"`,
  `"parar."`, `"  Sair  "` descadastram.
- **Teto:** `effectiveDailyCap` nunca retorna acima da escada, qualquer que seja o `override`.
- **Janela:** mensagem agendada para 21h30 vai para 08h do dia seguinte, no fuso da conta, não
  no do servidor.
- **Jitter:** sempre dentro do intervalo; duas chamadas seguidas não retornam o mesmo valor.
- **Pool esgotado:** `assignProxy` retorna nulo e o chamador falha em vez de conectar sem proxy.
- **Spintax:** `{a|b}` resolve para `a` ou `b`, e nunca vaza chave literal para o texto final.

`FOR UPDATE SKIP LOCKED` exige banco real. Teste de integração contra Supabase local rodando
dois drains concorrentes, afirmando zero envio duplicado. É o único que precisa de infra, e é
o que mais importa.

---

## 10. Faseamento

A spec cobre as quatro camadas porque são um desenho só, mas **não deve virar um plano de
implementação só**: seis migrations e dez arquivos novos é grande demais para executar com
qualidade num plano. Quatro planos, cada um entregável e testável sozinho:

| Fase | Conteúdo | Por que nesta ordem |
|---|---|---|
| **1** | Pool de proxies, proxy antes do QR, verificação de vazamento de IP, e autenticar o webhook da Evolution | Enquanto não fechar, tudo o mais roda sobre IP queimado |
| **2** | Opt-out completo | Barato, isolado, maior redução de denúncia por linha de código |
| **3** | Fila, throttle, jitter, janela, spintax | Maior pedaço; entra com teto fixo conservador |
| **4** | Aquecimento, saúde, semáforo, freios | Torna o teto dinâmico e fecha o ciclo |

### Nota sobre a fase 1

Inclui autenticar `POST /api/whatsapp/evolution/webhook`, que hoje **não tem autenticação
nenhuma**: qualquer um que descubra a URL injeta mensagens falsas em qualquer conta passando
o `instance` no body. Não é anti-ban, mas está no mesmo arquivo, é uma porta destrancada, e
sai junto de graça.

Dois caminhos possíveis, a decidir contra a versão da Evolution que roda no `evolution-crm`:
header customizado no webhook (`headers` na config, disponível em parte das versões v2) ou
segredo no caminho da URL (`/api/whatsapp/evolution/webhook/<segredo>`). O header é mais
limpo; o segredo no caminho funciona em qualquer versão. **Verificar o suporte antes de
escolher**, na mesma investigação que confirma o shape do `POST /proxy/set/{instance}`.

---

## 11. Fora de escopo

- Migração do disparo para a API oficial da Meta (avaliada e descartada para este ciclo).
- Recuperação de número já banido.
- Rotação automática de números (pool de chips descartáveis).
- Mídia e template no envio pela Evolution, que hoje só manda texto. Independente deste
  design, mas necessário para o produto.

---

## 13. Lacunas conhecidas, aceitas conscientemente

Registradas durante a execução, com a decisão de quem aceitou.

### Corrida na atribuição de proxy (aceita em 29/07/2026)

`assignProxy` lê a contagem de ocupação e grava o vínculo em duas operações
separadas, sem lock nem transação. Duas contas conectando no mesmo instante podem
ler a mesma contagem e receber o último slot do mesmo proxy, estourando o
`max_instances`.

**Por que foi aceita:** a janela exige dois QR escaneados no mesmo segundo, o que
é raro num fluxo onde um humano escaneia. A consequência é uma instância a mais
num proxy dimensionado para quatro, o que degrada a diluição do IP sem causar ban.
E a correção de verdade (RPC atômica) exige uma migration nova que renumeraria as
migrations 041 a 045 já planejadas nas fases 2 a 4.

**Quando corrigir:** junto da migration da Fase 2, que vai ser escrita de qualquer
forma. A correção é uma RPC que faz checagem de capacidade e gravação do vínculo
numa transação só, mantendo a seleção em TypeScript e devolvendo falha quando a
capacidade acabou entre a leitura e a escrita.

**O que NÃO fazer enquanto isso:** retentativa otimista no TypeScript. Reduz a
janela sem fechá-la, e adiciona código que depois sai fora.

---

## 12. Contrato da Evolution, confirmado no código-fonte

Resolvido em 29/07/2026 lendo o código-fonte do projeto Evolution API, e não a
instância implantada. A fonte é autoritativa quanto ao formato; a ressalva está
no fim.

### `POST /proxy/set/{instance}`

O corpo é **plano**, não aninhado sob uma chave `proxy`. O `ProxyDto`
(`src/api/dto/proxy.dto.ts`) declara:

| Campo | Tipo | Obrigatório |
|---|---|---|
| `enabled` | boolean | não |
| `host` | string | sim |
| `port` | **string** | sim |
| `protocol` | string | sim |
| `username` | string | não |
| `password` | string | não |

O router (`src/api/routes/proxy.router.ts`) valida o corpo inteiro como
`ProxyDto`, sem extrair nenhum campo aninhado. **`port` é string**, não número.

O desenho original desta spec assumia o shape aninhado. Estava errado.

### `POST /instance/create` aceita proxy na criação

Descoberta que melhora o desenho: o `InstanceDto` (`src/api/dto/instance.dto.ts`)
tem `proxyHost`, `proxyPort`, `proxyProtocol`, `proxyUsername` e `proxyPassword`.
Ou seja, dá para criar a instância **já com o proxy**, numa chamada só.

Isso é estritamente melhor que a ordem "criar, aplicar proxy, pedir QR" que a
seção 4 propunha, por dois motivos:

1. Não existe nenhuma janela em que a instância esteja de pé sem proxy. A
   garantia passa a ser por construção, e não por ordem de chamadas.
2. Torna irrelevante a pergunta sobre `qrcode: false` adiar o início do socket.
   Mesmo que o socket suba na criação, ele sobe já com o proxy aplicado.

`setProxy` continua necessário para o caminho em que a instância já existe
(a criação devolve 403 ou 409 e não aplica os campos de proxy).

### Ressalva

Isto veio do código-fonte do projeto upstream, não da instância `evolution-crm`
que roda no Easypanel. Se a versão implantada for anterior à introdução desses
campos, a criação ignora os campos de proxy em silêncio, sem erro.

**Por isso a validação de aceite da fase não é opcional:** depois do primeiro
connect real, confirmar com `GET /proxy/find/{instance}` que o proxy está
aplicado, e conferir que `last_exit_ip` difere do IP da VPS. Essa checagem pega
a divergência de versão, e é a mesma que já está no critério de aceite.
