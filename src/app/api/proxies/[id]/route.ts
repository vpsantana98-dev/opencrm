import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePlatformAdmin } from "@/lib/auth/platform-admin";
import { encrypt } from "@/lib/whatsapp/encryption";
import { PROXY_SAFE_COLUMNS } from "@/lib/whatsapp/proxy-pool";

// PATCH /api/proxies/[id] — atualiza campos do proxy.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requirePlatformAdmin();
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const patch: Record<string, unknown> = {};
    if (typeof body.label === "string") patch.label = body.label.trim();
    if (typeof body.host === "string") patch.host = body.host.trim();
    // Mesma validação de range do POST: sem isso, uma porta fora de
    // 1-65535 só é barrada pelo CHECK do banco, e o erro cru vazaria
    // detalhe de schema pro cliente.
    if (body.port !== undefined) {
      const port = Number(body.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return NextResponse.json(
          { error: "Porta deve ser um inteiro entre 1 e 65535." },
          { status: 400 },
        );
      }
      patch.port = port;
    }
    if (typeof body.username === "string") patch.username = body.username;
    // Mesma normalização do POST: region tem que sair daqui como
    // `BR-<UF>`, senão a preferência regional do selectProxy nunca casa.
    if (typeof body.region === "string") {
      const raw = body.region.trim().toUpperCase();
      if (raw.length === 0) {
        patch.region = null;
      } else {
        const uf = raw.startsWith("BR-") ? raw.slice(3) : raw;
        if (!/^[A-Z]{2}$/.test(uf)) {
          return NextResponse.json(
            { error: "Região deve ser a UF em duas letras, por exemplo SP ou BR-SP." },
            { status: 400 },
          );
        }
        patch.region = `BR-${uf}`;
      }
    }
    if (Number.isInteger(Number(body.max_instances))) {
      patch.max_instances = Math.max(1, Number(body.max_instances));
    }
    if (["active", "degraded", "disabled"].includes(String(body.status))) {
      patch.status = String(body.status);
      // Reativar zera o contador de falhas, senão a próxima checagem
      // derruba o proxy de novo na primeira falha.
      if (body.status === "active") patch.consecutive_failures = 0;
    }
    // Só cifra quando veio senha nova; string vazia não apaga a atual.
    if (typeof body.password === "string" && body.password.length > 0) {
      patch.password_encrypted = encrypt(body.password);
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "Nenhum campo válido para atualizar." },
        { status: 400 },
      );
    }

    const { data, error } = await supabaseAdmin()
      .from("proxies")
      .update(patch)
      .eq("id", id)
      .select(PROXY_SAFE_COLUMNS)
      .maybeSingle();

    if (error) {
      console.error("[PATCH /api/proxies/[id]] erro ao atualizar proxy:", error);
      return NextResponse.json(
        { error: "Falha ao atualizar o proxy." },
        { status: 400 },
      );
    }
    if (!data) {
      return NextResponse.json({ error: "Proxy não encontrado" }, { status: 404 });
    }
    return NextResponse.json({ proxy: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// DELETE /api/proxies/[id] — remove do pool.
// Recusa se ainda houver instância vinculada: soltar o vínculo em
// silêncio faria o cliente reconectar sem proxy na próxima vez.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requirePlatformAdmin();
    const { id } = await params;
    const admin = supabaseAdmin();

    const { count, error: countError } = await admin
      .from("evolution_instances")
      .select("account_id", { count: "exact", head: true })
      .eq("proxy_id", id);

    // Falha na contagem tem que IMPEDIR a remoção, nunca liberá-la: se
    // seguisse com `count` nulo, `(count ?? 0) > 0` daria falso e o
    // proxy seria removido mesmo com instâncias vinculadas, que é
    // exatamente o que esta rota existe para evitar.
    if (countError) {
      console.error(
        "[DELETE /api/proxies/[id]] erro ao contar instâncias vinculadas:",
        countError,
      );
      return NextResponse.json(
        { error: "Falha ao verificar instâncias vinculadas a este proxy." },
        { status: 500 },
      );
    }

    if ((count ?? 0) > 0) {
      return NextResponse.json(
        {
          error: `Este proxy ainda atende ${count} instância(s). Mova esses clientes para outro proxy antes de remover.`,
        },
        { status: 409 },
      );
    }

    const { error } = await admin.from("proxies").delete().eq("id", id);
    if (error) {
      console.error("[DELETE /api/proxies/[id]] erro ao remover proxy:", error);
      return NextResponse.json(
        { error: "Falha ao remover o proxy." },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
