import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { attachToTask, createTask, getClickUpUser } from "@/lib/clickup/client";
import {
  ANEXOS_MAX,
  ANEXO_MAX_BYTES,
  bytesDeBase64,
  derivarTitulo,
  ehFeedbackKind,
  MENSAGEM_MAX,
  MENSAGEM_MIN,
  mimeAceito,
  montarCorpo,
  parseAssignees,
  partesDataUrl,
  prioridadeDe,
  type FeedbackContexto,
} from "@/lib/feedback/format";

// POST /api/feedback
//
// Recebe um relato do usuário e abre um chamado no ClickUp da NOSSA
// operação. A ordem das etapas é deliberada e está comentada abaixo.

/** Quantos relatos um usuário pode mandar por hora. */
const LIMITE_POR_HORA = 10;

/** Cache do id do dono do token, para não bater em /user a cada relato. */
let donoDoTokenCache: number[] | null = null;

/**
 * Quem será o responsável pela tarefa.
 *
 * Sem responsável a tarefa fica órfã na lista: no ClickUp quem cria não
 * vira responsável, então ela não aparece no "Assigned to me" de
 * ninguém e o chamado morre sem ser visto.
 *
 * Preferência para a env var; sem ela, o dono do token — que é sempre
 * alguém real da nossa equipe.
 */
async function resolverResponsaveis(token: string): Promise<number[]> {
  const daEnv = parseAssignees(process.env.CLICKUP_FEEDBACK_ASSIGNEE_ID);
  if (daEnv.length > 0) return daEnv;

  if (donoDoTokenCache) return donoDoTokenCache;
  const res = await getClickUpUser(token);
  const id = res.user?.id;
  donoDoTokenCache = typeof id === "number" && id > 0 ? [id] : [];
  return donoDoTokenCache;
}

