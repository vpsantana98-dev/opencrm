# WhatsApp: provedores (Meta oficial + Evolution)

Cada cliente (account) tem **seu próprio WhatsApp**, isolado. Hoje a
conexão é pela **API oficial da Meta**. O plano é ter a **Evolution
(não-oficial, QR code) como provedor principal**, mantendo a Meta como
opção — via uma **abstração de provedor** (o "gateway" desacoplado).

## Estado atual: Meta oficial (Cloud API)

- Config por conta em `whatsapp_config` (Phone Number ID, WABA ID, access
  token, verify token — tokens cifrados com `ENCRYPTION_KEY`, AES-256-GCM).
  `UNIQUE(account_id)` (1 número por cliente); `phone_number_id` único
  entre contas (migration 013).
- **Webhook** (`src/app/api/whatsapp/webhook/route.ts`): um único endpoint
  atende TODOS os clientes; roteia a mensagem recebida pelo
  `phone_number_id` (metadata) para a conta certa. Verificação (GET) casa o
  `hub.verify_token` contra os configs.
- Envio: `src/lib/whatsapp/meta-api.ts`. Há retry de variantes de número
  BR, incluindo o **9º dígito** (WhatsApp entrega o WA ID sem o 9 às
  vezes) — ver `src/lib/whatsapp/phone-utils.ts`.
- Onboarding é MANUAL por cliente (colar credenciais Meta). O "conectar em
  1 clique" (Embedded Signup / Provedor de Tecnologia) NÃO está construído.

## Estado atual de teste (importante)

Conectado a um **número de TESTE da Meta**. O access token usado foi
promovido para **permanente** (System User no Business Manager) — não
expira. Aviso "Not registered" no CRM é falso alarme para número de teste.

## Evolution (não-oficial, QR) — CONSTRUÍDO (estado real abaixo)

A referência é o Trizup: conectar o WhatsApp do cliente por **QR Code**
(escanear com o celular). Isso é WhatsApp Web não-oficial (Baileys por
baixo). Decisão do time: Evolution como principal, Meta como opção.

### Infra (feito)

- Instância Evolution **dedicada ao CRM** rodando no Easypanel
  (`evoapicloud/evolution-api` + Postgres + Redis próprios +
  `AUTHENTICATION_API_KEY` próprio). Separada da Evolution que já roda para
  o n8n. Config no app por env `EVOLUTION_API_URL` + `EVOLUTION_API_KEY`.
- **Proxy residencial** por instância: implementado (pool próprio, ver
  "Anti-ban e proxy residencial" abaixo).

### Como está montado (arquivos)

- **Cliente Evolution** (`src/lib/whatsapp/evolution-api.ts`, server-only):
  `createInstance` (cria a instância com webhook + QR), `connectInstance`
  (QR novo), `getConnectionState` (`open`/`connecting`/`close`),
  `deleteInstance`, `sendText`. Uma instância por conta; **nome da instância
  = `account_id`** (é assim que o webhook sabe de quem é a mensagem).
- **Tabela** `evolution_instances` (migrations 037 + 039): `account_id`
  (PK/FK), `instance_name`, `status`
  (`created`/`connecting`/`connected`/`disconnected`), `connect_token_hash`
  (hash do link público). RLS por membership.
- **Conectar pela UI do CRM** (`POST /api/whatsapp/evolution/connect`, só
  admin+): cria a instância da conta ATIVA, aponta o webhook e devolve o
  QR. Componente `src/components/settings/evolution-connect.tsx` mostra o QR
  ao vivo (renova a cada 30s, faz polling de status a cada 3s) na aba
  WhatsApp das Configurações.
- **Receber** (`POST /api/whatsapp/evolution/webhook/<segredo>`): recebe
  `messages.upsert` e `connection.update`, acha a conta pelo `instance_name`
  e grava a mensagem (idempotente por id). Mensagens recebidas entram como
  cliente; respostas enviadas diretamente pelo celular (`fromMe`) entram como
  agente sem aumentar os não lidos. Grupos e identificadores alternativos
  `remoteJidAlt` também são tratados. Áudio, imagem, vídeo, documento e
  figurinha são persistidos no bucket `chat-media`; quando o webhook não
  traz o base64, o CRM usa `getBase64FromMediaMessage` como fallback. O
  segredo vem de `EVOLUTION_WEBHOOK_SECRET` e é comparado em tempo
  constante (`timingSafeEqual`); um caminho com segredo errado responde
  404, sem confirmar que a rota existe. Sem a variável configurada, o
  fail-closed vale para o outro lado também: a rota não processa nenhum
  evento.
