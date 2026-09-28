import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { decrypt } from "@/lib/whatsapp/encryption";
import {
  getTargetWithTasks,
  buildTargetUrl,
} from "@/lib/clickup/client";

// ClickUp no inbox (modo OpenCRM). GET devolve o card (tarefas da Pasta/
// Lista do cliente) da conversa; POST conecta a conversa a um alvo do
// ClickUp escolhido via API. Só time interno; o card é lido com a chave
// ClickUp de CADA usuário.

async function me(userId: string) {
  const { data } = await supabaseAdmin()
    .from("profiles")
    .select("is_internal, clickup_api_key")
    .eq("user_id", userId)
    .maybeSingle();
  return data as { is_internal?: boolean; clickup_api_key?: string | null } | null;
}

async function convInAccount(conversationId: string, accountId: string) {
  const { data } = await supabaseAdmin()
    .from("conversations")
    .select(
      "id, account_id, clickup_list_id, clickup_url, clickup_ref_type, clickup_ref_id, clickup_ref_name, health, cs_owner",
    )
    .eq("id", conversationId)
    .maybeSingle();
  if (!data || data.account_id !== accountId) return null;
  return data as {
    id: string;
    clickup_list_id: string | null;
    clickup_url: string | null;
    clickup_ref_type: string | null;
    clickup_ref_id: string | null;
    clickup_ref_name: string | null;
    health: string | null;
    cs_owner: string | null;
  };
}

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const prof = await me(ctx.userId);
    if (!prof?.is_internal) {
      return NextResponse.json({ internal: false, linked: false });
    }
    const conversationId =
      new URL(request.url).searchParams.get("conversationId") ?? "";
    const conv = conversationId
      ? await convInAccount(conversationId, ctx.accountId)
      : null;
    if (!conv) return NextResponse.json({ internal: true, linked: false });

    // Campos do CRM (independem do ClickUp): saúde + responsável override.
    const base = {
      internal: true as const,
      health: conv.health,
      csOwner: conv.cs_owner,
    };

    // Referência nova (pasta/lista) tem prioridade; cai no clickup_list_id
    // (047) como 'list' pra conversas ligadas antes da migração 050.
    const refType = (conv.clickup_ref_type ??
      (conv.clickup_list_id ? "list" : null)) as "folder" | "list" | null;
    const refId = conv.clickup_ref_id ?? conv.clickup_list_id ?? null;

    if (!refType || !refId) {
      return NextResponse.json({ ...base, linked: false });
    }
    if (!prof.clickup_api_key) {
      return NextResponse.json({
        ...base,
        linked: true,
        needsKey: true,
        url: conv.clickup_url,
      });
    }
    const res = await getTargetWithTasks(
      decrypt(prof.clickup_api_key),
      refType,
      refId,
    );
    if (!res.ok) {
      return NextResponse.json({
        ...base,
        linked: true,
        error: res.error,
        url: conv.clickup_url,
      });
    }
    const tasks = res.tasks ?? [];
    // Próxima entrega = menor vencimento futuro entre as tarefas abertas.
    const now = Date.now();
    const dues = tasks
      .map((t) => t.due)
      .filter((d): d is number => d !== null && d >= now)
      .sort((a, b) => a - b);
    const nextDue = dues.length ? dues[0] : null;
    // Responsáveis = assignees distintos das tarefas (do ClickUp).
    const owners = Array.from(
      new Set(tasks.flatMap((t) => t.assignees)),
    );
    return NextResponse.json({
      ...base,
      linked: true,
      refType,
      listName: conv.clickup_ref_name ?? res.name,
      url: conv.clickup_url,
      tasks,
      nextDue,
      owners,
      statusesByList: res.statusesByList ?? {},
      lists: res.lists ?? [],
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST { conversationId, type, id, name, teamId } -> conecta (repetível)
export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const prof = await me(ctx.userId);
    if (!prof?.is_internal) {
      return NextResponse.json(
        { error: "Recurso exclusivo do time interno" },
        { status: 403 },
      );
    }
    const body = (await request.json().catch(() => ({}))) as {
      conversationId?: string;
      type?: string;
      id?: string;
      name?: string;
      teamId?: string;
    };
    const type = body.type === "folder" ? "folder" : body.type === "list" ? "list" : null;
    if (!body.conversationId || !type || !body.id) {
      return NextResponse.json(
        { error: "Faltou conversa ou alvo do ClickUp" },
        { status: 400 },
      );
    }
    // `id`/`teamId` viram parte de uma URL salva no banco (clickup_url) e
    // depois `href` de um <a target="_blank">. Só id numérico do ClickUp.
    if (!/^\d+$/.test(body.id)) {
      return NextResponse.json({ error: "Id de alvo inválido" }, { status: 400 });
    }
    if (body.teamId !== undefined && !/^\d+$/.test(body.teamId)) {
      return NextResponse.json({ error: "Id de time inválido" }, { status: 400 });
    }
    if (body.name !== undefined && body.name.length > 200) {
      return NextResponse.json({ error: "Nome muito longo" }, { status: 400 });
    }
    const conv = await convInAccount(body.conversationId, ctx.accountId);
    if (!conv) {
      return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });
    }
    // Valida o alvo com a chave do usuário antes de salvar.
    let resolvedName = body.name ?? null;
    if (prof.clickup_api_key) {
      const check = await getTargetWithTasks(
        decrypt(prof.clickup_api_key),
        type,
        body.id,
      );
      if (!check.ok) {
        return NextResponse.json(
          { error: check.error ?? "Não foi possível ler esse item do ClickUp" },
          { status: 400 },
        );
      }
      resolvedName = resolvedName ?? check.name ?? null;
    }
    const url = body.teamId ? buildTargetUrl(type, body.id, body.teamId) : null;

    await supabaseAdmin()
      .from("conversations")
      .update({
        clickup_ref_type: type,
        clickup_ref_id: body.id,
        clickup_ref_name: resolvedName,
        clickup_url: url,
        // limpa o mapa antigo por link pra não conflitar na leitura
        clickup_list_id: null,
      })
      .eq("id", body.conversationId);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// DELETE ?conversationId=... -> desfaz o vínculo com o ClickUp (undo).
