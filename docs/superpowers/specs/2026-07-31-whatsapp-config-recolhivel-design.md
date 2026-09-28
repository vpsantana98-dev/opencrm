# Seção "Conexão do WhatsApp" recolhível (fechada por padrão)

**Data:** 2026-07-31
**Status:** aprovado

## Contexto e objetivo

No painel WhatsApp das configurações (`/settings?section=whatsapp`) há duas
seções empilhadas: o card "Conectar por QR Code (Evolution)" — caminho
principal de conexão — e a seção "Conexão do WhatsApp" (API oficial da
Meta: status, credenciais, webhook e rail de instruções). A seção da Meta
é longa e é o caminho secundário; ela passa a ser um recolhível com seta,
**fechado por padrão**, para o painel abrir enxuto no QR Code.

Estado atual:

- `src/app/(dashboard)/settings/page.tsx` monta `<EvolutionConnect />` e
  `<WhatsAppConfig />` empilhados no painel `whatsapp`.
- `src/components/settings/whatsapp-config.tsx` (856 linhas) renderiza
  `SettingsPanelHead` (título + descrição) e um grid
  `lg:grid-cols-[1fr_380px]` com o formulário e o rail de instruções.
  Carrega a config no mount e mantém `connectionStatus` em estado.
- Já existe primitivo pronto: `src/components/ui/accordion.tsx` (base-ui,
  com chevron ChevronDown/Up, animação de altura e a11y).

## Decisões (com o usuário)

| Decisão | Escolha |
|---|---|
| O que recolhe | A seção "Conexão do WhatsApp" INTEIRA (status, credenciais, webhook e rail de instruções). O card de QR Code não muda. |
| Estado inicial | Fechado por padrão em toda visita; sem persistência de estado. |
| Cabeçalho fechado | Título + descrição + **selo de status** (Conectado / Não conectado) + seta. |

## Design

### Comportamento

- O cabeçalho da seção vira o gatilho do recolhível: clique (ou
  Enter/Espaço via teclado, nativo de `<button>`) alterna
  aberto/fechado; o botão carrega `aria-expanded` e `aria-controls`.
- Seta: ChevronDown que gira 180° quando aberto (transição CSS) —
  visualmente para baixo fechado, para cima aberto.
- Selo de status no cabeçalho, visível aberto ou fechado, derivado do
  `connectionStatus` que o componente já mantém: verde "Conectado" quando
  `connected`, vermelho "Não conectado" caso contrário. Enquanto
  `loading`, um spinner pequeno no lugar do selo.
- O fetch da config permanece no mount (não é adiado para a abertura) —
  o selo precisa do status mesmo com a seção fechada.

### Implementação

- Tudo dentro de `src/components/settings/whatsapp-config.tsx`; nenhuma
  mudança em `settings/page.tsx` nem no `EvolutionConnect`.
- **Recolhível local com `useState` + `<button>`** (ajuste decidido no
  planejamento): o conteúdo da seção JÁ contém um `Accordion` (os passos
  1-4 do rail de instruções), e aninhar outro `Accordion` por fora
  cascatearia os estilos do `AccordionContent` externo (`[&_a]:underline`,
  `[&_p:not(:last-child)]:mb-4`) para dentro do rail. Um
  `useState(false)` + botão-cabeçalho com `aria-expanded`/`aria-controls`
  e ChevronDown com `rotate-180` quando aberto entrega o mesmo
  comportamento e acessibilidade sem briga de estilos. Fechado por
  padrão = estado inicial `false`.
- O botão-cabeçalho reproduz o visual do `SettingsPanelHead` (título
  `text-lg font-semibold`, descrição `text-sm text-muted-foreground`);
  o `SettingsPanelHead` deixa de ser usado neste componente. O selo de
  status entra ao lado do título.
- O grid `lg:grid-cols-[1fr_380px]` inteiro (formulário + rail) vai para
  dentro do painel condicional.
- O early-return de `loading` mantém o mesmo cabeçalho recolhível (com
  spinner no lugar do selo), para o layout não pular quando a config
  resolve.
- O banner de token corrompido (`resetReason === 'token_corrupted'`) fica
  DENTRO do conteúdo recolhido — sem exceção de auto-abertura (YAGNI; o
  status vermelho no selo já sinaliza problema).

### Sem mudanças de dados

Nenhuma alteração de banco, API ou tipos.

### Testes e gates

- Sem teste unitário novo: mudança de JSX puro e o repo não tem infra de
  render-test de componentes React.
- Gates: `npx tsc --noEmit` limpo, `npm test` no baseline (as 5 falhas
  pré-existentes de locale/timezone da máquina não contam), `npm run
  build` ok e smoke test visual com `npm run dev`.

## Critérios de aceite

1. Ao abrir `/settings?section=whatsapp`, o card de QR Code aparece
   normal e a seção "Conexão do WhatsApp" aparece só como cabeçalho
   (título + descrição + selo de status + seta para baixo).
2. Clicar no cabeçalho expande a seção completa (status detalhado,
   credenciais, webhook, rail de instruções); clicar de novo recolhe.
3. O selo mostra "Conectado" (verde) quando a API da Meta está conectada
   e "Não conectado" (vermelho) caso contrário, mesmo com a seção
   fechada.
4. Recarregar a página volta ao estado fechado.
5. Alternância funciona por teclado e o `aria-expanded` reflete o estado.

## Fora de escopo

- Persistir aberto/fechado entre visitas.
- Auto-abrir em erro ou quando desconectado.
- Recolher o card de QR Code (Evolution).
- Qualquer mudança funcional no formulário de credenciais.
