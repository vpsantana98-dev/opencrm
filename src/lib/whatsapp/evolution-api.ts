// ============================================================
// Cliente da Evolution API (provedor de WhatsApp não-oficial).
//
// SERVER-ONLY. Fala com a instância Evolution dedicada ao CRM (uma API
// que hospeda muitas "instâncias" — uma conexão de WhatsApp por cliente).
// Config via env:
//   EVOLUTION_API_URL  — ex.: https://evolution-crm-....easypanel.host
//   EVOLUTION_API_KEY  — AUTHENTICATION_API_KEY da instância
//
// Nunca exponha a API key ao cliente — todas as chamadas passam por
// rotas server-side do CRM.
// ============================================================

import type { EvolutionProxyConfig } from "@/lib/whatsapp/proxy-pool";
import { isDeliverableUrl } from "@/lib/webhooks/ssrf";

function baseUrl(): string {
  const url = process.env.EVOLUTION_API_URL;
  if (!url) throw new Error("EVOLUTION_API_URL não configurada");
  return url.replace(/\/$/, "");
}

function apiKey(): string {
  const key = process.env.EVOLUTION_API_KEY;
  if (!key) throw new Error("EVOLUTION_API_KEY não configurada");
  return key;
}

export function isEvolutionConfigured(): boolean {
  return !!process.env.EVOLUTION_API_URL && !!process.env.EVOLUTION_API_KEY;
}

export const EVOLUTION_CRM_WEBHOOK_EVENTS = [
  "MESSAGES_UPSERT",
  "MESSAGES_UPDATE",
  "CONNECTION_UPDATE",
] as const;

