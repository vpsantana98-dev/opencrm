# Backlog do produto (priorizado)

Tudo que se sabe que **falta** pro CRM ficar "de pé" pra vender, em ordem de
prioridade. Tamanhos são estimativas grosseiras (P = pequeno, ~horas; M =
médio, ~dias; G = grande, ~1-3 semanas). Datas relativas convertidas pra
absolutas quando fizer sentido.

Última atualização: 2026-07-30.

## Progresso (2026-07-30)

- ✅ **P1 feito** (código, aguarda deploy+validação): ver/rotular o número
  conectado (hub Clientes + tela WhatsApp) + botão **Desconectar**.
  Migrations 041. Captura o número na conexão e no polling.
- ✅ **P2.2 feito** (código): convite agora ADICIONA vínculo em vez de MOVER
  (migration 042) — destrava membros em várias contas / acesso scoped.
- 🟡 **P0 preparado, aguarda VOCÊ**: chaves novas geradas num arquivo local
  (fora do git) + passo a passo em [`runbook-seguranca.md`](./runbook-seguranca.md).
  É ação no Easypanel (não código), com janela e coordenação com o dev.
- ⏳ **P2 (resto)**: o login/portal da cliente em si depende de (a) o P0
  estar feito e (b) decidir como o usuário-cliente difere das SDRs (conta
  única x papel). Melhor construir depois dessas duas coisas, não no escuro.
- ⏳ **P3.2 (Google), P4 (multi-número/gatilho de etapa)**: itens grandes /
  dependentes de decisão; ficam como passos focados, não amontoados aqui.

---

## Onde estamos (o que já está pronto)

Feito **e validado por você**: multi-tenant (clientes isolados, seletor,
hub), WhatsApp Evolution (conectar por QR na UI e por link público,
receber, enviar), link público/Portal do Cliente, identidade visual
OpenCRM, e a passada de UX (assistente de novo cliente, copy, estado vazio).

Feito **mas NÃO validado**: rastreamento Meta Ads (Pixel + CAPI, eventos de
Lead/Purchase). Precisa de anúncio Click-to-WhatsApp rodando + número
oficial da Meta pra validar a atribuição de verdade. Além disso, ainda
**falta dar o deploy** dessa parte (o app no ar é anterior a ela).

---

## P0 — Bloqueadores de segurança/dados (antes de vender ou abrir pra cliente externa)

