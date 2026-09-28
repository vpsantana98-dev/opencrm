# Criar e configurar o app da Meta

Este é o runbook para preparar o app Meta usado pelo OpenCRM. Leia antes
de criar qualquer coisa no Meta for Developers.

## Decisão de arquitetura

Crie **um único app Meta pertencente à agência OpenCRM**. Não crie um app por
cliente.

O app global atende três recursos do CRM:

1. WhatsApp Cloud API oficial e seu webhook.
2. Criação, sincronização e envio de templates do WhatsApp.
3. OAuth do operador principal para listar contas de anúncio, páginas e
   pixels no Portal de Clientes.

As credenciais globais ficam nas variáveis `META_APP_ID` e
`META_APP_SECRET`. Os ativos escolhidos e as credenciais de cada conta ficam
separados por `account_id` no banco.

## Pré-requisitos na Meta

- Conta cadastrada no Meta for Developers.
- Portfólio empresarial da agência no Meta Business Suite.
- Usuário com controle total do portfólio.
- Domínio público do CRM com HTTPS.
- URLs públicas de política de privacidade, termos e exclusão de dados para
  colocar o app em modo Live e solicitar acesso avançado.
- Verificação da empresa concluída quando a Meta a exigir.

Os nomes dos menus mudam com frequência. A Meta pode mostrar "Business",
"Outro" ou um fluxo baseado em "casos de uso". O resultado necessário é um
app empresarial ligado ao portfólio da agência.

## 1. Criar o app

1. Acesse `https://developers.facebook.com/apps`.
2. Clique em **Create App**.
3. Escolha o caso de uso empresarial, ou **Other > Business** quando essa
   for a interface exibida.
4. Use um nome identificável, por exemplo `OpenCRM Produção`.
5. Informe o e-mail operacional da agência.
6. Vincule o app ao portfólio empresarial da OpenCRM.
7. Abra **App Settings > Basic** e copie:
   - **App ID**: valor de `META_APP_ID`.
   - **App Secret**: valor de `META_APP_SECRET`.
8. Cadastre o domínio do CRM e as URLs legais exigidas pela Meta.

Nunca coloque o App Secret no navegador, em documentação, print, issue ou
arquivo versionado.

## 2. Configurar as variáveis do deploy

No serviço do Next.js no Easypanel, configure:

```dotenv
NEXT_PUBLIC_SITE_URL=https://SEU-DOMINIO
META_APP_ID=ID_DO_APP
META_APP_SECRET=SEGREDO_DO_APP
ENCRYPTION_KEY=64_CARACTERES_HEXADECIMAIS
```

`NEXT_PUBLIC_SITE_URL` não leva barra no final. `ENCRYPTION_KEY` já deve
existir no ambiente de produção; não a troque, pois tokens cifrados com a
chave anterior deixam de ser legíveis.

Depois de alterar variáveis no Easypanel, faça novo deploy do app.

## 3. Adicionar o WhatsApp ao app

1. No painel do app, abra **Add products** ou **Add use cases**.
2. Adicione **WhatsApp** / **WhatsApp Business Platform**.
3. Selecione o portfólio empresarial da agência.
4. Em **WhatsApp > API Setup**, use primeiro o número de teste fornecido
   pela Meta.
5. Anote os dois identificadores mostrados nessa tela:
   - **Phone Number ID**.
   - **WhatsApp Business Account ID**, também chamado de **WABA ID**.

O token temporário da tela serve somente para um teste rápido. Produção
precisa de token de usuário do sistema.

## 4. Criar o token permanente do WhatsApp

1. Abra o Meta Business Suite e entre nas configurações do portfólio.
2. Acesse **Users > System Users**.
3. Crie um usuário do sistema administrativo, por exemplo
   `OpenCRM-crm-production`.
4. Em **Assign assets**, dê ao usuário acesso ao app Meta e à conta do
   WhatsApp usada pelo CRM, com as permissões necessárias para gerenciar o
   ativo.
5. Clique em **Generate new token** e escolha o app criado acima.
6. Marque:
   - `whatsapp_business_management`
   - `whatsapp_business_messaging`
   - `business_management`, se a interface disponibilizar e a operação da
     WABA exigir
7. Gere e copie o token. A Meta não volta a exibi-lo integralmente.

Para clientes com WABA própria, o ativo precisa ser compartilhado ou
atribuído ao negócio/usuário do sistema que opera o app. O token usado no
CRM precisa enxergar o Phone Number ID e a WABA informados.

## 5. Configurar o webhook do WhatsApp

No CRM, abra **Configurações > WhatsApp > API oficial da Meta** e copie a
URL exibida. Em produção ela deve ser exatamente:

```text
https://SEU-DOMINIO/api/whatsapp/webhook
```

Depois:

1. Crie uma string aleatória para o token de verificação. Exemplo:

   ```bash
   openssl rand -hex 32
   ```

2. Salve essa mesma string no campo **Token de verificação do webhook** do
   CRM. Use o mesmo token operacional nas contas ligadas a este app.