async function call(
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const headers = new Headers(init.headers);
  headers.set("apikey", apiKey());
  // O runtime precisa criar o boundary do multipart. Definir JSON aqui
  // quebra silenciosamente o upload de mídia na Evolution mais nova.
  if (!(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

export interface EvolutionQr {
  /** data:image/png;base64,... — pronto para <img src>. Pode vir vazio. */
  base64: string;
  /** Código de pareamento (alternativa ao QR), quando disponível. */
  pairingCode?: string;
}

/**
 * Aplica o proxy numa instância, nova ou já existente.
 *
 * O corpo é plano (não aninhado sob "proxy") e `port` é STRING, conforme
 * o `ProxyDto` da Evolution.
 *
 * Roda em TODOS os ramos de `createInstance` (sucesso, 403 e 409), não
 * só no caminho de instância já existente. A chamada no ramo de sucesso
 * é DELIBERADA, não redundância: os campos `proxyHost`/`proxyPort`/etc
 * do `/instance/create` só valem se a versão da Evolution implantada em
 * produção já suportar esses campos no `InstanceDto`; uma versão
 * anterior os ignora EM SILÊNCIO, sem erro nenhum, e a instância subiria
 * sem proxy sem que nada avisasse. Este `setProxy` fecha essa lacuna de
 * versão com uma chamada HTTP a mais. Não remova esta chamada do ramo de
 * sucesso achando que ela é redundante com os campos da criação: isso
 * reabriria exatamente a janela que ela existe para fechar. Ver o
 * comentário de `createInstance` para o detalhe completo.
 */
export async function setProxy(
  instanceName: string,
  config: EvolutionProxyConfig,
): Promise<void> {
  const { ok, status } = await call(`/proxy/set/${instanceName}`, {
    method: "POST",
    body: JSON.stringify({
      enabled: true,
      host: config.host,
      port: String(config.port),
      protocol: config.protocol,
      username: config.username,
      password: config.password,
    }),
  });
  if (!ok) {
    throw new Error(`Evolution setProxy falhou (HTTP ${status})`);
  }
}

/**
 * Registra novamente o webhook da instância. Precisa ser chamado também
 * quando /instance/create responde que a instância já existe, pois nesse
 * caminho a Evolution não aplica o webhook enviado no corpo da criação.
 */
export async function setInstanceWebhook(
  instanceName: string,
  webhookUrl: string,
): Promise<void> {
  const path = `/webhook/set/${instanceName}`;

  // A Evolution v2 exige a configuração ANINHADA em `webhook`. O schema
  // que a instalação valida (dist/api/integrations/event/webhook/
  // webhook.schema.js na v2.3.7) é literalmente:
  //
  //   { properties: { webhook: { enabled, url, headers, byEvents,
  //     base64, events } }, required: ["webhook"] }
  //
  // O formato antigo mandava esses campos soltos na raiz. Por isso as
  // duas tentativas anteriores devolviam HTTP 400: elas trocavam o NOME
  // dos campos (webhookBase64 → base64) mas mantinham o erro
  // estrutural, então o fallback nunca tinha como salvar.
  //
  // Note também `byEvents`, não `webhookByEvents`.
  let result = await call(path, {
    method: "POST",
    body: JSON.stringify({
      webhook: {
        enabled: true,
        url: webhookUrl,
        headers: {},
        byEvents: false,
        // base64 DESLIGADO. Com ele, a Evolution embute a midia inteira
        // no corpo do webhook; um video passa dos 10MB que o Next aceita
        // e a requisicao chega TRUNCADA — a mensagem some sem erro
        // visivel para o usuario. Sem base64 o webhook carrega so
        // metadados, e `persistEvolutionIncomingMedia` busca o arquivo
        // depois via /chat/getBase64FromMediaMessage. Esse caminho ja
        // existia como fallback; agora e o caminho principal.
        base64: false,
        events: EVOLUTION_CRM_WEBHOOK_EVENTS,
      },
    }),
  });

  // Fallback para instalações da linha v1, onde os campos iam na raiz.
  // Mantido porque nem toda instância deste projeto roda a mesma versão
  // da Evolution, e uma release antiga rejeita o formato aninhado.
  if (!result.ok) {
    result = await call(path, {
      method: "POST",
      body: JSON.stringify({
        enabled: true,
        url: webhookUrl,
        webhookByEvents: false,
        // Mesmo motivo do formato acima.
        webhookBase64: false,
        events: EVOLUTION_CRM_WEBHOOK_EVENTS,
      }),
    });
  }

  if (!result.ok) {
    throw new Error(`Evolution setWebhook falhou (HTTP ${result.status})`);
  }
}

export const EVOLUTION_SAFE_SETTINGS = {
  rejectCall: false,
  msgCall: "",
  groupsIgnore: false,
  alwaysOnline: false,
  readMessages: false,
  readStatus: false,
  syncFullHistory: false,
  wavoipToken: "",
} as const;

/**
 * Coloca a instância no modo menos invasivo possível antes de conectá-la.
 * O CRM recebe eventos, mas não lê mensagens/status automaticamente, não
 * força presença online e não solicita o histórico completo do aparelho.
 */
export async function setSafeInstanceSettings(
  instanceName: string,
): Promise<void> {
  const { ok, status } = await call(`/settings/set/${instanceName}`, {
    method: "POST",
    body: JSON.stringify(EVOLUTION_SAFE_SETTINGS),
  });
  if (!ok) {
    throw new Error(`Evolution setSettings falhou (HTTP ${status})`);
  }
}

/** O que a Evolution reporta sobre o proxy de uma instância. */
export interface EvolutionProxyStatus {
  /** true quando a Evolution reporta um proxy aplicado e não desligado. */
  configured: boolean;
  /** Host reportado pela Evolution, quando houver. */
  host: string | null;
}

/**
 * `GET /proxy/find/{instance}`: confirma, DO LADO DA EVOLUTION, que a
 * instância tem proxy aplicado.
 *
 * É a metade que faltava da verificação de vazamento. A checagem por
 * proxy (proxy-check.ts) diz que o proxy responde; só esta diz que a
 * instância do cliente está de fato usando um. A spec (seção 12)
 * registra que a versão implantada pode ignorar em silêncio os campos
 * de proxy do `/instance/create`, e é exatamente esse silêncio que esta
 * chamada quebra.
 *
 * Uma instância sem proxy é reportada como `configured: false`, não como
 * erro: a Evolution devolve 404 nesse caso, e para quem chama isso é
 * resposta, não falha.
 *
 * `enabled` ausente conta como habilitado. Versões diferentes da
 * Evolution devolvem o registro do proxy com ou sem esse campo, e tratar
 * a ausência como "sem proxy" faria o detector acusar a frota inteira e
 * virar ruído. Um `enabled: false` explícito, esse sim, é proxy
 * desligado.
 */
export async function findProxy(
  instanceName: string,
): Promise<EvolutionProxyStatus> {
  const { ok, data } = await call(`/proxy/find/${instanceName}`);
  if (!ok) return { configured: false, host: null };

  const d = (data ?? {}) as {
    enabled?: boolean;
    host?: string;
    proxy?: { enabled?: boolean; host?: string };
  };
  const host = d.host ?? d.proxy?.host ?? null;
  const enabled = d.enabled ?? d.proxy?.enabled;

  return { configured: Boolean(host) && enabled !== false, host };
}

/**
 * Cria a instância com o proxy JÁ configurado e devolve o QR.
 *
 * O proxy vai nos campos `proxyHost`/`proxyPort`/etc do próprio
 * `/instance/create` E é reaplicado por `setProxy` logo em seguida,
 * SEMPRE, nos dois ramos (criação nova e 403/409 de instância
 * já existente), antes de `connectInstance`. Cinto e suspensório de
 * propósito: a spec regista a ressalva de que a versão da Evolution em
 * produção pode ser anterior à introdução dos campos de proxy no
 * `InstanceDto` e ignorá-los EM SILÊNCIO (sem erro), o que só seria
 * percebido numa validação manual pós-deploy. Chamar `setProxy` mesmo
 * no caminho de sucesso fecha esse buraco com uma chamada HTTP a mais,
 * sem abrir nenhuma janela sem proxy: `qrcode: false` garante que o
 * socket não sobe na criação, então não existe pareamento em trânsito
 * entre o `/instance/create` e o `setProxy` que o segue.
 *
 * O handshake de pareamento é o que registra a origem da sessão no
 * WhatsApp, então não pode existir NENHUMA janela em que a instância
 * esteja de pé sem proxy: por isso `setProxy` acontece sempre ANTES de
 * `connectInstance`, que é quem de fato produz o QR / abre o socket.
 *
 * EXCEÇÃO deliberada: `proxy: null` é o fallback do pool vazio (spec
 * 2026-08-03-proxy-fallback-pool-vazio-design.md) — enquanto a agência
 * não cadastrou nenhum proxy, a instância sobe SEM proxy (nenhum campo
 * de proxy no create, nenhum setProxy), com aviso alto no log.
 */
export async function createInstance(
  instanceName: string,
  webhookUrl: string,
  proxy: EvolutionProxyConfig | null,
): Promise<EvolutionQr> {
  const { ok, status } = await call("/instance/create", {
    method: "POST",
    body: JSON.stringify({
      instanceName,
      integration: "WHATSAPP-BAILEYS",
      qrcode: false,
      // modo Ag�ncia: precisamos RECEBER mensagens de grupo (o webhook
      // trata @g.us). Por padrão a Evolution pode ignorar grupos; forçamos
      // aqui. Só vale pra instâncias novas — as já criadas precisam do
      // mesmo ajuste em /settings/set.
      groupsIgnore: false,
      // Proxy também na criação: ver o comentário acima (cinto e
      // suspensório com o setProxy que segue nos dois ramos).
      ...(proxy
        ? {
            proxyHost: proxy.host,
            proxyPort: String(proxy.port),
            proxyProtocol: proxy.protocol,
            proxyUsername: proxy.username,
            proxyPassword: proxy.password,
          }
        : {}),
      webhook: {
        url: webhookUrl,
        byEvents: false,
        // Ver setInstanceWebhook: midia embutida estoura o limite de
        // corpo da requisicao e a mensagem e perdida.
        base64: false,
        // MESSAGES_UPDATE traz o ACK de entrega, que a camada de saúde
        // da fase 4 usa como principal sinal indireto de bloqueio.
        events: EVOLUTION_CRM_WEBHOOK_EVENTS,
      },
    }),
  });

  // ok (criação nova) OU 403/409 (instância já existia): nos dois
  // casos reaplicamos o proxy via setProxy ANTES do QR. Ver o
  // comentário da função para o porquê de fazer isso mesmo no ramo ok.
  if (ok || status === 403 || status === 409) {
    if (proxy) {
      await setProxy(instanceName, proxy);
    } else {
      console.warn(
        `[evolution] instancia ${instanceName} criada SEM proxy (pool vazio)`,
      );
    }
    // Fail-closed: a conexão só abre depois de confirmar as opções que
    // impedem leitura automática e sincronização integral do histórico.
    await setSafeInstanceSettings(instanceName);
    await setInstanceWebhook(instanceName, webhookUrl);
    return connectInstance(instanceName);
  }

  throw new Error(`Evolution create falhou (HTTP ${status})`);
}

/** Busca um QR fresco para uma instância já criada. */
export async function connectInstance(
  instanceName: string,
): Promise<EvolutionQr> {
  const { data } = await call(`/instance/connect/${instanceName}`);
  const d = (data ?? {}) as {
    base64?: string;
    pairingCode?: string;
    qrcode?: { base64?: string; pairingCode?: string };
  };
  const base64 = d.base64 ?? d.qrcode?.base64 ?? "";
  const pairingCode = d.pairingCode ?? d.qrcode?.pairingCode;
  return { base64, pairingCode };
}

export type EvolutionState = "open" | "connecting" | "close" | "unknown";

/** Estado da conexão: 'open' = conectado. */
export async function getConnectionState(
  instanceName: string,
): Promise<EvolutionState> {
  const { ok, data } = await call(`/instance/connectionState/${instanceName}`);
  if (!ok) return "unknown";
  const d = (data ?? {}) as { instance?: { state?: string }; state?: string };
  const state = d.instance?.state ?? d.state;
  if (state === "open" || state === "connecting" || state === "close") {
    return state;
  }
  return "unknown";
}

export async function deleteInstance(instanceName: string): Promise<void> {
  await call(`/instance/delete/${instanceName}`, { method: "DELETE" });
}

/**
 * Desconecta o WhatsApp da instância MANTENDO a instância (logout da
 * sessão). Diferente de deleteInstance, que apaga tudo. Usado pelo botão
 * "Desconectar" (o cliente continua existindo, só cai o número).
 */
export async function logoutInstance(instanceName: string): Promise<void> {
  await call(`/instance/logout/${instanceName}`, { method: "DELETE" });
}

/**
 * Número de WhatsApp conectado à instância (ex.: "+5511999999999"), ou
 * null se não der pra determinar. Lê de /instance/fetchInstances, onde o
 * dono vem como "5511...@s.whatsapp.net" em owner/ownerJid/wuid/number
 * (o campo varia por versão da Evolution).
 */
export async function getInstanceNumber(
  instanceName: string,
): Promise<string | null> {
  const { ok, data } = await call(
    `/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`,
  );
  if (!ok || !data) return null;
  const arr = Array.isArray(data) ? data : [data];
  for (const item of arr) {
    const wrap = item as { instance?: Record<string, unknown> };
    const inst = (wrap.instance ?? item) as Record<string, unknown>;
    const owner =
      inst.owner ?? inst.ownerJid ?? inst.wuid ?? inst.number ?? undefined;
    if (owner) {
      const digits = String(owner)
        .split("@")[0]
        .split(":")[0]
        .replace(/[^0-9]/g, "");
      if (digits) return `+${digits}`;
    }
  }
  return null;
}

/**
 * Nome (subject) de um grupo do WhatsApp, ou null se não der pra obter.
 * Best-effort: usado só na PRIMEIRA mensagem de um grupo, pra nomear o
 * contato-grupo. Se a versão da Evolution não tiver o endpoint, cai no
 * null e o grupo fica com nome provisório (renomeável no CRM).
 */
export async function getGroupSubject(
  instanceName: string,
  groupJid: string,
): Promise<string | null> {
  const { ok, data } = await call(
    `/group/findGroupInfos/${instanceName}?groupJid=${encodeURIComponent(groupJid)}`,
  );
  if (!ok || !data) return null;
  const d = data as { subject?: string; group?: { subject?: string } };
  const subject = d.subject ?? d.group?.subject;
  return subject ? String(subject) : null;
}

/**
 * Envia uma mensagem de texto por uma instância conectada.
 *
 * Devolve também `messageId` — o `key.id` que a Evolution atribui à
 * mensagem enviada — para o chamador gravar em `messages.message_id`.
 * Sem isso, o ACK de entrega (MESSAGES_UPDATE) nunca teria como ser
 * correlacionado de volta a esta mensagem.
 */
export async function sendText(
  instanceName: string,
  toPhone: string,
  text: string,
): Promise<{ ok: boolean; status: number; messageId?: string }> {
  const { ok, status, data } = await call(`/message/sendText/${instanceName}`, {
    method: "POST",
    body: JSON.stringify({ number: toPhone, text }),
  });
  const d = (data ?? {}) as { key?: { id?: string } };
  return { ok, status, messageId: d.key?.id };
}

export type EvolutionMediaKind = "image" | "video" | "document" | "audio";

const EVOLUTION_MEDIA_MAX_BYTES = 16 * 1024 * 1024;

const MIME_BY_KIND: Record<EvolutionMediaKind, string> = {
  image: "image/jpeg",
  video: "video/mp4",
  document: "application/octet-stream",
  audio: "audio/ogg",
};

/**
 * Envia mídia pela Evolution.
 *
 * A API atual recebe multipart/form-data. Instalações v2 anteriores
 * recebiam JSON com uma URL; o fallback preserva compatibilidade com a
 * instância já implantada sem arriscar um segundo envio em erros 5xx.
 */
export async function sendMedia(
  instanceName: string,
  to: string,
  kind: EvolutionMediaKind,
  mediaUrl: string,
  options: { caption?: string; filename?: string } = {},
): Promise<{ ok: boolean; status: number; messageId?: string }> {
  let url: URL;
  try {
    url = new URL(mediaUrl);
  } catch {
    return { ok: false, status: 400 };
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    return { ok: false, status: 400 };
  }
  if (!(await isDeliverableUrl(url.toString()))) {
    return { ok: false, status: 400 };
  }

  const mediaResponse = await fetch(url, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (!mediaResponse.ok) {
    return { ok: false, status: mediaResponse.status };
  }
  const declaredLength = Number(mediaResponse.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > EVOLUTION_MEDIA_MAX_BYTES) {
    return { ok: false, status: 413 };
  }
  const bytes = await mediaResponse.arrayBuffer();
  if (bytes.byteLength > EVOLUTION_MEDIA_MAX_BYTES) {
    return { ok: false, status: 413 };
  }

  const mimeType =
    mediaResponse.headers.get("content-type")?.split(";")[0]?.trim() ||
    MIME_BY_KIND[kind];
  const filename =
    options.filename?.trim() ||
    decodeURIComponent(url.pathname.split("/").pop() || `arquivo-${kind}`);
  const form = new FormData();
  form.append("number", to);
  form.append("mediatype", kind);
  form.append("media", new Blob([bytes], { type: mimeType }), filename);
  if (options.caption && kind !== "audio") {
    form.append("caption", options.caption);
  }
  form.append("fileName", filename);

  let result = await call(`/message/sendMedia/${instanceName}`, {
    method: "POST",
    body: form,
  });

  // Evolution v2 aceitava URL/base64 em JSON. Só usamos o fallback em
  // rejeições de formato, nunca num 5xx que pode ter ocorrido após envio.
  if ([400, 415, 422].includes(result.status)) {
    result = await call(`/message/sendMedia/${instanceName}`, {
      method: "POST",
      body: JSON.stringify({
        number: to,
        mediatype: kind,
        mimetype: mimeType,
        media: mediaUrl,
        ...(options.caption && kind !== "audio"
          ? { caption: options.caption }
          : {}),
        fileName: filename,
      }),
    });
  }

  const d = (result.data ?? {}) as {
    key?: { id?: string };
    messageId?: string;
  };
  return {
    ok: result.ok,
    status: result.status,
    messageId: d.key?.id ?? d.messageId,
  };
}

export interface EvolutionDownloadedMedia {
  base64: string;
  mimeType: string | null;
  fileName: string | null;
}

/** Busca a mídia quando o webhook não conseguiu anexar `message.base64`. */
export async function getMediaBase64(
  instanceName: string,
  message: unknown,
): Promise<EvolutionDownloadedMedia | null> {
  const { ok, status, data } = await call(
    `/chat/getBase64FromMediaMessage/${instanceName}`,
    {
      method: "POST",
      body: JSON.stringify({ message, convertToMp4: false }),
    },
  );
  // Esta chamada deixou de ser plano B e virou o CAMINHO NORMAL de toda
  // mídia recebida, desde que o webhook passou a vir sem base64 (para o
  // vídeo grande não estourar o limite de corpo do Next). Se ela falha,
  // NENHUMA mídia entra — e antes isso acontecia sem deixar rastro
  // nenhum: um `return null` calado, sem log, sem erro na tela.
  //
  // O status é o que separa as causas: 404 é mídia que a Evolution não
  // tem mais, 400 é formato de payload recusado, 401 é apikey.
  if (!ok || !data) {
    console.error(
      `[evolution] getBase64FromMediaMessage falhou: HTTP ${status}`,
      typeof data === "object" && data !== null
        ? JSON.stringify(data).slice(0, 300)
        : String(data),
    );
    return null;
  }
  const d = data as {
    base64?: string;
    mimetype?: string;
    fileName?: string;
  };
  if (!d.base64) {
    console.error(
      "[evolution] getBase64FromMediaMessage respondeu 200 SEM base64:",
      JSON.stringify(d).slice(0, 300),
    );
    return null;
  }
  return {
    base64: d.base64,
    mimeType: d.mimetype ?? null,
    fileName: d.fileName ?? null,
  };
}

/** Foto de perfil de um contato ou grupo. O mesmo endpoint aceita ambos. */
export async function getProfilePictureUrl(
  instanceName: string,
  numberOrJid: string,
): Promise<string | null> {
  const { ok, data } = await call(
    `/chat/fetchProfilePictureUrl/${instanceName}`,
    {
      method: "POST",
      body: JSON.stringify({ number: numberOrJid }),
    },
  );
  if (!ok || !data) return null;
  const d = data as {
    profilePictureUrl?: string | null;
    pictureUrl?: string | null;
    url?: string | null;
  };
  return d.profilePictureUrl ?? d.pictureUrl ?? d.url ?? null;
}

/**
 * Extrai o telefone E.164 de um JID do WhatsApp
 * (ex.: "5531999998888:17@s.whatsapp.net" → "+5531999998888").
 */
export function phoneFromJid(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const digits = jid.split('@')[0].split(':')[0].replace(/\D/g, '');
  return digits.length >= 8 ? `+${digits}` : null;
}

/**
 * Busca os dados da instância na Evolution (`GET /instance/
 * fetchInstances`) e devolve o telefone do número conectado
 * (ownerJid). Versões diferentes da Evolution devolvem o dono como
 * `ownerJid` (v2) ou aninhado em `instance.owner` (v1) — tentamos os
 * dois. `phone: null` quando a API falha ou o campo não veio.
 */
export async function fetchInstanceInfo(
  instanceName: string,
): Promise<{ phone: string | null }> {
  const { ok, data } = await call(
    `/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`,
  );
  if (!ok) return { phone: null };
  const list = Array.isArray(data) ? data : [data];
  for (const item of list) {
    const d = (item ?? {}) as {
      ownerJid?: string;
      instance?: { owner?: string };
    };
    const phone = phoneFromJid(d.ownerJid ?? d.instance?.owner);
    if (phone) return { phone };
  }
  return { phone: null };
}