- **Enviar** (`src/lib/whatsapp/send-message.ts`): se a conta tem instância
  Evolution `connected`, o envio do CRM vai por `sendText` da Evolution
  para texto e `sendMedia` para áudio, imagem, vídeo e documento. Templates
  continuam exclusivos da Meta oficial. O `POST
  /api/whatsapp/send` resolve a conta pela `active_account_id`.
- **Fotos de contatos e grupos**: o Inbox chama
  `POST /api/whatsapp/evolution/sync-avatars` e guarda cópias estáveis no
  bucket `chat-media`. A migration 054 controla a última consulta para não
  martelar a Evolution quando o perfil não possui foto.
- **Modo seguro de conexão**: antes de abrir o socket, o CRM confirma via
  `/settings/set` que `syncFullHistory`, `readMessages`, `readStatus` e
  `alwaysOnline` estão desligados. Se a Evolution rejeitar as opções, a
  conexão não abre. A ação “Reparar sincronização” reaplica as mesmas
  opções antes do webhook.
- **Excluir cliente** (`DELETE /api/account/workspaces/[id]`): apaga a
  instância na Evolution antes de apagar o workspace.

### Portal do Cliente (link público de conexão) — CONSTRUÍDO

O cliente da agência está espalhado pelo país e não tem login no CRM. Para
ele conectar o próprio WhatsApp, a agência gera um **link público** e manda
para ele (WhatsApp/e-mail). Fluxo:

1. Na página **Clientes**, botão de link (ícone) no card → `POST
   /api/account/workspaces/[id]/connect-link` (só owner/admin). Gera um
   token aleatório, guarda só o **hash SHA-256** em
   `evolution_instances.connect_token_hash` (mesma ideia dos convites, 019)
   e devolve a URL `https://<host>/conectar/<token>`. Um Dialog mostra o
   link para copiar. **Gerar de novo invalida o anterior.**
2. O cliente abre `/conectar/<token>` (página pública, sem login) no
   celular. Ela chama `POST /api/whatsapp/evolution/connect-public` {token}
   → valida pelo hash → cria a instância e mostra o **QR ao vivo**.
3. A página faz polling de `GET
   /api/whatsapp/evolution/status-public?token=` (a cada 3s). Quando a
   Evolution reporta `open`, vira "WhatsApp conectado!".
4. O `middleware.ts` libera SEM login: os endpoints terminados em
   `-public` e a rota `/conectar` (não está em `protectedPaths`).

### Estado real de teste (honesto)

> **Incidente de 2026-08-12:** após o primeiro teste com um número real, o
> usuário relatou que algumas mensagens deixaram de aparecer no telefone e
> desvinculou a sessão. A auditoria do CRM não encontrou chamadas para
> apagar/editar mensagens ou arquivar conversas; apenas envio, recebimento e
> logout explícito. O número afetado não deve ser reconectado até distinguir
> perda dentro da conversa de arquivamento/notificações e revisar os logs e a
> versão implantada da Evolution. As opções não invasivas acima foram
> adicionadas como proteção, mas não provam a causa nem recuperam conteúdo.

- **Conectar (pela UI do CRM) + texto**: o usuário conectou por QR e o
  recebimento inicial foi validado. A correção para respostas feitas no
  próprio telefone está coberta por testes, mas ainda precisa de nova
  validação ponta a ponta.
- **Mídias e fotos**: implementadas e cobertas por testes automatizados,
  ainda sem validação ponta a ponta com um número descartável após o
  incidente descrito acima.
- **Link público (Portal do Cliente)**: construído, compila e passa no
  typecheck/build, **mas ainda não foi testado ponta a ponta** com um
  cliente remoto real abrindo o link e escaneando. Precisa desse teste.
- **Proxy residencial**: implementado em código nesta branch (pool,
  atribuição automática, checagem de saúde, detecção de vazamento),
  revisado. Falta a validação de ponta a ponta com uma instância real
  conectada em produção (`GET /api/proxies/health` sem vazamento e
  `POST /proxy/find/<instância>` na Evolution confirmando o proxy
  aplicado), que exige credenciais que só o parceiro humano tem.

## Anti-ban e proxy residencial (para o dev)

- O risco de ban é **inerente** ao não-oficial (não se elimina, só se
  reduz). Disparo em massa é o uso que mais queima número.
- **Proxy na VPS ≠ proteção**: o IP da VPS é datacenter, exatamente o que o
  WhatsApp marca. É preciso rotear por um **proxy residencial ou de
  operadora**.

### Estado real: pool implementado (Fase 1 do anti-ban)

