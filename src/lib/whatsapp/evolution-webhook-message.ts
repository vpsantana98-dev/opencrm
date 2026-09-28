interface EvolutionMediaNode {
  caption?: string;
  fileName?: string;
  title?: string;
  mimetype?: string;
}

interface EvolutionMessageBody {
  conversation?: string;
  extendedTextMessage?: { text?: string };
  imageMessage?: EvolutionMediaNode;
  videoMessage?: EvolutionMediaNode;
  documentMessage?: EvolutionMediaNode;
  audioMessage?: EvolutionMediaNode;
  stickerMessage?: EvolutionMediaNode;
  base64?: string;
  ephemeralMessage?: { message?: EvolutionMessageBody };
  viewOnceMessage?: { message?: EvolutionMessageBody };
  viewOnceMessageV2?: { message?: EvolutionMessageBody };
  documentWithCaptionMessage?: { message?: EvolutionMessageBody };
}

export interface EvolutionWebhookMessage {
  key?: {
    remoteJid?: string;
    remoteJidAlt?: string;
    fromMe?: boolean;
    id?: string;
    participant?: string;
    participantAlt?: string;
  };
  pushName?: string;
  message?: EvolutionMessageBody;
  messageType?: string;
  messageTimestamp?: number | string;
}

export type EvolutionMessageContentType =
  | 'text'
  | 'image'
  | 'document'
  | 'audio'
  | 'video';

export interface EvolutionIncomingMedia {
  base64: string | null;
  mimeType: string | null;
  fileName: string | null;
}

function unwrapMessageBody(body: EvolutionMessageBody | undefined): EvolutionMessageBody | undefined {
  let current = body;
  for (let depth = 0; current && depth < 4; depth += 1) {
    const nested =
      current.ephemeralMessage?.message ??
      current.viewOnceMessage?.message ??
      current.viewOnceMessageV2?.message ??
      current.documentWithCaptionMessage?.message;
    if (!nested) break;
    current = nested;
  }
  return current;
}

/** Metadados da mídia; o arquivo em si vem em `message.base64`. */
export function getEvolutionIncomingMedia(
  message: EvolutionWebhookMessage
): EvolutionIncomingMedia | null {
  const root = message.message;
  const content = unwrapMessageBody(root);
  const node =
    content?.imageMessage ??
    content?.videoMessage ??
    content?.documentMessage ??
    content?.audioMessage ??
    content?.stickerMessage;
  if (!node) return null;
  return {
    base64: root?.base64 ?? content?.base64 ?? null,
    mimeType:
      node.mimetype ?? (content?.stickerMessage ? 'image/webp' : null),
    fileName: node.fileName ?? null,
  };
}

/**
 * Resolve o JID real do chat. Contas WhatsApp em modo multi-device podem
 * entregar um identificador opaco @lid e o telefone utilizável em
 * remoteJidAlt. Nunca tratamos o número do LID como telefone.
 */
export function resolveEvolutionChatJid(
  message: EvolutionWebhookMessage
): string | null {
  const remoteJid = message.key?.remoteJid?.trim();
  const alternative = message.key?.remoteJidAlt?.trim();
  if (!remoteJid) return alternative || null;
  if (!remoteJid.endsWith('@lid')) return remoteJid;
  return alternative?.endsWith('@s.whatsapp.net') ? alternative : null;
}

/**
 * Isto é ruído de protocolo, não uma mensagem que alguém mandou?
 *
 * Medido na Evolution de produção: 16 de cada 200 mensagens (8%) caíam
 * no texto genérico "[mensagem]" e viravam uma bolha vazia no inbox.
 * Onze eram REAÇÕES — o 👍 que alguém deu numa mensagem — e cinco eram
 * tráfego interno do WhatsApp. Nenhuma delas é conversa.
 *
 * A lista é EXPLÍCITA de propósito. Descartar todo tipo desconhecido
 * seria mais simples e bem pior: localização, cartão de contato e
 * enquete sumiriam caladas. O que não estiver aqui continua aparecendo
 * como "[mensagem]" — feio, mas visível, e visível é recuperável.
 *
 * A reação em si não se perde para sempre: quando existir suporte a
 * mostrá-la na mensagem original, ela volta pelo mesmo evento. O que
 * este descarte impede é ela nascer como conversa.
 */
export function ehRuidoDeProtocolo(
  message: EvolutionWebhookMessage
): boolean {
  const content = unwrapMessageBody(message.message);
  if (!content) return false;

  // Se há QUALQUER conteúdo de verdade junto, não é ruído. O
  // `senderKeyDistributionMessage` costuma vir grudado numa mensagem
  // normal, e descartar pelo acompanhante apagaria a mensagem real.
  const temConteudoReal =
    content.conversation ||
    content.extendedTextMessage ||
    content.imageMessage ||
    content.videoMessage ||
    content.documentMessage ||
    content.audioMessage ||
    content.stickerMessage;
  if (temConteudoReal) return false;

  const RUIDO = [
    "reactionMessage",
    "senderKeyDistributionMessage",
    "secretEncryptedMessage",
    "protocolMessage",
    "messageContextInfo",
  ];
  const chaves = Object.keys(content);
  return chaves.length > 0 && chaves.every((k) => RUIDO.includes(k));
}

export function parseEvolutionMessageContent(
  message: EvolutionWebhookMessage
): { contentType: EvolutionMessageContentType; text: string } {
  const content = unwrapMessageBody(message.message);
  if (content?.conversation) {
    return { contentType: 'text', text: content.conversation };
  }
  if (content?.extendedTextMessage?.text) {
    return { contentType: 'text', text: content.extendedTextMessage.text };
  }
  if (content?.imageMessage) {
    return {
      contentType: 'image',
      text: content.imageMessage.caption?.trim() || '[imagem]',
    };
  }
  if (content?.videoMessage) {
    return {
      contentType: 'video',
      text: content.videoMessage.caption?.trim() || '[vídeo]',
    };
  }
  if (content?.documentMessage) {
    return {
      contentType: 'document',
      text:
        content.documentMessage.caption?.trim() ||
        content.documentMessage.fileName?.trim() ||
        content.documentMessage.title?.trim() ||
        '[documento]',
    };
  }
  if (content?.audioMessage) {
    return { contentType: 'audio', text: '[áudio]' };
  }
  if (content?.stickerMessage) {
    return { contentType: 'image', text: '[figurinha]' };
  }
  return { contentType: 'text', text: '[mensagem]' };
}
