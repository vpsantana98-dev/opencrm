import { NextResponse } from "next/server";
import crypto from "crypto";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { resolveConfiguredBaseUrl } from "@/lib/http/base-url";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import {
  createInstance,
  isEvolutionConfigured,
} from "@/lib/whatsapp/evolution-api";
import {
  assignProxyIfAvailable,
  ProxyPoolError,
} from "@/lib/whatsapp/proxy-pool";

// A página /conectar/[token] chama isto uma vez ao carregar e de novo a
// cada 30s enquanto o QR expira (ver src/app/conectar/[token]/page.tsx).
// 10/min por IP cobre esse uso com folga sem deixar um IP reconfigurar
// instância / consumir vaga do pool de proxy em loop.
const CONNECT_PUBLIC_RATE_LIMIT = { limit: 10, windowMs: 60_000 };

/** Best-effort client IP a partir dos headers de proxy padrão. */
function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = request.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}

// POST /api/whatsapp/evolution/connect-public  { token }
// Versão SEM login do connect, usada pela página pública /conectar/[token].
// O token (na URL do link) identifica o cliente; validamos pelo hash e
// devolvemos o QR. Só permite CONECTAR aquele cliente — nada mais.
export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    const limit = checkRateLimit(`connect-public:${ip}`, CONNECT_PUBLIC_RATE_LIMIT);
    if (!limit.success) return rateLimitResponse(limit);

    if (!isEvolutionConfigured()) {
      return NextResponse.json(
        { error: "Evolution não configurada" },
        { status: 503 },
      );
    }
    const body = (await request.json().catch(() => ({}))) as { token?: string };
    const token = typeof body.token === "string" ? body.token : "";
    if (!token) {
      return NextResponse.json({ error: "Link inválido" }, { status: 400 });
    }
    const hash = crypto.createHash("sha256").update(token).digest("hex");

    const admin = supabaseAdmin();
    const { data: inst } = await admin
      .from("evolution_instances")
      .select("id, account_id, instance_name, phone")
      .eq("connect_token_hash", hash)
      .maybeSingle();
    if (!inst) {
      return NextResponse.json({ error: "Link inválido ou expirado" }, { status: 404 });
    }

    // Fail-closed: string vazia OU só espaço em branco conta como
    // ausente, para uma env preenchida por engano com espaço não virar
    // um "segredo" de fato vazio.
    const webhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET?.trim();
    if (!webhookSecret) {
      return NextResponse.json(
        { error: "Webhook da Evolution não configurado no servidor" },
        { status: 503 },
      );
    }

    // URL PÚBLICA do app (não a interna). Resolução ESTRITA: aceita só
    // NEXT_PUBLIC_SITE_URL, nunca Host/X-Forwarded-Host da requisição
    // (quem chama esta rota controla esses headers; aqui basta ter um
    // token de conexão válido, sem login algum). Um Host forjado faria
    // a Evolution entregar o segredo do webhook acima para o host que
    // o atacante escolher, então esta rota recusa (503) em vez de cair
    // para qualquer header como último recurso. Ver
    // src/lib/http/base-url.ts.
    const baseUrl = resolveConfiguredBaseUrl();
    if (!baseUrl) {
      console.error(
        "[connect-public] NEXT_PUBLIC_SITE_URL ausente ou inválida: obrigatória para montar a URL do webhook da Evolution (ver .env.local.example)",
      );
      return NextResponse.json(
        { error: "URL pública do app não configurada no servidor" },
        { status: 503 },
      );
    }
    const webhookUrl = `${baseUrl}/api/whatsapp/evolution/webhook/${webhookSecret}`;

    // Pool VAZIO conecta sem proxy (fallback deliberado, spec
    // 2026-08-03-proxy-fallback-pool-vazio-design.md); pool esgotado
    // continua falhando com 503.
    const { config: proxyConfig } = await assignProxyIfAvailable(
      admin,
      inst.account_id as string,
      (inst.phone as string | null) ?? null,
      inst.instance_name as string,
    );

    const qr = await createInstance(
      inst.instance_name as string,
      webhookUrl,
      proxyConfig,
    );
    await admin
      .from("evolution_instances")
      .update({ status: "connecting" })
      // Por ID. O token já identifica UM número; filtrar por conta
      // marcaria os outros números do cliente como "conectando"
      // também, e o painel mostraria conexão em andamento em números
      // que ninguém tocou.
      .eq("id", inst.id);

    return NextResponse.json({
      qr: qr.base64,
      pairingCode: qr.pairingCode ?? null,
    });
  } catch (err) {
    if (err instanceof ProxyPoolError) {
      // `err.message` é seguro por construção: vem do catálogo de
      // ProxyPoolError, que não aceita texto livre nem interpola erro
      // do banco (esta rota NÃO exige login, então tudo que sai aqui é
      // público para quem tem o token). O `code` vai só para o log, e é
      // ele que liga a mensagem genérica que o cliente vê à falha
      // específica registrada pelo proxy-pool.
      console.error(`[connect-public] pool de proxies: ${err.code}`);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[connect-public] error:", err);
    return NextResponse.json({ error: "Erro ao gerar o QR" }, { status: 500 });
  }
}
