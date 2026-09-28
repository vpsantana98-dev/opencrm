# Anti-ban Fase 1: follow-ups e limites conhecidos

Fechado em 29/07/2026, branch `feat/antiban-fase1`, 25 commits.

Este documento existe para que nada do que foi conscientemente deixado de fora se
perca. Cada item aqui foi encontrado, avaliado, e adiado com uma razão. Nenhum é
descoberta pendente: são decisões.

---

## Antes de implantar em produção

Sem isto, a branch quebra funcionalidade que hoje funciona. Todos falham fechado
(recusam em vez de degradar em silêncio), o que é proposital.

| Variável | Se faltar |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | Conectar WhatsApp devolve 503. **Hoje não está setada** no serviço `app` |
| `EVOLUTION_WEBHOOK_SECRET` | O webhook responde 200 e não processa nada: a inbox morre em silêncio |
| `PLATFORM_ADMIN_USER_IDS` | Ninguém cadastra proxy, o pool fica vazio, ninguém conecta |
| `VPS_PUBLIC_IP` | A detecção de vazamento fica desligada, com aviso no log |

Mais três passos que não são variável de ambiente:

1. **Repontar o webhook de cada instância existente.** O caminho mudou e o antigo
   agora devolve 404. Sem isso, as mensagens param de chegar para quem já está
   conectado. O procedimento está no plano da fase, Task 8.
2. **Conferir o access log do Traefik.** O segredo do webhook viaja no caminho da
   URL. Se o log grava a URI completa, o segredo vai para disco a cada mensagem.
3. **Agendar `/api/proxies/health`** a cada 15 minutos, com o header `x-cron-secret`.

## Depois do primeiro tick da rota de saúde

**Olhar o campo `instancesWithoutProxy`.** Toda instância já conectada antes desta
branch tem `proxy_id` nulo e continua saindo pelo IP da VPS. Implantar não muda
nada para elas.

Não existe correção automática, e isso é deliberado: forçar re-pareamento de uma
sessão viva a partir de um cron é mais arriscado que o estado atual. A correção é
o cliente reescanear o QR, um a um, agendado pela agência.

---

## Follow-ups, em ordem de valor

### 1. `degraded` posto à mão ainda pode ser desfeito

`src/app/api/proxies/[id]/route.ts` zera `consecutive_failures` só quando o status
novo é `active`. Marcar `degraded` pelo PATCH deixa o contador como está, e a rota
de saúde então classifica esse `degraded` como vindo do contador e reativa o proxy
no próximo check bem-sucedido.

A janela é justamente quando o proxy está oscilando, que é quando o provedor
costuma avisar que o IP está flagged. Correção de uma linha: zerar o contador
também quando o PATCH marca `degraded`.

### 2. `disabled` é estado terminal, e a execução descartada tem ponto cego

Dois lados do mesmo problema.

Proxy marcado `disabled` sai da varredura e nunca reentra: só volta por PATCH
manual. E a proteção contra "o echo de IP caiu" (descartar a execução quando todas
as checagens falham) é indistinguível de "todos os proxies morreram de verdade",
caso em que ninguém nunca degrada.

A correção de fundo é a mesma para os dois: reentrada de `disabled` na varredura
com backoff, e um sinal separado que distinga falha do checador de falha do pool.

A assimetria atual é a favor: com o pool vazio ninguém conecta (interrupção), em
vez de alguém conectar sem proxy (ban). É o lado certo de falhar neste domínio.

### 3. `findProxy` sem timeout, em laço serial

`checkInstances` faz uma chamada HTTP por instância conectada, em série, e o helper
`call` do `evolution-api.ts` não passa `AbortSignal`. Os defaults do undici são 300
segundos. Com 50 instâncias, uma que trave segura a rota inteira.

Contido hoje porque as gravações de status dos proxies acontecem antes dessa fase,
então um travamento perde só o JSON da resposta. Correção: timeout explícito no
`call` e um teto de concorrência.