export async function POST(request: Request) {
  try {
    // 1. AUTENTICA. Anônimo não passa — o relato precisa de autor, e a
    //    tarefa sem "quem relatou" não dá para responder.
    const ctx = await getCurrentAccount();

    const body = (await request.json().catch(() => ({}))) as {
      kind?: unknown;
      mensagem?: unknown;
      contexto?: unknown;
      anexos?: unknown;
    };

    // 2. VALIDA.
    if (!ehFeedbackKind(body.kind)) {
      return NextResponse.json({ error: "Tipo inválido." }, { status: 400 });
    }
    const mensagem = typeof body.mensagem === "string" ? body.mensagem.trim() : "";
    if (mensagem.length < MENSAGEM_MIN) {
      return NextResponse.json(
        { error: `Escreva ao menos ${MENSAGEM_MIN} caracteres.` },
        { status: 400 },
      );
    }
    if (mensagem.length > MENSAGEM_MAX) {
      return NextResponse.json(
        { error: `A mensagem passa de ${MENSAGEM_MAX} caracteres.` },
        { status: 400 },
      );
    }

    const anexosBrutos = Array.isArray(body.anexos) ? body.anexos : [];
    if (anexosBrutos.length > ANEXOS_MAX) {
      return NextResponse.json(
        { error: `No máximo ${ANEXOS_MAX} imagens.` },
        { status: 400 },
      );
    }

    const anexos: { nome: string; mime: string; bytes: Uint8Array }[] = [];
    for (const [i, bruto] of anexosBrutos.entries()) {
      const item = bruto as { nome?: unknown; dataUrl?: unknown };
      if (typeof item?.dataUrl !== "string") {
        return NextResponse.json({ error: "Anexo inválido." }, { status: 400 });
      }
      const partes = partesDataUrl(item.dataUrl);
      if (!partes) {
        return NextResponse.json({ error: "Anexo inválido." }, { status: 400 });
      }
      // SVG é recusado dentro de `mimeAceito` — é XML executável, e o
      // anexo será aberto por quem for atender o chamado.
      if (!mimeAceito(partes.mime)) {
        return NextResponse.json(
          { error: "Só imagens PNG, JPG, WebP ou GIF." },
          { status: 400 },
        );
      }
      // Mede os BYTES reais, não o tamanho da string: base64 infla ~33%
      // e recusaria arquivos legítimos.
      if (bytesDeBase64(partes.base64) > ANEXO_MAX_BYTES) {
        return NextResponse.json(
          { error: "Cada imagem precisa ter até 5 MB." },
          { status: 400 },
        );
      }
      anexos.push({
        nome:
          typeof item.nome === "string" && item.nome.trim()
            ? item.nome.trim().slice(0, 80)
            : `print-${i + 1}.png`,
        mime: partes.mime.split(";")[0].trim().toLowerCase(),
        bytes: Buffer.from(partes.base64, "base64"),
      });
    }

    const admin = supabaseAdmin();

    // 3. RATE LIMIT pelo histórico gravado — não por memória do
    //    processo, que zera a cada deploy e não vale entre instâncias.
    const umaHoraAtras = new Date(Date.now() - 3_600_000).toISOString();
    const { count: recentes } = await admin
      .from("feedback_reports")
      .select("id", { count: "exact", head: true })
      .eq("user_id", ctx.userId)
      .gte("created_at", umaHoraAtras);
    if ((recentes ?? 0) >= LIMITE_POR_HORA) {
      return NextResponse.json(
        { error: "Você enviou muitos relatos na última hora. Tente mais tarde." },
        { status: 429 },
      );
    }

    const contexto = (
      body.contexto && typeof body.contexto === "object" ? body.contexto : {}
    ) as FeedbackContexto;
    const titulo = derivarTitulo(body.kind, mensagem);

    // 4. GRAVA ANTES de falar com o ClickUp, com status 'failed'.
    //    Se a API estiver fora, o texto de quem escreveu não se perde e
    //    dá para reprocessar depois. O inverso — criar a tarefa e falhar
    //    ao gravar — perderia o rastro do nosso lado.
    const { data: relato, error: insErr } = await admin
      .from("feedback_reports")
      .insert({
        user_id: ctx.userId,
        account_id: ctx.accountId,
        kind: body.kind,
        title: titulo,
        message: mensagem,
        context: contexto,
        attachments: anexos.length,
        status: "failed",
      })
      .select("id")
      .single();
    if (insErr || !relato) {
      console.error("[feedback] falha ao gravar:", insErr?.message);
      return NextResponse.json(
        { error: "Não foi possível registrar seu relato." },
        { status: 500 },
      );
    }

    const token = process.env.CLICKUP_FEEDBACK_TOKEN;
    const listId = process.env.CLICKUP_FEEDBACK_LIST_ID;

    // Configuração NOSSA faltando não vira erro na cara de quem está
    // usando o app: o relato já está salvo, então respondemos sucesso e
    // deixamos o motivo registrado para nós.
    if (!token || !listId) {
      await admin
        .from("feedback_reports")
        .update({ error: "CLICKUP_FEEDBACK_TOKEN/LIST_ID ausente" })
        .eq("id", relato.id);
      console.error(
        "[feedback] recebido mas NAO enviado: CLICKUP_FEEDBACK_TOKEN ou CLICKUP_FEEDBACK_LIST_ID ausente",
      );
      return NextResponse.json({ ok: true });
    }

    // Nome e e-mail vêm do servidor, não do cliente: quem relata não
    // escolhe de quem é o relato.
    const { data: perfil } = await admin
      .from("profiles")
      .select("full_name, email")
      .eq("user_id", ctx.userId)
      .maybeSingle();

    const corpo = montarCorpo(
      mensagem,
      {
        nome: perfil?.full_name ?? null,
        email: perfil?.email ?? null,
        conta: ctx.account?.name ?? null,
      },
      contexto,
    );

    // 5. CRIA A TAREFA.
    const criada = await createTask(token, listId, {
      name: titulo,
      markdownContent: corpo,
      assignees: await resolverResponsaveis(token),
      priority: prioridadeDe(body.kind),
      tags: ["OpenCRM-crm", body.kind],
    });

    if (!criada.ok || !criada.task) {
      await admin
        .from("feedback_reports")
        .update({ error: criada.error ?? "erro ao criar tarefa" })
        .eq("id", relato.id);
      console.error("[feedback] ClickUp recusou:", criada.error);
      // Ainda assim é sucesso para quem enviou: o relato está guardado.
      return NextResponse.json({ ok: true });
    }

    await admin
      .from("feedback_reports")
      .update({
        status: "sent",
        task_id: criada.task.id,
        task_url: criada.task.url ?? null,
        error: null,
      })
      .eq("id", relato.id);

    // 6. ANEXA OS PRINTS. Falha aqui NÃO invalida o chamado — a tarefa
    //    já existe com o texto, que é a parte insubstituível.
    for (const arquivo of anexos) {
      const r = await attachToTask(token, criada.task.id, arquivo);
      if (!r.ok) console.error("[feedback] anexo falhou:", r.error);
    }

    return NextResponse.json({ ok: true, taskUrl: criada.task.url ?? null });
  } catch (err) {
    return toErrorResponse(err);
  }
}
