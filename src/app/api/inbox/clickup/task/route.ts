import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { decrypt } from "@/lib/whatsapp/encryption";
import { createTask, updateTaskStatus } from "@/lib/clickup/client";

// Escrita no ClickUp a partir do inbox (modo OpenCRM): criar tarefa e mudar
// status sem sair do CRM. Mesmo gate/validação de posse do route.ts
// principal; usa a chave ClickUp do PRÓPRIO usuário que está agindo.

const NAME_MAX = 200;
// Id de tarefa do ClickUp: numérico por padrão, mas alfanumérico/hífen
// quando o workspace usa Custom Task IDs — não restringe a dígito.
const TASK_ID_RE = /^[\w-]{1,60}$/;

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
    .select("id, account_id, clickup_ref_type, clickup_ref_id, clickup_list_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!data || data.account_id !== accountId) return null;
  return data as {
    id: string;
    clickup_ref_type: string | null;
    clickup_ref_id: string | null;
    clickup_list_id: string | null;
  };
}

/** Alvo do ClickUp da conversa, mesma regra de fallback do route.ts principal. */
function targetOf(conv: {
  clickup_ref_type: string | null;
  clickup_ref_id: string | null;
  clickup_list_id: string | null;
}) {
  const refType = (conv.clickup_ref_type ??
    (conv.clickup_list_id ? "list" : null)) as "folder" | "list" | null;
  const refId = conv.clickup_ref_id ?? conv.clickup_list_id ?? null;
  return { refType, refId };
}

// POST { conversationId, name, description?, listId? } -> cria tarefa.
// `listId` só é exigido quando o alvo da conversa é uma Pasta (Pasta em
// si não recebe tarefa; precisa escolher a Lista dentro dela).
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
    if (!prof.clickup_api_key) {
      return NextResponse.json({ error: "Conecte seu ClickUp primeiro" }, { status: 400 });
    }
    const body = (await request.json().catch(() => ({}))) as {
      conversationId?: string;
      name?: string;
      description?: string;
      listId?: string;
    };
    const name = (body.name ?? "").trim();
    if (!body.conversationId || !name) {
      return NextResponse.json(
        { error: "Faltou conversa ou título da tarefa" },
        { status: 400 },
      );
    }
    if (name.length > NAME_MAX) {
      return NextResponse.json({ error: "Título muito longo" }, { status: 400 });
    }
    if (body.listId !== undefined && !/^\d+$/.test(body.listId)) {
      return NextResponse.json({ error: "Id de lista inválido" }, { status: 400 });
    }
    const conv = await convInAccount(body.conversationId, ctx.accountId);
    if (!conv) {
      return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });
    }
    const { refType, refId } = targetOf(conv);
    if (!refType || !refId) {
      return NextResponse.json(
        { error: "Conversa não está conectada ao ClickUp" },
        { status: 400 },
      );
    }

    let listId: string;
    if (refType === "list") {
      listId = refId;
    } else {
      if (!body.listId) {
        return NextResponse.json(
          { error: "Escolha em qual lista da pasta a tarefa deve entrar" },
          { status: 400 },
        );
      }
      listId = body.listId;
    }

    const res = await createTask(decrypt(prof.clickup_api_key), listId, {
      name,
      description: body.description,
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: res.error ?? "Não foi possível criar a tarefa" },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, task: res.task });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// PATCH { conversationId, taskId, status } -> muda o status de uma tarefa.
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
    if (!prof.clickup_api_key) {
      return NextResponse.json({ error: "Conecte seu ClickUp primeiro" }, { status: 400 });
    }
    const body = (await request.json().catch(() => ({}))) as {
      conversationId?: string;
      taskId?: string;
      status?: string;
    };
    const status = (body.status ?? "").trim();
    if (!body.conversationId || !body.taskId || !status) {
      return NextResponse.json(
        { error: "Faltou conversa, tarefa ou status" },
        { status: 400 },
      );
    }
    if (!TASK_ID_RE.test(body.taskId)) {
      return NextResponse.json({ error: "Id de tarefa inválido" }, { status: 400 });
    }
    const conv = await convInAccount(body.conversationId, ctx.accountId);
    if (!conv) {
      return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });
    }
    const { refType, refId } = targetOf(conv);
    if (!refType || !refId) {
      return NextResponse.json(
        { error: "Conversa não está conectada ao ClickUp" },
        { status: 400 },
      );
    }

    const res = await updateTaskStatus(decrypt(prof.clickup_api_key), body.taskId, status);
    if (!res.ok) {
      return NextResponse.json(
        { error: res.error ?? "Não foi possível mudar o status" },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
