import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePlatformAdmin } from "@/lib/auth/platform-admin";
import { encrypt } from "@/lib/whatsapp/encryption";
import { normalizeProxyHost } from "@/lib/whatsapp/proxy-check";
import { PROXY_SAFE_COLUMNS } from "@/lib/whatsapp/proxy-pool";

// GET /api/proxies — lista o pool com a carga atual de cada proxy.
export async function GET() {
  try {
    await requirePlatformAdmin();
    const admin = supabaseAdmin();

    const { data: proxies, error } = await admin
      .from("proxies")
      .select(PROXY_SAFE_COLUMNS)
      .order("label");
    if (error) {
      console.error("[GET /api/proxies] erro ao consultar proxies:", error);
      return NextResponse.json(
        { error: "Falha ao consultar o pool de proxies." },
        { status: 500 },
      );
    }

    const { data: usage } = await admin
      .from("evolution_instances")
      .select("proxy_id")
      .not("proxy_id", "is", null);

    const counts = new Map<string, number>();
    for (const row of (usage ?? []) as { proxy_id: string }[]) {
      counts.set(row.proxy_id, (counts.get(row.proxy_id) ?? 0) + 1);
    }

    return NextResponse.json({
      proxies: (proxies ?? []).map((p) => ({
        ...p,
        current_instances: counts.get(p.id as string) ?? 0,
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/proxies — cadastra um proxy no pool.
export async function POST(request: Request) {
  try {
    await requirePlatformAdmin();
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const label = typeof body.label === "string" ? body.label.trim() : "";
    // Guarda o host em forma CANÔNICA, sem colchetes. Provedor de proxy
    // residencial para WhatsApp costuma entregar IPv6, e o painel deles
    // (ou o operador copiando) pode vir com `[2804:abc::1]`. Quem precisa
    // dos colchetes é só a URL do checker (ver formatHostForUrl); a
    // Evolution recebe host e porta em campos separados, crus.
    const host = normalizeProxyHost(
      typeof body.host === "string" ? body.host : "",
    );
    const port = Number(body.port);

    if (!label || !host || !Number.isInteger(port) || port < 1 || port > 65535) {
      return NextResponse.json(
        { error: "Informe rótulo, host e uma porta entre 1 e 65535." },
        { status: 400 },
      );
    }

    const kind = ["mobile", "isp", "residential"].includes(String(body.kind))
      ? String(body.kind)
      : "mobile";
    const protocol = ["http", "socks5"].includes(String(body.protocol))
      ? String(body.protocol)
      : "http";
    const maxInstances = Number.isInteger(Number(body.max_instances))
      ? Math.max(1, Number(body.max_instances))
      : 4;

    // `selectProxy` compara region com `BR-<UF>`. Um operador que digita
    // só "SP" criaria um proxy que nunca casa com DDD nenhum, e a falha
    // seria silenciosa: o pool continua funcionando, só perde a
    // preferência regional. Normaliza aqui e rejeita o que não encaixa.
    let region: string | null = null;
    if (typeof body.region === "string" && body.region.trim().length > 0) {
      const raw = body.region.trim().toUpperCase();
      const uf = raw.startsWith("BR-") ? raw.slice(3) : raw;
      if (!/^[A-Z]{2}$/.test(uf)) {
        return NextResponse.json(
          { error: "Região deve ser a UF em duas letras, por exemplo SP ou BR-SP." },
          { status: 400 },
        );
      }
      region = `BR-${uf}`;
    }

    const password =
      typeof body.password === "string" && body.password.length > 0
        ? encrypt(body.password)
        : null;

    const { data, error } = await supabaseAdmin()
      .from("proxies")
      .insert({
        label,
        kind,
        protocol,
        host,
        port,
        username: typeof body.username === "string" ? body.username : null,
        password_encrypted: password,
        region,
        max_instances: maxInstances,
        rotate_url: typeof body.rotate_url === "string" ? body.rotate_url : null,
      })
      .select(PROXY_SAFE_COLUMNS)
      .single();

    if (error) {
      console.error("[POST /api/proxies] erro ao cadastrar proxy:", error);
      return NextResponse.json(
        { error: "Falha ao cadastrar o proxy." },
        { status: 400 },
      );
    }
    return NextResponse.json({ proxy: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
