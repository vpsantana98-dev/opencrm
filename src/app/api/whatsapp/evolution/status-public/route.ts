import { NextResponse } from "next/server";
import crypto from "crypto";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { captureInstancePhone } from "@/lib/whatsapp/capture-instance-phone";
import { getConnectionState } from "@/lib/whatsapp/evolution-api";

// Página pública faz polling a cada 3s (src/app/conectar/[token]/page.tsx) —
// ~20 req/min por sessão legítima. 40/min por IP dá folga para múltiplas
// abas/sessões atrás do mesmo IP sem abrir a porta para amplificação (cada
// chamada bate na Evolution e faz UPDATE no banco).
const STATUS_PUBLIC_RATE_LIMIT = { limit: 40, windowMs: 60_000 };

/** Best-effort client IP a partir dos headers de proxy padrão. */
function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = request.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}

// GET /api/whatsapp/evolution/status-public?token=...
// Status SEM login para a página pública /conectar/[token]. Identifica o
// cliente pelo hash do token e devolve se está conectado. Faz o polling
// que a página usa para virar "conectado".
export async function GET(request: Request) {
  try {
    const ip = getClientIp(request);
    const limit = checkRateLimit(`status-public:${ip}`, STATUS_PUBLIC_RATE_LIMIT);
    if (!limit.success) return rateLimitResponse(limit);

    const token = new URL(request.url).searchParams.get("token") ?? "";
    if (!token) {
      return NextResponse.json({ valid: false, connected: false });
    }
    const hash = crypto.createHash("sha256").update(token).digest("hex");

    const admin = supabaseAdmin();
    const { data: inst } = await admin
      .from("evolution_instances")
      .select("id, account_id, instance_name")
      .eq("connect_token_hash", hash)
      .maybeSingle();
    if (!inst) {
      return NextResponse.json({ valid: false, connected: false });
    }

    // Nome do cliente para a página pública dizer "Conectando para: X".
    // Quem abre o link é o responsável DAQUELE cliente, e o nome é o do
    // próprio negócio dele. Sem token não se chega aqui, então isso não
    // é enumerável.
    const { data: acct } = await admin
      .from("accounts")
      .select("name")
      .eq("id", inst.account_id)
      .maybeSingle();
    const accountName = (acct?.name as string | undefined) ?? null;

    const state = await getConnectionState(inst.instance_name as string);
    const connected = state === "open";
    const nextStatus = connected
      ? "connected"
      : state === "connecting"
        ? "connecting"
        : "disconnected";
    await admin
      .from("evolution_instances")
      .update({ status: nextStatus })
      // Por ID: o token aponta para UM número. Filtrar por conta faria
      // o polling desta página carimbar o estado dele em todos os
      // outros números do cliente, a cada 3 segundos.
      .eq("id", inst.id);

    if (connected) {
      await captureInstancePhone(
        admin,
        inst.account_id as string,
        inst.instance_name as string,
      );
    }

    return NextResponse.json({
      valid: true,
      connected,
      state,
      account_name: accountName,
    });
  } catch (err) {
    console.error("[status-public] error:", err);
    return NextResponse.json({ valid: true, connected: false });
  }
}
