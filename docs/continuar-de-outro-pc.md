# Continuar de outro computador

Este arquivo é o ponto de entrada para retomar o projeto sem contexto da
conversa anterior.

## 1. Preparar o computador

Instale:

- Git.
- GitHub CLI (`gh`), recomendado.
- Node.js 22 ou superior.
- Codex e autentique na sua conta.

Autentique o GitHub com `gh auth login` ou durante o primeiro `git push`.
A organização usada pelo projeto é `agenciaOpenCRM`.

## 2. Clonar a versão certa

```bash
git clone https://github.com/agenciaOpenCRM/opencrmOpenCRM.git
cd opencrmOpenCRM
git switch main
git pull origin main
npm install
```

Não volte para `feat/multi-tenant` ou outras branches antigas mencionadas em
commits e documentos históricos. O trabalho integrado está na `main`.

## 3. O que pedir ao próximo agente

Use esta mensagem:

> Leia AGENTS.md, docs/README.md, docs/continuar-de-outro-pc.md,
> docs/whatsapp-providers.md, docs/portal-clientes-conexao-whatsapp.md e
> docs/meta-app-configuracao.md. Depois confira git status e o histórico
> recente da main antes de alterar código.

Para configurar o app Meta, o arquivo obrigatório é
[`meta-app-configuracao.md`](./meta-app-configuracao.md). Ele registra a
decisão de usar um app global da agência e contém WhatsApp, webhook, token de
usuário do sistema, Meta Ads OAuth, permissões e checklist.

## 4. Estado entregue em 12/08/2026

- Modelo multi-cliente e Portal de Clientes integrados.
- Onboarding de anúncios com Meta Ads, Pixel OpenCRM, Google Ads e opcionais.
- WhatsApp Evolution recebe mensagens enviadas pelos contatos e respostas
  feitas diretamente no telefone conectado.
- Correção de mídia da Evolution preparada: envio e recebimento de áudio,
  imagem, vídeo e documento, além de fotos de pessoas e grupos.
- Conexões Evolution novas usam modo não invasivo, sem sincronização integral
  do histórico, leitura automática ou presença online forçada.

### Incidente que precisa continuar documentado

Durante um teste com número real, o usuário relatou que algumas mensagens
deixaram de aparecer no telefone. O número foi desconectado.

A auditoria do CRM não encontrou chamadas para apagar/editar mensagens ou
arquivar conversas. Mesmo assim, não reconecte esse número até:

1. Confirmar se as mensagens sumiram de dentro da conversa ou se a conversa
   apenas foi arquivada/ocultada.
2. Obter horário aproximado e contatos afetados.
3. Conferir logs e versão da Evolution no intervalo.
4. Validar primeiro com número descartável de homologação.

O detalhe técnico está em [`whatsapp-providers.md`](./whatsapp-providers.md).

## 5. Segredos e acesso à infraestrutura

O `.env.local` não vai para o GitHub. Para executar localmente, copie as
variáveis do ambiente seguro usando `.env.local.example` apenas como lista.
Nunca copie valores reais para documentação ou commit.

Para operar a VPS, o novo computador precisa de uma chave SSH autorizada.
Prefira gerar uma chave nova e autorizar sua chave pública, em vez de copiar
uma chave privada existente.

```bash
ssh-keygen -t ed25519
ssh root@31.97.249.95 "hostname"
```

O segundo comando só funcionará depois que a chave pública nova for
adicionada ao `authorized_keys` da VPS por um computador que já tenha acesso.

Infra atual:

- VPS: `31.97.249.95`.
- Hostname esperado: `srv895614`.
- Easypanel: `http://31.97.249.95:3000`.
- Evolution do CRM: projeto/serviço dedicado `evolution-crm`.
- A Evolution antiga usada pelo n8n é outro serviço e não deve ser alterada.

## 6. Rotina antes de editar

```bash
git switch main
git pull origin main
git status
node --version
npm install
npm run typecheck
```

O repositório exige atenção à versão do Next.js. Leia `AGENTS.md` e consulte
os guias locais em `node_modules/next/dist/docs/` antes de alterar rotas,
cache, componentes de servidor ou APIs do framework.

## 7. Validação e entrega

Antes de abrir um PR:

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run build
```

No Windows, alguns testes históricos de moeda e data podem divergir por
locale/timezone. Não altere a lógica para fazê-los passar sem reproduzir no
CI Linux. O build local também precisa das variáveis do Supabase para
concluir o prerender; compilar e passar TypeScript antes dessa falha confirma
apenas parte do build.

Abra PR contra `main`, espere o check **Lint, typecheck, test, build** ficar
verde e só depois faça merge.

## Referências rápidas

- Índice: [`README.md`](./README.md).
- App Meta: [`meta-app-configuracao.md`](./meta-app-configuracao.md).
- WhatsApp: [`whatsapp-providers.md`](./whatsapp-providers.md).
- Portal: [`portal-clientes-conexao-whatsapp.md`](./portal-clientes-conexao-whatsapp.md).
- Infra e migrations: [`infra.md`](./infra.md).
- Segurança: [`runbook-seguranca.md`](./runbook-seguranca.md).
