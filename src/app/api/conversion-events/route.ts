import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";

// GET /api/conversion-events?provider=&status=&q=&page=
//
// Histórico de eventos de conversão enviados para Meta (CAPI) e Google
// Ads. Meta e Google dividem a MESMA tabela (`meta_conversion_events`),
// separados pela coluna `provider` — a 045 reusou a tabela da 040 em vez
// de criar outra.
//
// Os painéis de config já mostravam os 10 últimos; esta rota é o
// histórico completo, com filtro e paginação, para responder "o evento
// daquele lead saiu?" sem abrir o Gerenciador de Eventos da Meta.
//
// Usa o cliente do usuário: a policy `meta_conversion_events_select`
// (in_active_account) já limita à conta ativa. O filtro por account_id
// fica como cinto e suspensório.

const PAGE_SIZE = 50;

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const sp = new URL(request.url).searchParams;

    const provider = sp.get("provider"); // 'meta' | 'google' | null (todos)
    const status = sp.get("status"); // 'sent' | 'failed' | null (todos)
    const q = (sp.get("q") ?? "").trim();
    const page = Math.max(0, Number(sp.get("page") ?? 0) || 0);

    let query = ctx.supabase
      .from("meta_conversion_events")
      .select("id, event_name, event_id, provider, status, error, created_at", {
        count: "exact",
      })
      .eq("account_id", ctx.accountId);

    if (provider === "meta" || provider === "google") {
      query = query.eq("provider", provider);
    }
    if (status === "sent" || status === "failed") {
      query = query.eq("status", status);
    }
    if (q.length >= 2) {
      // `event_id` é o id estável usado para dedupe na Meta
      // (lead_<contato>, purchase_<negócio>), então buscar por ele é
      // como o operador rastreia um lead específico.
      const termo = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      query = query.or(`event_name.ilike.${termo},event_id.ilike.${termo}`);
    }

    const from = page * PAGE_SIZE;
    const { data, count, error } = await query
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error("[conversion-events] erro:", error.message);
      return NextResponse.json(
        { error: "Não foi possível carregar os eventos." },
        { status: 500 },
      );
    }

    // Resumo do período carregado — responde "está saindo?" de relance,
    // sem o usuário ter que contar linha na tabela.
    const { count: totalEnviados } = await ctx.supabase
      .from("meta_conversion_events")
      .select("id", { count: "exact", head: true })
      .eq("account_id", ctx.accountId)
      .eq("status", "sent");
    const { count: totalFalhas } = await ctx.supabase
      .from("meta_conversion_events")
      .select("id", { count: "exact", head: true })
      .eq("account_id", ctx.accountId)
      .eq("status", "failed");

    return NextResponse.json({
      events: data ?? [],
      total: count ?? 0,
      page,
      pageSize: PAGE_SIZE,
      resumo: { enviados: totalEnviados ?? 0, falhas: totalFalhas ?? 0 },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
