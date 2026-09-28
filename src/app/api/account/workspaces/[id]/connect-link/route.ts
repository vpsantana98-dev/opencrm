import { NextResponse } from "next/server";
import crypto from "crypto";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { resolveConfiguredBaseUrl } from "@/lib/http/base-url";

// POST /api/account/workspaces/[id]/connect-link
// Gera (ou regenera) o link público de conexão do cliente [id]. A
// agência manda esse link para o responsável do cliente, que abre SEM
// login e escaneia o QR. Guardamos só o hash do token; o token vai na
// URL retornada. Só owner/admin do cliente gera.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ctx = await getCurrentAccount();
    const admin = supabaseAdmin();

    // Autorização: precisa ser owner/admin da conta alvo.
    const { data: mem } = await admin
      .from("account_members")
      .select("role")
      .eq("account_id", id)
      .eq("user_id", ctx.userId)
      .maybeSingle();
    if (!mem || (mem.role !== "owner" && mem.role !== "admin")) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    // PARA QUAL número é o link.
    //
    // Escanear o QR de um número substitui a sessão daquele número. Com
    // vários, adivinhar qual derrubaria o WhatsApp errado do cliente —
    // um erro que só aparece quando as mensagens param de chegar. Então:
    // com mais de um número e sem alvo, esta rota recusa e pede escolha.
    const corpo = (await request.json().catch(() => ({}))) as {
      instanceId?: unknown;
      novo?: unknown;
    };
    const alvoId = typeof corpo.instanceId === "string" ? corpo.instanceId : null;
    const querNovo = corpo.novo === true;

    const { data: existentes } = await admin
      .from("evolution_instances")
      .select("id")
      .eq("account_id", id)
      .order("created_at", { ascending: true });
    const lista = existentes ?? [];

    let alvo: string | null = null;
    if (alvoId) {
      const achado = lista.find((i) => i.id === alvoId);
      if (!achado) {
        return NextResponse.json(
          { error: "Número não encontrado neste cliente." },
          { status: 404 },
        );
      }
      alvo = achado.id as string;
    } else if (!querNovo && lista.length === 1) {
      // Caso de sempre: um número só, sem ambiguidade.
      alvo = lista[0].id as string;
    } else if (!querNovo && lista.length > 1) {
      return NextResponse.json(
        {
          error:
            "Este cliente tem mais de um número. Escolha para qual número gerar o link.",
          code: "instancia_ambigua",
          total: lista.length,
        },
        { status: 400 },
      );
    }

    const token = crypto.randomBytes(32).toString("base64url");
    const hash = crypto.createHash("sha256").update(token).digest("hex");

    if (alvo) {
      await admin
        .from("evolution_instances")
        .update({ connect_token_hash: hash })
        .eq("id", alvo);
    } else {
      // Número novo. `instance_name` é UNIQUE e não pode mais ser o id
      // da conta (o segundo colidiria) — grava provisório e troca pelo
      // próprio id, único por construção. Mesma regra do /connect.
      const { data: criada, error: erroCriar } = await admin
        .from("evolution_instances")
        .insert({
          account_id: id,
          instance_name: `pendente-${crypto.randomUUID()}`,
          status: "created",
          connect_token_hash: hash,
          is_default: lista.length === 0,
        })
        .select("id")
        .single();
      if (erroCriar || !criada) {
        console.error("[connect-link] criar instância:", erroCriar);
        return NextResponse.json(
          { error: "Não foi possível preparar a conexão" },
          { status: 500 },
        );
      }
      await admin
        .from("evolution_instances")
        .update({ instance_name: criada.id as string })
        .eq("id", criada.id);
    }

    // URL PÚBLICA do app (não a interna). Resolução ESTRITA: aceita só
    // NEXT_PUBLIC_SITE_URL, nunca Host/X-Forwarded-Host da requisição —
    // um Host forjado faria este link (que carrega o token de conexão)
    // apontar para um domínio do atacante. Ver src/lib/http/base-url.ts
    // e a rota irmã src/app/api/whatsapp/evolution/connect-public/route.ts.
    const baseUrl = resolveConfiguredBaseUrl();
    if (!baseUrl) {
      console.error(
        "[connect-link] NEXT_PUBLIC_SITE_URL ausente ou inválida: obrigatória para montar o link público de conexão (ver .env.local.example)",
      );
      return NextResponse.json(
        { error: "URL pública do app não configurada no servidor" },
        { status: 503 },
      );
    }
    const link = `${baseUrl}/conectar/${token}`;

    return NextResponse.json({ link });
  } catch (err) {
    return toErrorResponse(err);
  }
}
