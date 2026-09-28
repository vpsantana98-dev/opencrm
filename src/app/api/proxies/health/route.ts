import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { findProxy, isEvolutionConfigured } from "@/lib/whatsapp/evolution-api";
import {
  checkProxyExitIp,
  type ProxyCheckResult,
} from "@/lib/whatsapp/proxy-check";
import { loadProxyConfig } from "@/lib/whatsapp/proxy-pool";

/**
 * Checa cada proxy do pool. Protegida por segredo compartilhado no
 * header `x-cron-secret`, mesmo padrão de /api/automations/cron.
 *
 * Escada de degradação:
 *   3 falhas seguidas  -> degraded  (não recebe instância nova)
 *   10 falhas seguidas -> disabled  (sai do pool)
 * Um sucesso zera o contador e reativa, EXCETO quando o `degraded` foi
 * posto à mão pelo platform admin (contador zerado): esse é decisão
 * humana e sobrevive ao cron. Ver o comentário no ramo de sucesso.
 *
 * Vazamento: se o IP de saída for igual ao da VPS, o proxy não está
 * sendo aplicado. Marca disabled na hora, independente do contador.
 *
 * A detecção de vazamento só funciona se `VPS_PUBLIC_IP` estiver
 * setada. Se não estiver, a rota ainda checa a saúde normalmente, mas
 * loga um `console.warn` a cada execução e devolve
 * `leakDetectionEnabled: false` na resposta, para o problema ficar
 * visível em vez de silenciosamente desligado.
 *
 * Falha universal: se TODAS as checagens falharem e houver mais de um
 * proxy, a execução é descartada sem incrementar contador nenhum. Ver o
 * comentário da fase 2.
 *
 * Depois da varredura por proxy, roda a varredura POR INSTÂNCIA. As
 * duas respondem perguntas diferentes e nenhuma substitui a outra: ver
 * o comentário de `checkInstances` no fim do arquivo.
 */
const DEGRADE_AT = 3;
const DISABLE_AT = 10;

