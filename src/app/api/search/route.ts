import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";

// GET /api/search?q=...
// Busca global do header: contatos, conversas e clientes da agência.
//
// Usa o cliente do USUÁRIO (`ctx.supabase`), não o service role: assim o
// RLS continua sendo a rede de proteção mesmo que um filtro escape aqui.
// Ainda assim filtramos por `account_id` explicitamente — cinto e
// suspensório, e é o que garante que a busca traga só a conta ATIVA
// (o RLS sozinho deixaria passar qualquer conta da qual o usuário é
// membro, o que confundiria quem opera vários clientes).

const LIMIT_POR_TIPO = 5;

export interface SearchHit {
  type: "contact" | "conversation" | "client";
  id: string;
  title: string;
  subtitle?: string;
  href: string;
}

/** Escapa os curingas do LIKE para o termo do usuário virar texto literal. */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const q = (new URL(request.url).searchParams.get("q") ?? "").trim();

    // 2 caracteres é o mínimo útil: com 1 a busca varre a base inteira e
    // devolve ruído.
    if (q.length < 2) return NextResponse.json({ hits: [] });

    const termo = `%${escapeLike(q)}%`;
    const hits: SearchHit[] = [];

    // --- Contatos (nome, telefone ou empresa) ---------------------
    // `is_group` fica de fora: grupo do WhatsApp não é um contato de
    // verdade (migration 048) e polui o resultado.
    const { data: contatos } = await ctx.supabase
      .from("contacts")
      .select("id, name, phone, company")
      .eq("account_id", ctx.accountId)
      .not("is_group", "is", true)
      .or(`name.ilike.${termo},phone.ilike.${termo},company.ilike.${termo}`)
      .limit(LIMIT_POR_TIPO);

    for (const c of contatos ?? []) {
      hits.push({
        type: "contact",
        id: c.id as string,
        title: (c.name as string) || (c.phone as string),
        subtitle: (c.company as string) || (c.phone as string),
        href: `/contacts?c=${c.id}`,
      });
    }

    // --- Conversas ------------------------------------------------
    // Busca pelos contatos JÁ encontrados acima, em vez de filtrar por
    // coluna de tabela relacionada: a sintaxe de `.or()` com
    // `referencedTable` é frágil e falha em silêncio se o embed mudar.
    // Como o contato é o que a pessoa digita ("conversa da Ana"), o
    // resultado é o mesmo com um caminho muito mais previsível.
    const idsContatos = (contatos ?? []).map((c) => c.id as string);
    if (idsContatos.length > 0) {
      const { data: conversas } = await ctx.supabase
        .from("conversations")
        .select("id, last_message_text, contact_id")
        .eq("account_id", ctx.accountId)
        .in("contact_id", idsContatos)
        .order("last_message_at", { ascending: false })
        .limit(LIMIT_POR_TIPO);

      const nomePorContato = new Map(
        (contatos ?? []).map((c) => [
          c.id as string,
          (c.name as string) || (c.phone as string),
        ]),
      );

      for (const conv of conversas ?? []) {
        hits.push({
          type: "conversation",
          id: conv.id as string,
          title: nomePorContato.get(conv.contact_id as string) ?? "Conversa",
          subtitle: (conv.last_message_text as string) ?? undefined,
          href: `/inbox?c=${conv.id}`,
        });
      }
    }

    // --- Clientes da agência --------------------------------------
    // Sem gate explícito de "login de cliente": o RLS de `accounts` já
    // limita às contas de que o usuário é membro, então um login de
    // cliente encontra no máximo a própria conta.
    const { data: clientes } = await ctx.supabase
      .from("accounts")
      .select("id, name")
      .ilike("name", termo)
      .limit(LIMIT_POR_TIPO);

    for (const a of clientes ?? []) {
      hits.push({
        type: "client",
        id: a.id as string,
        title: a.name as string,
        subtitle: "Cliente",
        href: `/clients`,
      });
    }

    return NextResponse.json({ hits });
  } catch (err) {
    return toErrorResponse(err);
  }
}
