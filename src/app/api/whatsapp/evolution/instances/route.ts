import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { listarInstancias } from "@/lib/whatsapp/instances";

// GET /api/whatsapp/evolution/instances
//
// Os números do cliente ativo, direto do banco.
//
// Existe separado do /status de propósito: aquele consulta a Evolution
// para cada número, o que é caro e lento. Quem só precisa saber COMO
// CHAMAR um número — o inbox, para mostrar por onde a conversa entrou —
// não pode pagar uma ida à Evolution a cada troca de conversa.
export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const instancias = await listarInstancias(ctx.supabase, ctx.accountId);
    return NextResponse.json({
      instances: instancias.map((i) => ({
        id: i.id,
        label: i.label,
        phone: i.phone,
        status: i.status,
        isDefault: i.is_default,
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
