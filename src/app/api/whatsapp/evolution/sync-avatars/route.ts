import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { syncEvolutionContactAvatars } from "@/lib/whatsapp/evolution-contact-avatar";
import { listarInstancias } from "@/lib/whatsapp/instances";

export async function POST() {
  try {
    const ctx = await getCurrentAccount();
    // Percorre TODOS os números conectados, em série.
    //
    // A foto de um contato só existe no número que fala com ele: quem
    // escreveu para o Comercial não é conhecido do Suporte. Olhar um
    // número só deixaria sem foto justamente os contatos do outro.
    // Cada passada preenche as que faltam, então o custo cai a cada
    // rodada em vez de dobrar.
    const instancias = (await listarInstancias(ctx.supabase, ctx.accountId))
      .filter((i) => i.status === "connected");
    if (instancias.length === 0) {
      return NextResponse.json({ checked: 0, updated: 0 });
    }

    const admin = supabaseAdmin();
    let checked = 0;
    let updated = 0;
    for (const inst of instancias) {
      // Em série e não em paralelo: são chamadas à Evolution por
      // contato, e disparar tudo de uma vez estoura o servidor dela.
      const parcial = await syncEvolutionContactAvatars(admin, {
        accountId: ctx.accountId,
        instanceName: inst.instance_name,
      });
      checked += parcial.checked;
      updated += parcial.updated;
    }
    return NextResponse.json({ checked, updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}
