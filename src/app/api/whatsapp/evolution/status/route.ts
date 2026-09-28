import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import {
  getConnectionState,
  getInstanceNumber,
  isEvolutionConfigured,
} from "@/lib/whatsapp/evolution-api";
import { captureInstancePhone } from "@/lib/whatsapp/capture-instance-phone";
import { escolherPadrao, listarInstancias } from "@/lib/whatsapp/instances";

// GET /api/whatsapp/evolution/status
//
// Estado dos números de WhatsApp do cliente ativo.
//
// Passou a lidar com VÁRIOS números. Duas coisas mudaram e as duas eram
// defeitos esperando o segundo número:
//
//  1. a leitura usava `.maybeSingle()` por `account_id`, que ERRA com
//     mais de uma linha;
//  2. a escrita do estado usava `.update().eq("account_id")`, que
//     gravaria o estado de UM número em TODOS — o número B apareceria
//     como caído só porque o A caiu.
//
// A resposta mantém os campos antigos (`connected`, `phone`, `state`)
// descrevendo o número PADRÃO, para quem já consome não quebrar, e
// acrescenta a lista completa.

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    if (!isEvolutionConfigured()) {
      return NextResponse.json({ configured: false, connected: false });
    }

    const instancias = await listarInstancias(ctx.supabase, ctx.accountId);
    if (instancias.length === 0) {
      return NextResponse.json({
        configured: true,
        exists: false,
        connected: false,
        instances: [],
      });
    }

    // Consulta o estado de todos em paralelo: em série, cinco números
    // com a Evolution lenta fariam o indicador do header demorar cinco
    // vezes mais para aparecer.
    const estados = await Promise.all(
      instancias.map(async (inst) => {
        const state = await getConnectionState(inst.instance_name).catch(
          () => null,
        );
        const connected = state === "open";
        const nextStatus = connected
          ? "connected"
          : state === "connecting"
            ? "connecting"
            : "disconnected";

        // Captura o número na primeira vez que o vemos conectado sem
        // telefone guardado (cobre conexões feitas antes deste recurso).
        let phone = inst.phone;
        if (connected && !phone) {
          phone = await getInstanceNumber(inst.instance_name).catch(() => null);
        }

        // Escreve por ID, nunca por conta: filtrar por `account_id` aqui
        // carimbaria o estado deste número em todos os outros.
        if (nextStatus !== inst.status || (connected && phone !== inst.phone)) {
          await ctx.supabase
            .from("evolution_instances")
            .update({ status: nextStatus, ...(phone ? { phone } : {}) })
            .eq("id", inst.id);
        }

        if (connected) {
          await captureInstancePhone(
            ctx.supabase,
            ctx.accountId,
            inst.instance_name,
          ).catch(() => null);
        }

        return { ...inst, status: nextStatus, phone, state, connected };
      }),
    );

    // `escolherPadrao` devolve o tipo base, sem os campos que
    // acabamos de calcular — reencontra na lista para manter `state` e
    // `connected`.
    const escolhido = escolherPadrao(estados);
    const padrao = estados.find((e) => e.id === escolhido?.id) ?? estados[0];
    const conectados = estados.filter((e) => e.connected).length;

    return NextResponse.json({
      configured: true,
      exists: true,
      // Campos antigos: descrevem o número padrão, que é o que o
      // indicador do header mostra.
      connected: padrao.connected,
      state: padrao.state,
      phone: padrao.connected ? padrao.phone : null,
      // Novos: permitem à interface dizer "2 de 3 no ar" em vez de
      // reduzir tudo a um sim/não que esconde o número caído.
      total: estados.length,
      conectados,
      instances: estados.map((e) => ({
        id: e.id,
        label: e.label,
        phone: e.phone,
        status: e.status,
        connected: e.connected,
        isDefault: e.is_default,
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
