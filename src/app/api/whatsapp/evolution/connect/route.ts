import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { escolherPadrao, listarInstancias } from "@/lib/whatsapp/instances";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { resolveConfiguredBaseUrl } from "@/lib/http/base-url";
import { createInstance, isEvolutionConfigured } from "@/lib/whatsapp/evolution-api";
import {
  assignProxyIfAvailable,
  ProxyPoolError,
} from "@/lib/whatsapp/proxy-pool";

// POST /api/whatsapp/evolution/connect
// Conecta o WhatsApp do CLIENTE ATIVO via Evolution (QR code). Cria a
// instância na Evolution, aponta o webhook para o
// CRM e devolve o QR para a UI exibir. Só admin+ conecta.
// `request` não é mais necessário: a URL do webhook agora vem só de
// NEXT_PUBLIC_SITE_URL (resoluções ESTRITA, ver resolveConfiguredBaseUrl
// abaixo), nunca de headers da requisição. O parâmetro é opcional em
// route handlers do Next.js.
export async function POST(request: Request) {
  try {
    if (!isEvolutionConfigured()) {
      return NextResponse.json(
        { error: "Evolution não configurada no servidor" },
        { status: 503 },
      );
    }
    const ctx = await requireRole("admin");

    // Qual número: reconectar um existente (`instanceId`) ou criar mais
    // um (`novo: true`). Sem nenhum dos dois, mantém o comportamento
    // antigo — reconecta o número que existe, ou cria o primeiro.
    const corpo = (await request.json().catch(() => ({}))) as {
      instanceId?: unknown;
      novo?: unknown;
    };
    const alvoId =
      typeof corpo.instanceId === "string" ? corpo.instanceId : null;
    const querNovo = corpo.novo === true;

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
    // (quem chama esta rota controla esses headers; aqui basta ser
    // admin de QUALQUER conta). Um Host forjado faria a Evolution
    // entregar o segredo do webhook acima para o host que o atacante
    // escolher, então esta rota recusa (503) em vez de cair para
    // qualquer header como último recurso. Ver src/lib/http/base-url.ts.
    const baseUrl = resolveConfiguredBaseUrl();
    if (!baseUrl) {
      console.error(
        "[evolution/connect] NEXT_PUBLIC_SITE_URL ausente ou inválida: obrigatória para montar a URL do webhook da Evolution (ver .env.local.example)",
      );
      return NextResponse.json(
        { error: "URL pública do app não configurada no servidor" },
        { status: 503 },
      );
    }
    const webhookUrl = `${baseUrl}/api/whatsapp/evolution/webhook/${webhookSecret}`;

    // O upsert com `onConflict: "account_id"` saiu daqui: depois da
    // migration 058 `account_id` deixou de ser único, e `onConflict`
    // EXIGE um índice único — a chamada passaria a falhar mesmo com um
    // número só. Agora é decisão explícita entre reconectar e criar.
    const existentes = await listarInstancias(ctx.supabase, ctx.accountId);
    const alvo = alvoId
      ? existentes.find((i) => i.id === alvoId)
      : querNovo
        ? null
        : escolherPadrao(existentes);

    if (alvoId && !alvo) {
      return NextResponse.json(
        { error: "Número não encontrado nesta conta." },
        { status: 404 },
      );
    }

    let instanceName: string;
    // Qual linha este QR representa. A interface precisa disto para
    // saber qual número da lista está esperando leitura — em especial
    // ao ADICIONAR um número, quando o id ainda não existia no cliente.
    let instanceId: string;
    let upErr: { message?: string } | null = null;

    if (alvo) {
      instanceName = alvo.instance_name;
      instanceId = alvo.id;
      const { error } = await ctx.supabase
        .from("evolution_instances")
        .update({ status: "connecting" })
        .eq("id", alvo.id);
      upErr = error;
    } else {
      // Número NOVO. O nome não pode mais ser o `account_id`: ele era
      // único por conta justamente porque só havia um número, e
      // `instance_name` é UNIQUE — o segundo colidiria. Grava a linha
      // primeiro para usar o id gerado como nome, que é único por
      // construção. Os números já conectados mantêm o nome antigo: a
      // Evolution os conhece assim, e renomear derrubaria a sessão.
      const { data: criada, error } = await ctx.supabase
        .from("evolution_instances")
        .insert({
          account_id: ctx.accountId,
          // Provisório: trocado logo abaixo pelo id real.
          instance_name: `pendente-${crypto.randomUUID()}`,
          status: "connecting",
          // O primeiro número da conta vira o padrão.
          is_default: existentes.length === 0,
        })
        .select("id")
        .single();
      upErr = error;
      if (criada) {
        instanceName = criada.id as string;
        instanceId = criada.id as string;
        await ctx.supabase
          .from("evolution_instances")
          .update({ instance_name: instanceName })
          .eq("id", criada.id);
      } else {
        instanceName = "";
        instanceId = "";
      }
    }

    if (upErr || !instanceName) {
      console.error("[evolution/connect] registro:", upErr);
      return NextResponse.json(
        { error: "Não foi possível registrar a conexão" },
        { status: 400 },
      );
    }

    // Telefone do cliente, quando já conhecido, para casar a região do
    // proxy com o DDD. Instância nova ainda não tem: segue sem
    // preferência regional.
    const admin = supabaseAdmin();
    // Telefone DESTE número, quando já conhecido. Antes lia por
    // `account_id` com `.maybeSingle()`, que erraria com vários.
    const { data: inst } = await admin
      .from("evolution_instances")
      .select("phone")
      .eq("instance_name", instanceName)
      .maybeSingle();

    // Pool VAZIO conecta sem proxy (fallback deliberado, spec
    // 2026-08-03-proxy-fallback-pool-vazio-design.md); pool esgotado
    // continua falhando com 503 — ver assignProxyIfAvailable em
    // proxy-pool.ts.
    const { config: proxyConfig } = await assignProxyIfAvailable(
      admin,
      ctx.accountId,
      (inst?.phone as string | null) ?? null,
      instanceName,
    );

    const qr = await createInstance(instanceName, webhookUrl, proxyConfig);
    return NextResponse.json({
      qr: qr.base64,
      pairingCode: qr.pairingCode ?? null,
      instanceId,
    });
  } catch (err) {
    if (err instanceof ProxyPoolError) {
      // Mesma regra da rota pública: `err.message` vem do catálogo de
      // ProxyPoolError e nunca carrega detalhe do banco. O `code` fica
      // no log do servidor, que é onde o detalhe já foi registrado.
      console.error(`[evolution/connect] pool de proxies: ${err.code}`);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return toErrorResponse(err);
  }
}
