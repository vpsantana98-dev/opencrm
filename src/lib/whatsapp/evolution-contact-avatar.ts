import type { SupabaseClient } from "@supabase/supabase-js";

import { getProfilePictureUrl } from "@/lib/whatsapp/evolution-api";
import { isDeliverableUrl } from "@/lib/webhooks/ssrf";

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

function avatarExtension(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

export async function refreshEvolutionContactAvatar(
  db: SupabaseClient,
  args: {
    accountId: string;
    instanceName: string;
    contactId: string;
    numberOrJid: string;
    force?: boolean;
  },
): Promise<string | null> {
  if (!args.force) {
    const { data: contact } = await db
      .from("contacts")
      .select("avatar_url, whatsapp_avatar_checked_at")
      .eq("id", args.contactId)
      .eq("account_id", args.accountId)
      .maybeSingle();
    const checkedAt = contact?.whatsapp_avatar_checked_at
      ? new Date(contact.whatsapp_avatar_checked_at as string).getTime()
      : 0;
    if (
      checkedAt &&
      Date.now() - checkedAt < REFRESH_INTERVAL_MS
    ) {
      return (contact?.avatar_url as string | null) ?? null;
    }
  }

  const checkedAt = new Date().toISOString();
  const sourceUrl = await getProfilePictureUrl(
    args.instanceName,
    args.numberOrJid,
  ).catch(() => null);
  if (!sourceUrl) {
    await db
      .from("contacts")
      .update({ whatsapp_avatar_checked_at: checkedAt })
      .eq("id", args.contactId)
      .eq("account_id", args.accountId);
    return null;
  }

  let source: URL;
  try {
    source = new URL(sourceUrl);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(source.protocol)) return null;
  if (!(await isDeliverableUrl(source.toString()))) return null;

  const response = await fetch(source, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  const mimeType =
    response.headers.get("content-type")?.split(";")[0]?.trim() ||
    "image/jpeg";
  if (!mimeType.startsWith("image/")) return null;
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > AVATAR_MAX_BYTES) {
    return null;
  }
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > AVATAR_MAX_BYTES) return null;

  const path = `account-${args.accountId}/evolution-avatars/${args.contactId}.${avatarExtension(mimeType)}`;
  const bucket = db.storage.from("chat-media");
  const { error } = await bucket.upload(path, bytes, {
    contentType: mimeType,
    cacheControl: "86400",
    upsert: true,
  });
  if (error) throw new Error(`Falha ao armazenar avatar: ${error.message}`);

  const publicUrl = bucket.getPublicUrl(path).data.publicUrl;
  await db
    .from("contacts")
    .update({
      avatar_url: publicUrl,
      whatsapp_avatar_checked_at: checkedAt,
      updated_at: checkedAt,
    })
    .eq("id", args.contactId)
    .eq("account_id", args.accountId);
  return publicUrl;
}

export async function syncEvolutionContactAvatars(
  db: SupabaseClient,
  args: { accountId: string; instanceName: string; limit?: number },
): Promise<{ checked: number; updated: number }> {
  const staleBefore = new Date(Date.now() - REFRESH_INTERVAL_MS).toISOString();
  const { data: contacts, error } = await db
    .from("contacts")
    .select("id, phone, wa_jid")
    .eq("account_id", args.accountId)
    .or(
      `whatsapp_avatar_checked_at.is.null,whatsapp_avatar_checked_at.lt.${staleBefore}`,
    )
    .limit(args.limit ?? 50);
  if (error) throw new Error(`Falha ao listar contatos para fotos: ${error.message}`);

  let updated = 0;
  const rows = contacts ?? [];
  // Lotes pequenos evitam tempestade de chamadas e limites da Evolution.
  for (let index = 0; index < rows.length; index += 5) {
    const batch = rows.slice(index, index + 5);
    const results = await Promise.all(
      batch.map((contact) =>
        refreshEvolutionContactAvatar(db, {
          accountId: args.accountId,
          instanceName: args.instanceName,
          contactId: contact.id as string,
          numberOrJid: (contact.wa_jid || contact.phone) as string,
        }).catch(() => null),
      ),
    );
    updated += results.filter(Boolean).length;
  }
  return { checked: rows.length, updated };
}