3. No painel Meta, abra **WhatsApp > Configuration > Webhooks**.
4. Informe a URL de callback e o token exatamente iguais aos do CRM.
5. Assine estes campos da WABA:
   - `messages`
   - `message_template_status_update`
   - `message_template_quality_update`
   - `message_template_components_update`

O campo `messages` entrega mensagens recebidas e mudanças de status. Os
três campos de template mantêm aprovação, qualidade e componentes
sincronizados. Sem eles, o botão manual **Sincronizar da Meta** continua
funcionando, mas as atualizações não chegam automaticamente.

Ao salvar a configuração no CRM, o backend também chama
`/{WABA_ID}/subscribed_apps`. Portanto, o token precisa ter acesso à WABA e
o WABA ID não pode ficar vazio.

## 6. Cadastrar um número oficial no CRM

Em **Configurações > WhatsApp > API oficial da Meta**, preencha:

- Phone Number ID.
- WhatsApp Business Account ID.
- Access Token permanente.
- Token de verificação usado no webhook.
- PIN de verificação em duas etapas do número, quando for um número de
  produção.

O número de teste da Meta já vem registrado e não possui esse PIN. Para um
número de produção, defina um PIN de seis dígitos no WhatsApp Manager e
informe-o no primeiro salvamento. O CRM usa o PIN para chamar
`/{PHONE_NUMBER_ID}/register`.

Depois de salvar:

1. Clique em **Testar conexão da API**.
2. Execute o diagnóstico de registro.
3. Confirme que `phone_info` e `waba_subscription` estão ativos.
4. Envie uma mensagem de teste.
5. Responda pelo destinatário e confirme que a entrada aparece no Inbox.

Não use um número real importante no primeiro teste. Comece com o número de
teste da Meta e depois com um número descartável de homologação.

## 7. Configurar o OAuth de Meta Ads

O app também conecta o operador principal da agência e lista os ativos que
ele pode acessar.

1. Adicione ao app o caso de uso de login empresarial, normalmente chamado
   **Facebook Login for Business**.
2. Cadastre esta URI em **Valid OAuth Redirect URIs**:

   ```text
   https://SEU-DOMINIO/api/account/meta-business/oauth/callback
   ```

3. A URI deve coincidir exatamente com `NEXT_PUBLIC_SITE_URL`, incluindo
   HTTPS, host e ausência de barra extra.
4. Solicite acesso avançado, quando necessário, para:
   - `ads_management`
   - `ads_read`
   - `business_management`
   - `pages_show_list`
   - `pages_read_engagement`
5. Em modo Development, adicione o operador como administrador,
   desenvolvedor ou testador do app.
6. Para operadores externos aos papéis do app, conclua a verificação da
   empresa, o Data Use Checkup e o App Review exigido para essas permissões.

No CRM, o operador entra no Portal de Clientes e usa **Conectar Meta Ads**.
O backend troca o código por token de longa duração e o cifra antes de
salvar. Não é necessário colar manualmente o token de anúncios.

O usuário que autoriza precisa ter acesso, no Meta Business Suite, às contas
de anúncio, páginas e pixels que deverão aparecer no seletor do cliente.

## 8. Colocar o app em produção

Antes de mudar para **Live**, confira:

- App vinculado ao portfólio correto.
- Domínio, política de privacidade, termos e exclusão de dados preenchidos.
- Empresa verificada, quando exigido.
- Permissões do WhatsApp e Marketing API com o nível de acesso necessário.
- URI OAuth exata cadastrada.
- Webhook verificado e campos assinados.
- `META_APP_ID` e `META_APP_SECRET` corretos no deploy.
- Número de teste funcionando de ida e volta.
- Token permanente pertencente ao mesmo app e com acesso à WABA.

## Diagnóstico rápido

### Webhook não verifica

- Confirme que o deploy está público e responde em HTTPS.
- Confirme que o token na Meta é idêntico ao salvo no CRM.
- Confirme `META_APP_SECRET` no servidor.
- Veja os logs de `GET /api/whatsapp/webhook`.

### Envia, mas não recebe

- Verifique se o campo `messages` está assinado.
- Confirme que a WABA está inscrita no app.
- Em número de produção, confirme o PIN e o registro do Phone Number ID.
- Confira se o `phone_number_id` não foi cadastrado em outra conta do CRM.

### Meta Ads conecta, mas não mostra ativos

- Confirme as cinco permissões solicitadas pelo CRM.
- Confirme que o operador tem acesso aos ativos no Business Suite.
- Em modo Development, confirme que ele possui um papel no app.
- Confira se a URI OAuth cadastrada é idêntica à usada pelo CRM.

### Fontes oficiais

- [WhatsApp Cloud API: início rápido](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started)
- [WhatsApp Cloud API: webhooks](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks)
- [Meta for Developers: aplicativos](https://developers.facebook.com/apps/)
- [Coleção oficial WhatsApp Business Platform no Postman](https://www.postman.com/meta/whatsapp-business-platform/overview)

