import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { deleteInstance, isEvolutionConfigured } from "@/lib/whatsapp/evolution-api";
import { releaseProxy } from "@/lib/whatsapp/proxy-pool";

// PATCH /api/account/workspaces/[id]
//   { name?, logo_url?, segment?, whatsapp_owner?, ad_platforms?,
//     conversation_scope? }
// Edita um workspace de cliente. Só o dono. Usado pelo assistente para
// corrigir o nome e para gravar a logo depois do upload.
//
// Os dois campos são independentes: o assistente salva o nome num
// momento e a logo em outro (ela só pode subir depois de a conta
// existir). Exigir os dois juntos obrigaria a reenviar o nome a cada
// troca de imagem.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ctx = await getCurrentAccount();
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      logo_url?: string | null;
      segment?: unknown;
      whatsapp_owner?: unknown;
      ad_platforms?: unknown;
      conversation_scope?: unknown;
    };

    const temNome = typeof body.name === "string";
    const temLogo = "logo_url" in body;
    // Perfil operacional (migration 059): ramo do cliente, quem tem o
    // celular, onde ele anuncia e se grupo entra no CRM.
    const temSegmento = "segment" in body;
    const temDono = "whatsapp_owner" in body;
    const temPlataformas = "ad_platforms" in body;
    const temEscopo = "conversation_scope" in body;
    if (
      !temNome &&
      !temLogo &&
      !temSegmento &&
      !temDono &&
      !temPlataformas &&
      !temEscopo
    ) {
      return NextResponse.json(
        { error: "Nada para alterar" },
        { status: 400 },
      );
    }

    const name = (body.name ?? "").trim();
    if (temNome) {
      if (!name) {
        return NextResponse.json({ error: "Informe um nome" }, { status: 400 });
      }
      if (name.length > 120) {
        return NextResponse.json({ error: "Nome muito longo" }, { status: 400 });
      }
    }

    // A logo é uma URL do NOSSO storage. Aceitar qualquer endereço
    // deixaria a interface carregar imagem de terceiro em toda tela onde
    // o cliente aparece — um jeito silencioso de rastrear quem abriu o
    // CRM, e de exibir conteúdo que não controlamos.
    let logoUrl: string | null | undefined;
    if (temLogo) {
      const bruto = body.logo_url;
      if (bruto === null || bruto === "") {
        logoUrl = null;
      } else if (typeof bruto === "string") {
        const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
        if (!base || !bruto.startsWith(`${base}/storage/v1/object/public/`)) {
          return NextResponse.json(
            { error: "Logo inválida." },
            { status: 400 },
          );
        }
        logoUrl = bruto;
      } else {
        return NextResponse.json({ error: "Logo inválida." }, { status: 400 });
      }
    }
    const admin = supabaseAdmin();
    const { data: acc } = await admin
      .from("accounts")
      .select("owner_user_id")
      .eq("id", id)
      .maybeSingle();
    if (!acc) {
      return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });
    }
    if (acc.owner_user_id !== ctx.userId) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    // Monta só o que veio: um PATCH de logo não pode zerar o nome, e
    // vice-versa.
    const patch: Record<string, unknown> = {};
    if (temNome) patch.name = name;
    if (temLogo) patch.logo_url = logoUrl ?? null;

    if (temSegmento) {
      // Texto livre por decisão: lista fechada sempre falta justo o ramo
      // do cliente novo. Vazio volta a NULL para o filtro da tela de
      // Clientes não criar uma categoria "" invisível.
      const bruto = typeof body.segment === "string" ? body.segment.trim() : "";
      patch.segment = bruto === "" ? null : bruto.slice(0, 60);
    }

    if (temDono) {
      const v = body.whatsapp_owner;
      if (v !== null && v !== "agencia" && v !== "cliente") {
        return NextResponse.json(
          { error: "Responsável pelo WhatsApp inválido" },
          { status: 400 },
        );
      }
      patch.whatsapp_owner = v;
    }

    if (temPlataformas) {
      // Validado contra a lista conhecida em vez de repassado cru: a
      // coluna não tem CHECK (é array), então o filtro é aqui.
      const conhecidas = ["meta", "google"];
      const lista = Array.isArray(body.ad_platforms) ? body.ad_platforms : [];
      const limpa = [
        ...new Set(
          lista.filter(
            (p): p is string => typeof p === "string" && conhecidas.includes(p),
          ),
        ),
      ];
      patch.ad_platforms = limpa;
    }

    if (temEscopo) {
      const v = body.conversation_scope;
      if (v !== "todas" && v !== "sem_grupos") {
        return NextResponse.json(
          { error: "Escopo de conversas inválido" },
          { status: 400 },
        );
      }
      patch.conversation_scope = v;
    }

    const { error } = await admin.from("accounts").update(patch).eq("id", id);
    if (error) {
      console.error("[PATCH /api/account/workspaces] erro:", error.message);
      return NextResponse.json(
        { error: "Não foi possível salvar as alterações" },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// DELETE /api/account/workspaces/[id]
// Exclui um workspace de cliente. Valida a posse, apaga a instância na
// Evolution (se houver) e então chama a RPC delete_workspace (que
// revalida e cascateia). A RPC recusa a conta "home" da agência.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ctx = await getCurrentAccount();

    // Confirma a posse antes de mexer em qualquer coisa (a RPC também
    // valida, mas checamos aqui para não tocar na Evolution à toa).
    const admin = supabaseAdmin();
    const { data: acc } = await admin
      .from("accounts")
      .select("owner_user_id")
      .eq("id", id)
      .maybeSingle();
    if (!acc) {
      return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });
    }
    if (acc.owner_user_id !== ctx.userId) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    // Libera a vaga do proxy ANTES de apagar a instância na Evolution:
    // operação só no banco, independe da Evolution estar configurada, e
    // devolve o IP ao pool mesmo se o delete na Evolution falhar abaixo.
    await releaseProxy(admin, id);

    // Apaga a instância na Evolution ANTES do cascade (senão perdemos o
    // instance_name). Best-effort: se falhar, seguimos com a exclusão.
    if (isEvolutionConfigured()) {
      // TODOS os números do cliente, não só um.
      //
      // Isto usava `.maybeSingle()`, que com dois números devolve ERRO
      // e nenhuma linha — o cliente sumiria do CRM e as sessões
      // continuariam de pé na Evolution, ocupando WhatsApp e vaga de
      // proxy, sem nada no sistema apontando para elas.
      const { data: instancias } = await admin
        .from("evolution_instances")
        .select("instance_name")
        .eq("account_id", id);
      for (const inst of instancias ?? []) {
        if (!inst.instance_name) continue;
        try {
          await deleteInstance(inst.instance_name as string);
        } catch (e) {
          // Best-effort por número: uma falha não pode impedir a
          // exclusão dos outros nem a do próprio cliente.
          console.warn("[workspaces DELETE] evolution delete falhou:", e);
        }
      }
    }

    const { error } = await ctx.supabase.rpc("delete_workspace", {
      p_account_id: id,
    });
    if (error) {
      console.error("[workspaces DELETE] rpc error:", error);
      const msg =
        error.code === "23514"
          ? "Não é possível excluir a sua conta principal"
          : error.code === "42501"
            ? "Só o dono pode excluir este cliente"
            : "Não foi possível excluir o cliente";
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