| # | Item | Por quê | Tamanho |
|---|---|---|---|
| 0.1 | **Regenerar as chaves do Supabase** (`JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `SECRET_KEY_BASE`, `VAULT_ENC_KEY`) | Hoje são as chaves PADRÃO do template. Com o segredo padrão, dá pra forjar acesso e ler dados de TODOS os clientes. Crítico antes de qualquer login externo. **Não tocar `ENCRYPTION_KEY`** (cifra os tokens de WhatsApp/CAPI). | M (+ janela de indisponibilidade curta) |
| 0.2 | **Verify token de webhook forte** | Está fraco (`1234567890` no teste). Trocar antes de número de produção. | P |
| 0.3 | **Backups do banco** `opencrm-supabase` | Hoje, se o disco morrer, perde tudo. | P/M |
| 0.4 | **Domínio próprio** (no lugar do `...easypanel.host`) | Profissionalismo + estabilidade de links. | P |

---

## P1 — Básico de gerenciar número (dor operacional imediata)

| # | Item | Por quê | Tamanho |
|---|---|---|---|
| 1.1 | **Ver e rotular o número de cada cliente** | Hoje só mostra "WhatsApp on/off"; não dá pra ver QUAL número está conectado em cada cliente (a coluna `phone` existe no banco mas não é preenchida nem exibida). | P/M |
| 1.2 | **Botão "Desconectar"** (mantendo o cliente) | Só existe conectar e excluir o cliente inteiro. Falta desconectar um número sem apagar tudo. | P |

---

## P2 — Acesso externo (login da cliente/SDR) — *direção escolhida*

Depende do P0 (segurança) estar feito, porque envolve gente de fora logando.

| # | Item | Por quê | Tamanho |
|---|---|---|---|
| 2.1 | **Login scoped por link + senha** | A cliente (ou a SDR) acessa só o workspace dela, sem cadastro no login principal. Atende, dispara e reconecta. Reusa multi-tenant + convites. | M |
| 2.2 | **Corrigir convite: MOVE → ADD** | Hoje o convite MOVE o usuário de conta; no multi-conta tem que ADICIONAR vínculo (senão perde a conta anterior). | P/M |
| 2.3 | **Papel de "cliente" + esconder telas de agência** | O login de cliente não pode ver o hub de todos os clientes, criar/excluir cliente, etc. | M |
| 2.4 | **Configurar SMTP** | Pra "esqueci a senha" e convites por e-mail funcionarem. O link inicial a gente passa na mão, mas reset precisa de SMTP. | P |

---

## P3 — Rastreamento (completar o motor)

| # | Item | Por quê | Tamanho |
|---|---|---|---|
| 3.1 | **Validar o Meta Ads de verdade** | Ligar Pixel+token num cliente real, rodar um anúncio CTWA e conferir Lead/Purchase no Gerenciador. Só assim se sabe que funciona. | (teste; precisa verba de anúncio) |
| 3.2 | **Rastreamento Google Ads** | Não existe. Capturar `gclid` + mandar conversão pra API do Google. Build separado, do tamanho do da Meta. | G |
| 3.3 | **Meta: mais eventos + OAuth** | Hoje só Lead/Purchase e Pixel/token colados na mão. Puxar pixel/contas/páginas automático (como o Trizup) é fase futura. | M/G |

---

## P4 — Múltiplos números e automação de funil

| # | Item | Por quê | Tamanho |
|---|---|---|---|
| 4.1 | **Vários números por cliente** | Hoje é 1 número por cliente (a instância e o config são por conta). Suportar 2+ exige mudar a estrutura + UI de gerenciar vários + roteamento (por qual número entrou/sai). | M/G |
| 4.2 | **Gatilho de automação "mudou de etapa do funil"** | Hoje mover um card no kanban NÃO envia WhatsApp (só o evento de conversão Meta). Pra disparar mensagem ao mover etapa, falta esse gatilho. | M |

---

## P5 — Anti-ban / operação do não-oficial

| # | Item | Por quê | Tamanho |
|---|---|---|---|
| 5.1 | **Proxy residencial por número** | Reduz risco de ban no Evolution (WhatsApp não-oficial). Hoje tudo sai pelo IP de datacenter da VPS. **Sem verba no momento.** | (custo, não código) |
| 5.2 | **Mitigações sem custo** | Volume baixo, aquecimento, sem disparo idêntico em massa, e usar o número OFICIAL da Meta onde o cliente puder. | P (disciplina operacional) |

---

## P6 — Produção / dívidas técnicas

| # | Item | Por quê | Tamanho |
|---|---|---|---|
| 6.1 | **Merge `feat/multi-tenant` → `main`** | Levar tudo isso pra a branch de produção quando aprovado. | P |
| 6.2 | **Realtime (WebSocket 503)** | Mensagens novas só aparecem ao recarregar (não "pulam" na tela). Config do Supabase self-hosted. | M |
| 6.3 | **Escopo por conta ativa de tabelas periféricas** | Métricas do dashboard, notifications, api_keys podem agregar entre clientes. Cosmético, não vaza entre agências. | P/M |

---

## Decisões suas que ainda estão em aberto

1. **Estratégia (o mais importante):** competir de frente com o Trizup exige
   o motor de rastreamento completo (Meta + Google + atribuição), que são
   semanas. Vale definir o "diferencial" da OpenCRM em vez de perseguir
   paridade de funções. Ver [`roadmap.md`](./roadmap.md).
2. **Modelo de número:** 1 por cliente resolve a maioria? Ou vários por
   cliente é requisito desde já? (Muda o tamanho de vários itens.)
3. **Oficial x Evolution:** o rastreamento forte e a estabilidade pedem o
   número OFICIAL da Meta; o Evolution é mais barato mas com ban e
   atribuição fraca. Qual é o padrão pros clientes?

---

## Ordem sugerida (minha recomendação)

Fechar o **básico** antes de abrir pra fora:

1. **P1** (ver número + desconectar) — barato e mata a dor imediata.
2. **P0** (segurança) — pré-requisito pro acesso externo.
3. **P2** (login da cliente) — a direção que você escolheu.
4. Depois: validar Meta Ads real (P3.1), e então decidir entre Google
   (P3.2), múltiplos números (P4.1) ou automação de funil (P4.2) conforme
   a estratégia.

Proxy (P5) fica em paralelo, quando houver verba.
