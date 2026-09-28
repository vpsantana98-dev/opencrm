# opencrm (OpenCRM) — documentação do projeto

CRM de WhatsApp multi-tenant para agência. Base: fork do template
open-source `opencrm` (Next.js + Supabase), evoluído para o modelo de
**agência com múltiplos clientes** (estilo Trizup): uma conta da agência
gerencia vários "clientes", cada um isolado, com seu próprio WhatsApp.

Esta pasta documenta **o que foi construído, onde está hospedado e o que
falta** — para qualquer dev entrar no projeto sem depender de contexto
oral.

## Índice

- [`infra.md`](./infra.md) — VPS, Easypanel, Supabase self-hosted, Evolution, deploy, migrations.
- [`multi-tenant.md`](./multi-tenant.md) — modelo de contas, isolamento (RLS), conta ativa, seletor, página Clientes.
- [`whatsapp-providers.md`](./whatsapp-providers.md) — WhatsApp oficial (Meta) + não-oficial (Evolution, QR): conectar, receber, enviar e o link público (Portal do Cliente).
- [`meta-ads.md`](./meta-ads.md) — rastreamento Meta Ads (Pixel + CAPI): eventos de Lead e Purchase, atribuição Click-to-WhatsApp.
- [`meta-app-configuracao.md`](./meta-app-configuracao.md) — runbook completo para criar o app global da agência, configurar WhatsApp Cloud API, webhook, token permanente e OAuth de Meta Ads.
- [`roadmap.md`](./roadmap.md) — pendências, riscos e alertas de segurança (IMPORTANTE ler antes de produção).
- [`backlog.md`](./backlog.md) — tudo que falta pro produto ficar de pé, priorizado (P0–P6) + decisões em aberto.
- [`runbook-seguranca.md`](./runbook-seguranca.md) — passo a passo do P0 (regenerar chaves do Supabase, backups, domínio, SMTP) que VOCÊ executa no Easypanel.
- [`continuar-de-outro-pc.md`](./continuar-de-outro-pc.md) — como retomar o trabalho de outra máquina (GitHub + chave SSH da VPS) sem reconfigurar tudo.

## Stack

- **App**: Next.js (App Router) + TypeScript + Tailwind + Base UI.
- **Dados/Auth**: Supabase self-hosted (Postgres + Auth + Storage + Realtime + RLS).
- **WhatsApp (principal)**: Evolution API (não-oficial, QR code), com conexão pela UI e link público, texto, mídias, grupos e fotos de perfil. O incidente e as restrições de validação estão documentados em `whatsapp-providers.md`.
- **WhatsApp (opção)**: Meta WhatsApp Business Cloud API (oficial).
- **Hospedagem**: VPS Hostinger gerenciada por Easypanel.

## Convenção importante do repositório

Leia [`../AGENTS.md`](../AGENTS.md): este Next.js tem breaking changes vs.
o conhecido — consulte os guias em `node_modules/next/dist/docs/` antes de
escrever código.

## Branch principal

Use `main`. O modelo multi-cliente, o Portal de Clientes, a Evolution e o
onboarding de anúncios já foram integrados. Antes de iniciar uma tarefa,
execute `git pull origin main` e leia `continuar-de-outro-pc.md`.

> Idioma do produto: **Português do Brasil**. Toda string visível ao
> usuário deve ser PT-BR, sem travessões "—" em prosa (passa cara de IA);
> use dois-pontos, vírgula ou parênteses.
