import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { listarInstancias } from "@/lib/whatsapp/instances";
import { resolveConfiguredBaseUrl } from "@/lib/http/base-url";
import {
  isEvolutionConfigured,
  setSafeInstanceSettings,
  setInstanceWebhook,
} from "@/lib/whatsapp/evolution-api";

/** Reaplica o webhook sem desconectar nem recriar a sessão do WhatsApp. */
export async function POST() {
  try {
    const ctx = await requireRole("admin");
    if (!isEvolutionConfigured()) {
      return NextResponse.json(
        { error: "Evolution não configurada no servidor" },
        { status: 503 },
      );
    }

    const secret = process.env.EVOLUTION_WEBHOOK_SECRET?.trim();
    const baseUrl = resolveConfiguredBaseUrl();
    if (!secret || !baseUrl) {
      return NextResponse.json(
        { error: "Webhook da Evolution não configurado no servidor" },
        { status: 503 },
      );
    }

    // Repara TODOS os números do cliente, não só um.
    //
    // "Reparar sincronização" é a ação de conserto geral: consertar
    // apenas um número deixaria os outros quebrados em silêncio, e a
    // pessoa não teria como saber que precisava repetir. Antes isto
    // usava `.maybeSingle()` por conta, que erraria com vários.
    const instancias = await listarInstancias(ctx.supabase, ctx.accountId);
    if (instancias.length === 0) {
      return NextResponse.json(
        { error: "Esta conta ainda não possui uma instância Evolution" },
        { status: 404 },
      );
    }

    const webhookUrl = `${baseUrl}/api/whatsapp/evolution/webhook/${secret}`;
    const resultados = await Promise.all(
      instancias.map(async (inst) => {
        try {
          await setSafeInstanceSettings(inst.instance_name);
          await setInstanceWebhook(inst.instance_name, webhookUrl);
          return { id: inst.id, ok: true as const };
        } catch (err) {
          // Um número que falha não impede os outros de serem
          // consertados — mas a resposta diz quantos ficaram de fora,
          // senão o usuário acha que consertou tudo.
          console.error(
            `[evolution/repair] falhou em ${inst.instance_name}:`,
            err instanceof Error ? err.message : err,
          );
          return { id: inst.id, ok: false as const };
        }
      }),
    );

    const reparados = resultados.filter((r) => r.ok).length;
    return NextResponse.json({
      ok: reparados > 0,
      reparados,
      total: instancias.length,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
