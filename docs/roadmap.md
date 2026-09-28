# Roadmap, pendências e segurança

Leia isto antes de colocar cliente pagante em produção.

## 🔴 Segurança (bloqueadores de produção)

1. **Chaves do Supabase são as PADRÃO do template (`supabase-demo`).** A
   anon key vista em runtime tem `iss: supabase-demo` — é a chave/segredo
   **público** do template Supabase. Se o `JWT_SECRET` também for o padrão
   (provável, já que a anon demo é aceita), **qualquer pessoa consegue
   forjar um token `service_role` e ler/escrever tudo no banco.**
   - **Ação**: regenerar `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY` (e
     `SECRET_KEY_BASE`, `VAULT_ENC_KEY`) do Supabase, atualizar a aba
     Ambiente do serviço `opencrm-supabase` **e** as envs do app (`app`),
     e reiniciar. Causa breve indisponibilidade.
2. **Verify token de webhook fraco** (`1234567890` no teste). Trocar por
   valor forte antes de número de produção.
3. **SMTP desligado**: convites de equipe e recuperação de senha não
   enviam e-mail (`ENABLE_EMAIL_AUTOCONFIRM=true` contorna o cadastro, mas
   não há e-mails transacionais). Configurar SMTP antes de produção.

## 🟡 Infra / operação

- **Realtime (WebSocket) falhando**: o serviço Realtime do Supabase
  responde 503 no WS (`/realtime/v1/websocket`), tenant `realtime-dev`. É
  config do Supabase self-hosted (tenant/conexão), não do app. Efeito:
  mensagens novas só aparecem ao recarregar (não "pulam" na tela). Não é
  bloqueante; corrigir quando der.
- **Backups do banco** do `opencrm-supabase`: configurar antes de produção
  (hoje, se o disco morrer, perde tudo).
- **Domínio próprio** no lugar do `...easypanel.host`.

## 🟢 Multi-tenant (feito, aguardando merge)

Na branch `feat/multi-tenant`, validado end-to-end (criar cliente, trocar,
isolamento). Falta:
- **Merge `feat/multi-tenant` → `main`** quando aprovado para produção.
- **Escopo por conta ativa das tabelas-filho/periféricas** (messages nas
  métricas do dashboard, notifications, api_keys, ai_*) — cosmético.
- **Convites de equipe (Fase 5)**: hoje `redeem_invitation` (migration
  019) MOVE o usuário de conta; no multi-conta deve ADICIONAR um vínculo em
  `account_members` (senão o convidado perde a conta anterior). Necessário
  quando outra pessoa da agência for gerenciar clientes.

## 🔵 WhatsApp Evolution (construído; falta testar e endurecer)

Ver [`whatsapp-providers.md`](./whatsapp-providers.md) para o detalhe.
**Já feito**: instância dedicada no Easypanel, conectar por QR (na UI e por
link público/Portal do Cliente), receber (webhook, agora autenticado por
segredo no caminho da URL), enviar (texto), excluir cliente limpando a
instância, e **proxy residencial por instância** (Fase 1 do anti-ban: pool
global da agência, atribuição automática, checagem de saúde e detecção de
vazamento). Conectar + receber validados pelo usuário.

**Falta (em ordem de prioridade):**
1. **Testar o envio real** pelo CRM (deu erro no 1º teste; ainda não valida).
2. **Testar o link público ponta a ponta** com um cliente remoto de verdade
   abrindo `/conectar/<token>` e escaneando.
3. **Validar o pool de proxies em produção**: com uma instância conectada,
   confirmar `GET /api/proxies/health` sem vazamento e o proxy de fato
   aplicado na Evolution. Critério de aceite da Fase 1, ainda pendente.
4. **Mídia e template** no envio via Evolution (hoje só texto).
5. **Fases 2 a 4 do anti-ban** (fila com throttle e jitter, aquecimento de
   número novo, opt-out, saúde por número e freios automáticos): a Fase 1
   cobriu só a camada de rede (proxy). Ver a spec completa em
   [`superpowers/specs/2026-07-29-antiban-evolution-design.md`](./superpowers/specs/2026-07-29-antiban-evolution-design.md).
6. **Abstração de provedor** limpa (`provider` no config), hoje o envio
   decide Evolution vs. Meta por "tem instância `connected`?".

## Histórico resumido (o que já foi entregue)

- Fork privado no GitHub da agência; deploy na VPS via Easypanel.
- Supabase self-hosted dedicado + migrations do template aplicadas.
- Tradução completa PT-BR (sem travessões).
- WhatsApp Meta oficial conectado (número de teste), token permanente,
  correção do 9º dígito BR (envio e recebimento validados).
- Multi-tenant: contas de cliente isoladas, seletor, hub "Clientes",
  isolamento provado (migrations 031–035).
- Excluir cliente (hub Clientes + `DELETE` que limpa a instância Evolution).
- WhatsApp Evolution: instância dedicada, conectar por QR (UI), receber
  (webhook), enviar (texto) e link público/Portal do Cliente
  (`/conectar/<token>`) — migrations 036–039. Conectar+receber validados
  pelo usuário; envio e link público ainda sem teste real (ver acima).
- Identidade visual OpenCRM aplicada (cores, fontes, logo) — ver histórico.
- UX: assistente guiado de "Novo cliente" (onboarding) + copy da marca +
  estado vazio do inbox.
- Rastreamento Meta Ads (Pixel + CAPI): eventos de Lead e Purchase,
  atribuição CTWA — migration 040. Ver [`meta-ads.md`](./meta-ads.md).
  Construído e no ar; validação real de atribuição pende de anúncio CTWA
  rodando + número oficial.
- Correção de cache pós-deploy (`next.config.ts`).