A Fase 1 (branch `feat/antiban-fase1`, spec em
[`docs/superpowers/specs/2026-07-29-antiban-evolution-design.md`](./superpowers/specs/2026-07-29-antiban-evolution-design.md))
cobre só a camada de rede (proxy). As demais camadas (fila com throttle,
aquecimento, opt-out, saúde por número) ficaram para as fases 2 a 4, ver
"O que falta" abaixo.

- **Tabela `proxies`** (migration `040_proxies.sql`): pool GLOBAL da
  agência, não por conta (é o que permite ratear várias instâncias por
  IP móvel). RLS fail-closed: nenhuma role de cliente lê a tabela, nem
  owner; todo acesso passa por rota server-side com service role. Senha
  cifrada em AES-256-GCM com `ENCRYPTION_KEY`, mesmo esquema dos tokens
  da Meta.
- **Seleção** (`src/lib/whatsapp/proxy-select.ts`): função pura, sem
  I/O. Prefere um proxy `active` com vaga cuja região (`BR-UF`) case com
  o DDD extraído do telefone do cliente; se não achar, cai para o proxy
  `active` com vaga menos carregado. Sem proxy livre, devolve `null`, e
  o chamador tem que falhar (nunca conectar sem proxy).
- **Atribuição** (`src/lib/whatsapp/proxy-pool.ts`): `assignProxy` grava
  o vínculo em `evolution_instances.proxy_id`. É **sticky**: se a conta
  já tem um proxy vinculado e ele segue `active` com vaga, reusa o mesmo
  proxy em vez de rodar a seleção de novo (trocar o IP de saída de uma
  sessão de WhatsApp Web já pareada é, por si só, sinal de risco).
  `releaseProxy` solta a vaga ao excluir o cliente. `loadProxyConfig`
  devolve a config decifrada de um proxy específico, para reaplicar.
- **Aplicado em dois pontos, de propósito**
  (`src/lib/whatsapp/evolution-api.ts`): o proxy vai nos campos
  `proxyHost`/`proxyPort`/`proxyProtocol`/etc do próprio `POST
  /instance/create`, E é reforçado com `setProxy` (`POST
  /proxy/set/<instância>`) logo em seguida, em TODOS os ramos (criação
  nova, 403 e 409), sempre antes de `connectInstance`. A duplicidade é
  deliberada: a versão da Evolution implantada em produção pode ser
  anterior à introdução dos campos de proxy no `InstanceDto` e ignorá-los
  em silêncio (sem erro), o que só apareceria numa validação manual
  pós-deploy.
- **Gestão do pool** (`GET`/`POST /api/proxies`, `PATCH`/`DELETE
  /api/proxies/[id]`): restritas pela allowlist `PLATFORM_ADMIN_USER_IDS`
  (env, fail-closed: sem a variável, ninguém gerencia o pool, nem
  "owner"). Necessário porque o pool é global da agência e
  `requireRole("owner")` não isola nada aqui (todo cadastro em `/signup`
  já vira owner da própria conta nova).
- **Checagem de saúde** (`GET /api/proxies/health`): cron protegido por
  `x-cron-secret` (`AUTOMATION_CRON_SECRET`), pensado para rodar a cada
  15 minutos. Testa a saída de cada proxy contra um serviço de echo de
  IP; 3 falhas seguidas marcam `degraded` (não recebe instância nova),
  10 marcam `disabled` (sai do pool). **Detecção de vazamento**: se o IP
  de saída bater com o IP da VPS (env `VPS_PUBLIC_IP`), o proxy é
  desativado na hora, independente do contador, porque isso significa
  que o tráfego não está de fato passando pelo proxy.

### O que falta

- **Validação de ponta a ponta em produção**: com uma instância real
  conectada, confirmar `GET /api/proxies/health` respondendo `leaking: 0`
  com `last_exit_ip` preenchido e diferente do IP da VPS, e `POST
  /proxy/find/<instância>` na Evolution confirmando o proxy de fato
  aplicado. Depende de credenciais que só o parceiro humano tem.
- **Preferência regional ainda sem efeito em produção**: o casamento por
  DDD depende de `evolution_instances.phone` estar preenchido, e hoje
  nada escreve nessa coluna. A lógica existe e tem teste, mas em
  produção a seleção sempre cai no "menos carregado".
- **Fases 2 a 4 do anti-ban** (fila com throttle e jitter, aquecimento de
  número novo, opt-out, saúde por número e freios automáticos): fora do
  escopo desta fase. Ver a spec linkada acima.

### Requisitos do proxy

**Residencial/móvel**, **sticky/dedicado** (o mesmo IP persistente por
número, WhatsApp estranha IP que troca toda hora), geo-alvo (`BR-UF`). É
pago (por GB ou por IP/mês). A VPS só hospeda quem consome o pool; quem
fornece o IP residencial é o provedor de proxy.
