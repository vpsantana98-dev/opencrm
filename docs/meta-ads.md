# Rastreamento Meta Ads (Pixel + CAPI)

Motor de atribuição de anúncios (o que o Trizup vende): manda **eventos de
conversão** server-to-server pra **API de Conversão da Meta (CAPI)** quando
um lead novo escreve e quando um negócio é ganho, pra Meta otimizar os
anúncios e mostrar as conversões no Gerenciador.

## Como funciona

1. Alguém clica num anúncio **Click-to-WhatsApp (CTWA)** e escreve pro
   cliente.
2. No número **oficial da Meta**, a 1ª mensagem chega com um `referral`
   contendo o `ctwa_clid` (id do clique). Guardamos na contato
   (`ctwa_clid`, `ad_source_id`, `ad_referral`).
3. Disparamos um evento **Lead** pra CAPI com o `ctwa_clid` (atribuição
   forte). No **Evolution/QR** não há `ctwa_clid`: o Lead ainda é enviado,
   mas a Meta casa por telefone (atribuição mais fraca).
4. Ao mover um negócio pro estágio configurado como "compra", disparamos
   **Purchase** com o valor do negócio.

## Config (por cliente)

Configurações → **Rastreamento Meta Ads**:

- **Pixel (Dataset ID)** + **Token da API de Conversão** (cifrado no banco,
  AES-256-GCM, como o `whatsapp_config`).
- **Tipo de evento**: Pixel de Mensagens (`business_messaging`, p/ CTWA) ou
  Pixel Web (`website`).
- **Evento de Lead** (liga/desliga), **estágio de compra**, **moeda**.
- **Código de Teste** (Test Events) + botão **Testar integração**.

Onde pegar: Gerenciador de Eventos da Meta → fonte de dados → ID (Pixel) e
Configurações → API de Conversão → gerar token.

## Peças no código

- Schema: [`supabase/migrations/040_meta_ads_tracking.sql`](../supabase/migrations/040_meta_ads_tracking.sql)
  — `meta_ads_config`, `meta_conversion_events`, colunas CTWA em `contacts`.
- Cliente CAPI (server-only): `src/lib/meta-ads/capi.ts` (envia o evento,
  hash SHA-256 do telefone). `src/lib/meta-ads/record.ts` (dispara+loga
  Lead/Purchase, best-effort).
- Endpoints: `GET/POST /api/account/meta-ads` (config), `.../test` (evento
  de teste), `.../conversion` (Purchase, chamado pela tela de funil).
- Disparo de Lead: webhooks `.../whatsapp/webhook` (Meta, com referral) e
  `.../whatsapp/evolution/webhook` (Evolution, sem ctwa_clid).
- UI: `src/components/settings/meta-ads-config.tsx`.

## Estado real (honesto)

Construído e compila; **migration 040 aplicada na VPS**. NÃO validado
ponta a ponta: a atribuição real só dá pra conferir com um **anúncio CTWA
rodando** (verba) e no **número oficial da Meta**. Sem isso, o botão
**Testar integração** verifica só que a Meta aceita nossos eventos (via
Test Events, com o Código de Teste preenchido).

## Conexão da agência e seleção de ativos

O Portal de Clientes usa OAuth da Meta para conectar o operador principal da
agência uma vez. A conexão fica cifrada em `meta_agency_connections` e permite
listar contas de anúncio, Páginas do Facebook e pixels acessíveis. Cada cliente
salva sua própria seleção em `meta_ads_config`.

Variáveis obrigatórias: `META_APP_ID`, `META_APP_SECRET` e
`NEXT_PUBLIC_SITE_URL`. A URI de redirecionamento cadastrada no app Meta deve
ser `${NEXT_PUBLIC_SITE_URL}/api/account/meta-business/oauth/callback`.

Para usuários fora dos papéis do app Meta, as permissões de Marketing API
precisam de acesso avançado e revisão do aplicativo na Meta.

## Pixel OpenCRM

`/pixel.js` é um script próprio da agência, separado do Pixel/CAPI da Meta. Ele
guarda GCLID, GBRAID, WBRAID, FBCLID e UTMs em `agency_pixel_visits`; a tela do
cliente gera o snippet e verifica a instalação por sinal recebido ou leitura do
HTML publicado.

## Limitações / próximos

- O app Meta precisa estar configurado e aprovado para as permissões pedidas.
- Eventos suportados: Lead e Purchase. Outros (Contact, etapas intermediárias)
  ficam pra depois.
- No Evolution a atribuição é fraca (sem `ctwa_clid`). Rastreamento forte
  pede o número oficial.