export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "cron not configured" }, { status: 503 });
  }
  const supplied = Buffer.from(request.headers.get("x-cron-secret") ?? "");
  const expectedBuffer = Buffer.from(expected);
  if (
    supplied.length !== expectedBuffer.length ||
    !timingSafeEqual(supplied, expectedBuffer)
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // .trim(): a variável é preenchida por humano na aba Ambiente do
  // Easypanel, e o `exitIp` do echo já vem trimado (proxy-check.ts).
  // Sem o trim aqui, um espaço ou quebra de linha no fim faz a env
  // "parecer configurada" (continua truthy) mas a comparação `===`
  // nunca bate, desligando a detecção de vazamento em silêncio.
  const vpsIp = (process.env.VPS_PUBLIC_IP ?? "").trim();
  const leakDetectionEnabled = vpsIp.length > 0;
  if (!leakDetectionEnabled) {
    console.warn(
      "[proxies/health] VPS_PUBLIC_IP não configurada: deteccao de vazamento de IP esta DESLIGADA nesta execucao.",
    );
  }
  const admin = supabaseAdmin();

  const { data: proxies, error } = await admin
    .from("proxies")
    .select("id, status, consecutive_failures")
    .neq("status", "disabled");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (proxies ?? []) as ProxyHealthRow[];

  // FASE 1: checa todo mundo sem gravar nada. A separação existe para a
  // decisão da fase 2, que só pode ser tomada com o resultado da
  // execução inteira em mãos.
  const results: Array<{ row: ProxyHealthRow; result: ProxyCheckResult }> = [];
  for (const row of rows) {
    let result: ProxyCheckResult;
    try {
      const config = await loadProxyConfig(admin, row.id);
      result = await checkProxyExitIp(config);
    } catch (err) {
      result = {
        ok: false,
        exitIp: null,
        latencyMs: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    results.push({ row, result });
  }

  const checked = results.length;

  // FASE 2: falha universal é sinal de problema do próprio checador, não
  // dos proxies.
  //
  // `checkProxyExitIp` depende de um echo de IP único (api.ipify.org).
  // Se ele cair ou aplicar rate limit, TODOS os proxies falham em todo
  // tick. A 15 minutos e com o limiar de 10 falhas, o pool inteiro fica
  // `disabled` em duas horas e meia; daí ninguém conecta, e proxy
  // `disabled` sai da varredura, então nada se recupera sem PATCH manual
  // um a um.
  //
  // Mitigação barata: se TODAS as checagens da execução falharam e havia
  // mais de um proxy, a execução é descartada e nenhum contador é
  // incrementado. Com um proxy só não dá para distinguir "o checador
  // quebrou" de "o único proxy caiu", e aí o mais seguro é acreditar na
  // falha. A lista de echos alternativos fica para depois; isto só evita
  // o modo de falha catastrófico.
  const checksDiscarded = checked > 1 && results.every((r) => !r.result.ok);
  if (checksDiscarded) {
    console.error(
      `[proxies/health] EXECUCAO DESCARTADA: todas as ${checked} checagens falharam. Falha universal indica problema do checador (echo de IP fora do ar ou rate limit), nao dos proxies. Nenhum contador foi incrementado. Primeiro erro: ${results[0].result.error ?? "sem detalhe"}`,
    );
  }

  let leaking = 0;
  /** Proxies que o operador marcou como `degraded` e o cron preservou. */
  let degradedPreserved = 0;

  // FASE 3: aplica o resultado, a menos que a execução tenha sido
  // descartada.
  for (const { row, result } of checksDiscarded ? [] : results) {
    // Vazamento: o tráfego está saindo pela VPS, não pelo proxy.
    // .trim() dos dois lados por defesa: `vpsIp` já vem trimado acima,
    // e `result.exitIp` já vem trimado de checkProxyExitIp, mas a
    // comparação não deve depender de nenhuma das duas origens manter
    // essa garantia para sempre.
    if (result.ok && vpsIp && result.exitIp?.trim() === vpsIp) {
      leaking++;
      await admin
        .from("proxies")
        .update({
          status: "disabled",
          last_check_at: new Date().toISOString(),
          last_exit_ip: result.exitIp,
          last_latency_ms: result.latencyMs,
        })
        .eq("id", row.id);
      console.error(
        `[proxies/health] VAZAMENTO: proxy ${row.id} saiu pelo IP da VPS (${result.exitIp}). Desativado.`,
      );
      continue;
    }

    if (result.ok) {
      // `degraded` com contador ZERADO é decisão humana, não resultado
      // da escada de falhas: o platform admin marcou o proxy pelo PATCH
      // de /api/proxies/[id] para drenar sem desligar (o provedor
      // avisou que aquele IP está flagged, por exemplo). Um check
      // bem-sucedido não pode desfazer isso em silêncio, senão o proxy
      // volta para `active` no próximo tick e passa a receber instância
      // nova. Só o `degraded` que veio do contador (>0) é limpo por
      // sucesso.
      const degradadoPeloOperador =
        row.status === "degraded" && row.consecutive_failures === 0;
      if (degradadoPeloOperador) degradedPreserved++;

      await admin
        .from("proxies")
        .update({
          ...(degradadoPeloOperador ? {} : { status: "active" }),
          consecutive_failures: 0,
          last_check_at: new Date().toISOString(),
          last_exit_ip: result.exitIp,
          last_latency_ms: result.latencyMs,
        })
        .eq("id", row.id);
      continue;
    }

    const failures = row.consecutive_failures + 1;
    const status =
      failures >= DISABLE_AT
        ? "disabled"
        : failures >= DEGRADE_AT
          ? "degraded"
          : row.status;

    await admin
      .from("proxies")
      .update({
        status,
        consecutive_failures: failures,
        last_check_at: new Date().toISOString(),
        last_latency_ms: result.latencyMs,
      })
      .eq("id", row.id);

    console.warn(
      `[proxies/health] proxy ${row.id} falhou (${failures}x): ${result.error ?? "sem detalhe"}`,
    );
  }

  const instances = await checkInstances(admin);

  return NextResponse.json({
    checked,
    leaking,
    degradedPreserved,
    checksDiscarded,
    leakDetectionEnabled,
    ...instances,
  });
}

interface ProxyHealthRow {
  id: string;
  status: string;
  consecutive_failures: number;
}

interface InstanceScan {
  /** Instâncias com `status = 'connected'` no CRM. */
  instancesConnected: number;
  /** Delas, as que não têm proxy vinculado no CRM. */
  instancesWithoutProxy: number;
  /** Delas, as que têm vínculo no CRM mas a Evolution não confirma. */
  instancesProxyMismatch: number;
  /** false quando a Evolution não está configurada e o /proxy/find não roda. */
  instanceProxyCheckEnabled: boolean;
}

/**
 * Varredura POR INSTÂNCIA, que é o que a spec de fato pede como teste de
 * aceite da camada de rede: "para cada instância conectada, o IP de
 * saída tem que ser diferente do IP da VPS", nomeando o modo de falha
 * "se um proxy cair e a Evolution fizer fallback para conexão direta".
 *
 * A varredura por proxy acima NÃO cobre esse cenário. Ela só compara o
 * IP quando `result.ok` é verdadeiro; se o proxy caiu, `checkProxyExitIp`
 * devolve `ok: false` e a comparação nunca roda. Ou seja, o modo de
 * falha que a spec nomeia era estruturalmente invisível ao detector. O
 * que aquela varredura pega é erro de cadastro (o proxy cadastrado ser a
 * própria VPS), que é útil, mas é outra coisa.
 *
 * Dois sinais aqui, e os dois valem por si:
 *
 * 1. `proxy_id IS NULL` numa instância conectada: o CRM não conhece
 *    proxy nenhum para um número que está servindo agora. É a situação
 *    de TODA a frota conectada antes desta branch: implantar não muda
 *    nada para quem já está conectado, até reescanear o QR, e isso não
 *    era visível em lugar nenhum.
 * 2. `GET /proxy/find/{instance}`: confirma do lado da Evolution que o
 *    proxy está aplicado, e não apenas vinculado no CRM. É a checagem
 *    que a spec (seção 12) exige contra a versão implantada ignorar em
 *    silêncio os campos de proxy da criação.
 *
 * Tudo é só relatório: nada aqui desativa proxy nem mexe em instância.
 * Remanejar cliente conectado é decisão de operação, não de cron.
 */
async function checkInstances(
  admin: ReturnType<typeof supabaseAdmin>,
): Promise<InstanceScan> {
  const instanceProxyCheckEnabled = isEvolutionConfigured();
  if (!instanceProxyCheckEnabled) {
    console.warn(
      "[proxies/health] Evolution nao configurada: a confirmacao por instancia (GET /proxy/find) esta DESLIGADA nesta execucao.",
    );
  }

  const { data, error } = await admin
    .from("evolution_instances")
    .select("account_id, instance_name, proxy_id")
    .eq("status", "connected");

  if (error) {
    console.error(
      "[proxies/health] falha ao listar as instancias conectadas:",
      error.message,
    );
    return {
      instancesConnected: 0,
      instancesWithoutProxy: 0,
      instancesProxyMismatch: 0,
      instanceProxyCheckEnabled,
    };
  }

  const rows = (data ?? []) as {
    account_id: string;
    instance_name: string;
    proxy_id: string | null;
  }[];

  let instancesWithoutProxy = 0;
  let instancesProxyMismatch = 0;

  for (const inst of rows) {
    if (!inst.proxy_id) {
      instancesWithoutProxy++;
      console.error(
        `[proxies/health] SEM PROXY: a instancia ${inst.instance_name} (conta ${inst.account_id}) esta conectada e nao tem proxy vinculado no CRM. Ela sai pelo IP da VPS ate reconectar pelo QR.`,
      );
      continue;
    }
    if (!instanceProxyCheckEnabled) continue;

    try {
      const status = await findProxy(inst.instance_name);
      if (!status.configured) {
        instancesProxyMismatch++;
        console.error(
          `[proxies/health] DIVERGENCIA: a instancia ${inst.instance_name} tem o proxy ${inst.proxy_id} vinculado no CRM, mas a Evolution nao reporta proxy aplicado.`,
        );
      }
    } catch (err) {
      // Não confirmar conta como divergência: o ponto da varredura é
      // não deixar instância nenhuma passar por confirmada sem ter sido.
      instancesProxyMismatch++;
      console.error(
        `[proxies/health] DIVERGENCIA: nao foi possivel confirmar o proxy da instancia ${inst.instance_name} na Evolution:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return {
    instancesConnected: rows.length,
    instancesWithoutProxy,
    instancesProxyMismatch,
    instanceProxyCheckEnabled,
  };
}
