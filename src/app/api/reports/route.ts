import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { canManageMembers } from "@/lib/auth/roles";
import { loadAgentReport } from "@/lib/reports/queries";
import { bundleParaCSV } from "@/lib/reports/csv";

// GET /api/reports?from=<ISO>&to=<ISO>&format=json|csv
//
// Desempenho por atendente no período. O CSV sai desta MESMA rota, e
// não de uma própria, de propósito: os dois formatos passam pelo mesmo
// `loadAgentReport`, então a planilha que o usuário baixa não tem como
// discordar da tabela que ele acabou de ver na tela.
//
// As datas chegam prontas do cliente (ISO completo), porque "os últimos
// 30 dias" depende do fuso de QUEM está olhando — calcular isso no
// servidor daria um recorte diferente do que a tela mostra.

/** Teto do intervalo. Acima disso a leitura de mensagens estoura o
 *  limite de páginas e o relatório viraria amostra sem avisar. */
const MAX_DIAS = 366;

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const sp = new URL(request.url).searchParams;

    const fromRaw = sp.get("from");
    const toRaw = sp.get("to");
    if (!fromRaw || !toRaw) {
      return NextResponse.json(
        { error: "Informe o período (from e to)." },
        { status: 400 },
      );
    }

    const from = new Date(fromRaw);
    const to = new Date(toRaw);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return NextResponse.json({ error: "Período inválido." }, { status: 400 });
    }
    if (from > to) {
      return NextResponse.json(
        { error: "A data inicial não pode ser depois da final." },
        { status: 400 },
      );
    }
    const dias = (to.getTime() - from.getTime()) / 86_400_000;
    if (dias > MAX_DIAS) {
      return NextResponse.json(
        { error: `O período máximo é de ${MAX_DIAS} dias.` },
        { status: 400 },
      );
    }

    let bundle;
    try {
      bundle = await loadAgentReport(
        ctx.supabase,
        ctx.accountId,
        from.toISOString(),
        to.toISOString(),
        // Mesma regra da tela de Equipe: e-mail só para quem administra.
        { incluirEmails: canManageMembers(ctx.role) },
      );
    } catch (err) {
      // A leitura de mensagens usa um join embutido (`conversations!inner`)
      // para separar as contas. Quando o cache de schema do PostgREST está
      // velho — o que acontece logo depois de uma migration — ele não
      // resolve a relação e devolve PGRST200. É transitório e se resolve
      // sozinho, então vale dizer isso em vez de "erro ao carregar", que
      // manda o usuário procurar defeito onde não tem.
      const code = (err as { code?: string } | null)?.code;
      if (code === "PGRST200") {
        console.error("[reports] schema cache desatualizado:", err);
        return NextResponse.json(
          {
            error:
              "O banco está recarregando o esquema. Tente de novo em alguns segundos.",
          },
          { status: 503 },
        );
      }
      throw err;
    }

    if (sp.get("format") === "csv") {
      const dia = (d: Date) => d.toISOString().slice(0, 10);
      return new NextResponse(bundleParaCSV(bundle), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="relatorio-atendentes-${dia(from)}-a-${dia(to)}.csv"`,
          // Relatório é dado vivo: sem isto, voltar na tela e baixar de
          // novo poderia servir a versão em cache do período anterior.
          "Cache-Control": "no-store",
        },
      });
    }

    return NextResponse.json(bundle);
  } catch (err) {
    return toErrorResponse(err);
  }
}