// Não mexe em saúde/responsável (campos do CRM), só na conexão.
export async function DELETE(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const prof = await me(ctx.userId);
    if (!prof?.is_internal) {
      return NextResponse.json(
        { error: "Recurso exclusivo do time interno" },
        { status: 403 },
      );
    }
    const conversationId =
      new URL(request.url).searchParams.get("conversationId") ?? "";
    const conv = conversationId
      ? await convInAccount(conversationId, ctx.accountId)
      : null;
    if (!conv) {
      return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });
    }
    await supabaseAdmin()
      .from("conversations")
      .update({
        clickup_ref_type: null,
        clickup_ref_id: null,
        clickup_ref_name: null,
        clickup_list_id: null,
        clickup_url: null,
      })
      .eq("id", conversationId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// PATCH { conversationId, health?, csOwner? } -> campos do CRM (modo OpenCRM)
const HEALTH_VALUES = ["estavel", "monitoramento", "churn"];

export async function PATCH(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const prof = await me(ctx.userId);
    if (!prof?.is_internal) {
      return NextResponse.json(
        { error: "Recurso exclusivo do time interno" },
        { status: 403 },
      );
    }
    const body = (await request.json().catch(() => ({}))) as {
      conversationId?: string;
      health?: string | null;
      csOwner?: string | null;
    };
    if (!body.conversationId) {
      return NextResponse.json({ error: "Faltou conversa" }, { status: 400 });
    }
    const conv = await convInAccount(body.conversationId, ctx.accountId);
    if (!conv) {
      return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });
    }

    const update: Record<string, unknown> = {};
    if (body.health !== undefined) {
      const h = body.health ? String(body.health) : null;
      if (h && !HEALTH_VALUES.includes(h)) {
        return NextResponse.json({ error: "Saúde inválida" }, { status: 400 });
      }
      update.health = h;
    }
    if (body.csOwner !== undefined) {
      const c = body.csOwner ? String(body.csOwner).trim() : null;
      if (c && c.length > 120) {
        return NextResponse.json({ error: "Nome do responsável muito longo" }, { status: 400 });
      }
      update.cs_owner = c || null;
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Nada pra atualizar" }, { status: 400 });
    }

    await supabaseAdmin()
      .from("conversations")
      .update(update)
      .eq("id", body.conversationId);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
