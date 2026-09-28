// src/app/t/[code]/route.ts
// ============================================================
// GET /t/<code> — redirect público dos links rastreáveis.
//
// Sem login (o middleware só protege os paths listados). Captura os
// utm_* da query, registra o clique via RPC atômica (service role) e
// redireciona para o wa.me com a mensagem pré-preenchida. Código
// inexistente ou link desativado: 404 sem contar clique.
// ============================================================

import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { extractUtmParams } from '@/lib/tracking-links/utm';
import { buildWaMeUrl } from '@/lib/tracking-links/wa-link';

// Bots de preview (WhatsApp, Facebook, Telegram, Slack, X, LinkedIn,
// Discord) batem no link antes do usuário para montar a prévia — sem
// isso, cada compartilhamento inflava o contador de cliques.
const PREVIEW_BOT_PATTERN =
  /facebookexternalhit|whatsapp|telegrambot|slackbot|twitterbot|linkedinbot|discordbot/i;

// Não é força bruta de código (não há segredo aqui, o código é público
// por natureza); é amplificação — cada GET registra clique via RPC.
// 60/min por IP é folgado para cliques reais e para uma rede de bots de
// preview atrás do mesmo NAT, e ainda limita um script batendo em loop.
const REDIRECT_RATE_LIMIT = { limit: 60, windowMs: 60_000 };

/** Best-effort client IP a partir dos headers de proxy padrão. */
function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const xri = request.headers.get('x-real-ip');
  if (xri) return xri.trim();
  return 'unknown';
}

function notFound(): NextResponse {
  return new NextResponse('Link não encontrado', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

/** Busca somente-leitura, sem contar clique: usada por bots e HEAD. */
async function lookupWithoutCounting(
  code: string
): Promise<{ phone?: string; message?: string } | null> {
  const { data } = await supabaseAdmin()
    .from('tracking_links')
    .select('phone, message')
    .eq('code', code)
    .eq('active', true)
    .maybeSingle();
  return data;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const ip = getClientIp(request);
    const limit = checkRateLimit(`t-redirect:${ip}`, REDIRECT_RATE_LIMIT);
    if (!limit.success) return rateLimitResponse(limit);

    const { code } = await params;
    if (!code) return notFound();

    // Bot de preview: resolve o link sem contar clique, para a prévia
    // funcionar sem inflar as métricas.
    const userAgent = request.headers.get('user-agent') ?? '';
    if (PREVIEW_BOT_PATTERN.test(userAgent)) {
      const row = await lookupWithoutCounting(code);
      if (!row?.phone || !row?.message) return notFound();
      return NextResponse.redirect(buildWaMeUrl(row.phone, row.message), 302);
    }

    const utm = extractUtmParams(new URL(request.url).searchParams);

    const { data, error } = await supabaseAdmin().rpc('register_link_click', {
      p_code: code,
      p_utm: utm,
    });
    if (error) {
      console.error('[t/redirect] register_link_click:', error);
      return notFound();
    }

    const row = (Array.isArray(data) ? data[0] : data) as
      | { phone?: string; message?: string }
      | undefined;
    if (!row?.phone || !row?.message) return notFound();

    return NextResponse.redirect(buildWaMeUrl(row.phone, row.message), 302);
  } catch (err) {
    console.error('[t/redirect] fatal:', err);
    return notFound();
  }
}

export async function HEAD(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    if (!code) return new NextResponse(null, { status: 404 });

    // HEAD nunca conta clique (não é navegação real do usuário).
    const row = await lookupWithoutCounting(code);
    if (!row?.phone || !row?.message) {
      return new NextResponse(null, { status: 404 });
    }
    return new NextResponse(null, { status: 200 });
  } catch (err) {
    console.error('[t/redirect] fatal (HEAD):', err);
    return new NextResponse(null, { status: 404 });
  }
}
