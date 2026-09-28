# Relatorio de seguranca - 2026-08-13

## Escopo

Auditoria defensiva do codigo frontend e backend do CRM: rotas Next.js,
autenticacao, autorizacao multi-tenant, webhooks, OAuth, SSRF, dependencias,
headers do navegador, segredos no bundle e funcoes privilegiadas do Supabase.

Esta execucao nao realizou ataques contra producao nem alterou configuracoes do
Easypanel/Supabase em execucao. Infraestrutura publicada precisa de uma etapa
separada de DAST e revisao operacional.

## Achados corrigidos

| Severidade | Achado | Correcao |
| --- | --- | --- |
| Critica | Rotas de automacoes validavam `user_id`, mas nao a conta ativa. Um operador com varios workspaces podia acessar uma automacao do workspace inativo. | Todas as leituras e escritas administrativas agora filtram `account_id` resolvido no servidor. |
| Critica | ACK da Evolution atualizava mensagens apenas por `message_id`, que pode repetir entre contas. | O webhook resolve IDs internos por join com `conversations.account_id` e atualiza somente esses IDs. |
| Alta | Um `viewer` podia chamar APIs de automacoes e fluxos que escrevem com service role. | Criacao, edicao, duplicacao, ativacao, execucao e exclusao exigem `requireRole('agent')`. |
| Alta | Imagem de cabecalho de template aceitava URL arbitraria, redirects e download sem limite progressivo. | Validacao HTTP(S), bloqueio de rede privada, redirect manual, timeout, `content-length` e leitura limitada a 5 MB. |
| Alta | Next.js 16.2.6 e dependencias transitivas tinham advisories publicados. | Next.js atualizado para 16.3.0, CLI `shadcn` movido para desenvolvimento e lockfile atualizado. `npm audit`: zero vulnerabilidades. |
| Media | Cron de saude dos proxies comparava segredo com igualdade comum. | Comparacao alterada para `timingSafeEqual`, falhando fechada. |
| Media | CSP estava apenas em modo de relatorio e permitia `unsafe-eval` em producao. | CSP passou a bloquear, `unsafe-eval` ficou restrito ao desenvolvimento e `object-src 'none'` foi adicionado. |
| Media | Funcoes `SECURITY DEFINER` antigas podiam manter `search_path` implicito. | Migration 055 fixa `search_path = public` em todas as funcoes privilegiadas existentes. |
| Baixa | Convencao `middleware.ts` estava obsoleta no Next.js 16. | Migrada para `proxy.ts`, mantendo os mesmos testes de autenticacao e cookies. |

## Validacao executada

- `npm audit`: 0 vulnerabilidades de producao ou desenvolvimento.
- `npm run typecheck`: passou.
- `npm run lint`: 0 erros; 24 avisos antigos fora deste escopo.
- Testes direcionados de seguranca: 32/32 passaram.
- Suite completa: 894/899 passaram. As 5 falhas restantes sao testes antigos
  dependentes de locale/fuso em moeda e calendario, sem relacao com estas
  correcoes.
- `npm run build`: passou no Next.js 16.3.0.
- Bundle do navegador: nenhum valor configurado de service role, chave de
  criptografia ou segredo da Meta foi encontrado.
- Manifesto de rotas: header `Content-Security-Policy` gerado em modo de
  bloqueio.

## Acao obrigatoria no deploy

Aplicar `supabase/migrations/055_harden_security_definer_search_path.sql` no
banco de producao. O deploy do Next.js sozinho nao executa essa protecao no
Postgres.

Depois do deploy, percorrer login, dashboard, inbox, upload de midia, gravacao
de audio, Meta Ads e conexao do WhatsApp observando erros de CSP no console.

## Riscos residuais

- A CSP ainda permite `unsafe-inline`; remover exige nonces por requisicao e
  tornaria as paginas dinamicas. E uma melhoria futura, nao um bloqueio desta
  entrega.
- A protecao SSRF valida DNS antes do `fetch`, mas nao fixa o IP no socket;
  DNS rebinding continua como risco residual.
- O rate limit e mantido em memoria. Se o app ganhar mais de uma instancia,
  deve migrar para Redis ou outro contador compartilhado.
- O segredo do webhook da Evolution permanece no caminho da URL por
  compatibilidade. Logs do proxy devem ocultar esse caminho.
- Nao foi executado scanner autenticado contra a URL publicada nem auditoria
  das configuracoes reais de CORS, TLS, backups, firewall e Supabase.