### 4. `findProxy` não compara o host

A verificação confirma que a instância tem *algum* proxy do lado da Evolution, mas
não que é o proxy que o CRM acha que é. Uma instância atrás do proxy errado passa
como confirmada.

Risco menor que o coberto (ela está atrás de um proxy, não saindo pelo IP da VPS),
e a correção é puramente aditiva.

### 5. A preferência regional por DDD é código morto

Toda a trilha existe e está testada: tabela de 67 DDDs, `extractDdd`, normalização
de `region`, o ramo regional do `selectProxy`. Mas `evolution_instances.phone`
**nunca é escrito em lugar nenhum do código**, então `assignProxy` sempre recebe
`null` e o ramo regional nunca executa.

Para ativar, basta popular a coluna quando a conexão for estabelecida. O formato
importa: a convenção do app é `+55...`, e o `extractDdd` já normaliza isso.

### 6. Corrida na atribuição de proxy

`assignProxy` lê a contagem e grava o vínculo em duas operações, sem lock. Duas
contas conectando no mesmo instante podem receber o último slot do mesmo proxy.

Aceita conscientemente: a janela exige dois QR escaneados no mesmo segundo, e a
consequência é uma instância a mais num proxy dimensionado para quatro, o que
dilui pior mas não bane. A correção exige migration nova, e cai bem junto da
migration da Fase 2. Detalhe na seção 13 da spec.

### 7. O segredo do webhook é único para a instalação

Autentica "isto é a Evolution", não "isto é a Evolution falando da conta X". Como
o nome da instância é o `account_id`, e o `account_id` circula em respostas de API,
quem obtiver o segredo consegue forjar evento para qualquer conta.

Redução enorme em relação ao estado anterior (nenhuma autenticação), mas não é
isolamento por cliente. Um HMAC por instância fecharia.

---

## Fora do escopo desta fase, mas mais urgente que ela

Encontrado durante a execução, e não é problema de anti-ban.

**O cadastro do CRM é aberto.** `/signup` não exige convite e o
`ENABLE_EMAIL_AUTOCONFIRM=true` remove a barreira do e-mail. Qualquer pessoa que
alcance a URL cria conta e vira `owner` da própria. Foi isso que tornou explorável
o problema de autorização do pool de proxies, corrigido nesta fase com uma allowlist
por variável de ambiente.

Isso se soma aos bloqueadores já listados em [`roadmap.md`](./roadmap.md), e o
primeiro deles continua sendo o mais urgente de todos: **as chaves do Supabase são
as padrão do template**. Se o `JWT_SECRET` também for padrão, qualquer pessoa forja
um token `service_role` e lê ou escreve tudo no banco. Nenhum proxy protege contra
isso.

---

## O que a fase garante, e o que não garante

**Garante:** nenhuma instância **nova** conecta sem proxy. A falha é fechada, com
503 legível quando o pool está esgotado. Isso está travado por testes de rota nas
duas portas de conexão e por teste no fio, que verifica os campos de proxy no corpo
da criação da instância e a ordem das chamadas nos três ramos.

**Não garante:** que uma sessão já viva não perca o proxy no meio. Se a Evolution
voltar a conectar direto sem alterar a configuração do proxy, isso segue invisível
ao detector. A verificação é composta de dois sinais indiretos (o proxy sai por IP
diferente do da VPS, e a instância tem proxy aplicado do lado da Evolution), porque
a Evolution não expõe o IP de saída por instância.

E o mais importante: **proxy resolve um vetor de quatro.** As Fases 2 a 4 (fila com
throttle, aquecimento, opt-out e saúde do número) tratam os outros três, e o vetor
dominante em operação de disparo é o último, não este. Ver a spec em
[`superpowers/specs/2026-07-29-antiban-evolution-design.md`](./superpowers/specs/2026-07-29-antiban-evolution-design.md).
