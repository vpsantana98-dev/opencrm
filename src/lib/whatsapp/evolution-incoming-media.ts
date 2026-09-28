import type { SupabaseClient } from "@supabase/supabase-js";

import { getMediaBase64 } from "@/lib/whatsapp/evolution-api";
import {
  getEvolutionIncomingMedia,
  type EvolutionWebhookMessage,
} from "@/lib/whatsapp/evolution-webhook-message";

const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/aac": "aac",
  "audio/mp4": "m4a",
  "audio/amr": "amr",
  "application/pdf": "pdf",
  "text/plain": "txt",
};

function normalizeBase64(value: string): string {
  const comma = value.indexOf(",");
  return value.startsWith("data:") && comma >= 0
    ? value.slice(comma + 1)
    : value;
}

/**
 * Tira os parametros do mime type: "audio/ogg; codecs=opus" -> "audio/ogg".
 *
 * O WhatsApp manda audio como `audio/ogg; codecs=opus`. O Supabase Storage
 * compara a string INTEIRA contra a lista permitida do bucket, que tem
 * "audio/ogg" — entao rejeitava todo audio recebido com
 * "mime type audio/ogg; codecs=opus is not supported". O mesmo sufixo
 * tambem furava a tabela de extensoes, e o arquivo seria salvo como .bin.
 *
 * Normalizar aqui conserta os dois de uma vez, e sem depender de alguem
 * lembrar de cadastrar cada combinacao de codec no bucket.
 */
export function normalizeMimeType(mimeType: string): string {
  return mimeType.split(";")[0].trim().toLowerCase();
}

function extensionFor(mimeType: string, fileName: string | null): string {
  const fromName = fileName?.match(/\.([a-zA-Z0-9]{1,8})$/)?.[1];
  return (fromName || EXTENSION_BY_MIME[mimeType] || "bin").toLowerCase();
}

/** Salva a mídia recebida em Storage e devolve uma URL estável para o chat. */
export async function persistEvolutionIncomingMedia(
  db: SupabaseClient,
  args: {
    accountId: string;
    instanceName: string;
    messageId: string;
    message: EvolutionWebhookMessage;
  },
): Promise<string | null> {
  const embedded = getEvolutionIncomingMedia(args.message);
  if (!embedded) return null;

  let base64 = embedded.base64;
  let mimeType = embedded.mimeType;
  let fileName = embedded.fileName;

  // Algumas versões não anexam base64 ao webhook mesmo com a opção
  // ligada. Nessa situação pedimos a mídia usando a mensagem original.
  if (!base64) {
    const downloaded = await getMediaBase64(
      args.instanceName,
      args.message,
    ).catch((err) => {
      // Era `.catch(() => null)`: a exceção sumia sem log. Como este
      // download virou o caminho normal de TODA mídia, engolir o erro
      // aqui é o que fazia "a foto não abre" ser impossível de
      // investigar, do lado do CRM e do servidor.
      console.error(
        `[media] download da mídia falhou (${args.messageId}):`,
        err instanceof Error ? err.message : err,
      );
      return null;
    });
    base64 = downloaded?.base64 ?? null;
    mimeType = mimeType ?? downloaded?.mimeType ?? null;
    fileName = fileName ?? downloaded?.fileName ?? null;
  }
  if (!base64 || !mimeType) {
    // Desistir em silêncio deixava a mensagem no inbox como uma bolha
    // que não abre e não baixa, sem nada explicando por quê. Dizer QUAL
    // metade faltou é o que separa "a Evolution não entregou o arquivo"
    // de "veio arquivo sem tipo".
    console.error(
      `[media] desisti da mídia ${args.messageId}:`,
      !base64 ? "sem base64" : "sem mimeType",
      `(embutida no webhook: ${embedded.base64 ? "sim" : "não"})`,
    );
    return null;
  }
  const mime = normalizeMimeType(mimeType);

  const normalized = normalizeBase64(base64).replace(/\s/g, "");
  // Verificação barata antes de alocar o Buffer completo.
  if (normalized.length > Math.ceil((MAX_MEDIA_BYTES * 4) / 3) + 4) {
    throw new Error("Mídia recebida excede o limite de 16 MB");
  }
  const buffer = Buffer.from(normalized, "base64");
  if (!buffer.length || buffer.length > MAX_MEDIA_BYTES) {
    throw new Error("Mídia recebida vazia ou acima do limite");
  }

  const safeId = args.messageId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const path = `account-${args.accountId}/evolution/${safeId}.${extensionFor(mime, fileName)}`;
  const bucket = db.storage.from("chat-media");
  const { error } = await bucket.upload(path, buffer, {
    contentType: mime,
    cacheControl: "31536000",
    upsert: false,
  });
  if (error && !/already exists|duplicate/i.test(error.message)) {
    throw new Error(`Falha ao armazenar mídia recebida: ${error.message}`);
  }
  return bucket.getPublicUrl(path).data.publicUrl;
}
