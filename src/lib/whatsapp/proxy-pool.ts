/**
 * Camada de dados do pool de proxies.
 *
 * Carrega os candidatos, delega a escolha para `selectProxy` (puro),
 * grava o vínculo e devolve a config decifrada para a Evolution.
 *
 * SERVER-ONLY. Usa o cliente com service role, porque `proxies` tem
 * RLS fail-closed: nenhuma role de cliente enxerga a tabela.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { decrypt } from "@/lib/whatsapp/encryption";
import { selectProxy, type ProxyCandidate } from "@/lib/whatsapp/proxy-select";

export interface EvolutionProxyConfig {
  host: string;
  port: number;
  protocol: "http" | "socks5";
  username: string;
  password: string;
}

/**
 * Colunas de `proxies` seguras para sair do servidor.
 *
 * `password_encrypted` fica de fora de propósito: a senha nunca volta
 * ao cliente, nem mascarada. Vive aqui, e não em cada rota, para que
 * adicionar uma coluna sensível no futuro não exija lembrar de dois
 * lugares.
 */
export const PROXY_SAFE_COLUMNS =
  "id, label, kind, protocol, host, port, username, region, max_instances, status, consecutive_failures, last_check_at, last_exit_ip, last_latency_ms, created_at";

/**
 * Catálogo de falhas do pool: cada código carrega a mensagem que o
 * cliente vê e o status HTTP correspondente.
 *
 * A mensagem vem DAQUI, e não de um argumento livre do construtor, por
 * duas razões:
 *
 * 1. Segurança. A mensagem chega ao cliente verbatim, inclusive em
 *    `/api/whatsapp/evolution/connect-public`, que não exige login
 *    (basta o token do link de conexão). Interpolar o `error.message`
 *    do PostgREST ali entregava nome de tabela, de coluna e de
 *    constraint para quem só tem esse token. Com o catálogo não existe
 *    caminho de código capaz de montar uma mensagem com detalhe do
 *    banco: o construtor simplesmente não aceita texto.
 * 2. Dá ao `code` um leitor de verdade. Antes ele era cunhado em nove
 *    variações e ninguém lia nenhuma. Agora é ele que decide o que o
 *    cliente vê e com que status, e o tipo obriga quem criar um código
 *    novo a decidir as duas coisas.
 *
 * O detalhe do erro (a mensagem crua do banco) vai para o log do
 * servidor em `throwDbFailure`, nunca para a resposta.
 */
const PROXY_POOL_ERRORS = {
  proxy_instance_query_failed: {
    status: 500,
    message:
      "Falha ao consultar a instância desta conta. Tente novamente em alguns instantes.",
  },
  proxy_query_failed: {
    status: 500,
    message:
      "Falha ao consultar o pool de proxies. Tente novamente em alguns instantes.",
  },
  proxy_usage_query_failed: {
    status: 500,
    message:
      "Falha ao verificar a ocupação dos proxies. Tente novamente em alguns instantes.",
  },
  proxy_link_failed: {
    status: 500,
    message:
      "Falha ao vincular o proxy à instância. Tente novamente em alguns instantes.",
  },
  proxy_pool_empty: {
    status: 503,
    message:
      "Nenhum proxy ativo cadastrado. Cadastre um proxy antes de conectar um WhatsApp.",
  },
  proxy_pool_exhausted: {
    status: 503,
    message:
      "Todos os proxies estão na capacidade máxima. Adicione mais um IP ao pool antes de conectar este cliente.",
  },
  proxy_instance_not_found: {
    status: 404,
    message:
      "A instância da conta não existe no banco. Crie a instância antes de atribuir um proxy.",
  },
  proxy_not_found: {
    status: 404,
    message: "Proxy não encontrado no pool.",
  },
  proxy_config_undecryptable: {
    status: 500,
    message:
      "A senha do proxy não pôde ser decifrada. O proxy precisa ser recadastrado com uma senha válida.",
  },
} as const satisfies Record<string, { status: number; message: string }>;

export type ProxyPoolErrorCode = keyof typeof PROXY_POOL_ERRORS;

/** Falha tipada com código legível pela rota. */
export class ProxyPoolError extends Error {
  readonly code: ProxyPoolErrorCode;
  readonly status: number;
  constructor(code: ProxyPoolErrorCode) {
    super(PROXY_POOL_ERRORS[code].message);
    this.name = "ProxyPoolError";
    this.code = code;
    this.status = PROXY_POOL_ERRORS[code].status;
  }
}

/**
 * Loga o detalhe da falha do banco no servidor e lança o erro genérico.
 *
 * O `detail` é a mensagem crua do PostgREST: útil para diagnosticar,
 * mas nunca pode sair na resposta HTTP.
 */
function throwDbFailure(
  code: ProxyPoolErrorCode,
  detail: { message?: string } | null | undefined,
): never {
  console.error(`[proxy-pool] ${code}:`, detail?.message ?? detail ?? "sem detalhe");
  throw new ProxyPoolError(code);
}

interface ProxyRow {
  id: string;
  host: string;
  port: number;
  protocol: "http" | "socks5";
  username: string | null;
  password_encrypted: string | null;
  region: string | null;
  max_instances: number;
  status: "active" | "degraded" | "disabled";
}

/**
 * Transforma uma linha do banco em config, descriptografando a senha.
 *
 * Lança ProxyPoolError se a senha estiver corrompida e não puder ser
 * descriptografada. Isso garante que a config seja validada ANTES do
 * vínculo ser gravado no banco.
 */
function toConfig(row: ProxyRow): EvolutionProxyConfig {
  let password = "";
  if (row.password_encrypted) {
    try {
      password = decrypt(row.password_encrypted);
    } catch (err) {
      // Logar aqui distingue senha corrompida de rotação da
      // ENCRYPTION_KEY, que produzem o mesmo sintoma para o operador.
      console.error(
        `[proxy-pool] proxy_config_undecryptable: falha ao decifrar a senha do proxy ${row.id}:`,
        err,
      );
      throw new ProxyPoolError("proxy_config_undecryptable");
    }
  }

  return {
    host: row.host,
    port: row.port,
    protocol: row.protocol,
    username: row.username ?? "",
    password,
  };
}

/**
 * Escolhe um proxy com vaga, grava o vínculo em
 * `evolution_instances.proxy_id` e devolve a config decifrada.
 *
 * STICKY: se a conta já tem um proxy vinculado, e ele ainda está
 * `active` e com vaga, REUSA esse proxy em vez de rodar a seleção de
 * novo. Trocar o IP de saída de uma sessão de WhatsApp Web já pareada é,
 * por si só, sinal de risco no domínio anti-ban (o caminho 403/409 de
 * `createInstance` reaplicaria o novo IP numa sessão viva). Só migra
 * para outro proxy quando não há vínculo ainda, ou quando o proxy
 * vinculado ficou indisponível (inativo ou sem vaga) — nesses casos,
 * mudar de IP é inevitável de qualquer forma.
 *
 * Lança ProxyPoolError quando o pool está esgotado. Isso é
 * deliberado: sem proxy livre a instância NÃO deve ser criada. É
 * melhor a agência ver "sem IP disponível" do que um cliente conectar
 * em silêncio pelo IP da VPS.
 */
export async function assignProxy(
  db: SupabaseClient,
  accountId: string,
  phone?: string | null,
  /**
   * De QUAL número é este proxy.
   *
   * O vínculo é por número, não por cliente: a proteção antiban é ter
   * um IP por sessão de WhatsApp. Dois números do mesmo cliente saindo
   * pelo mesmo IP é exatamente o padrão que derruba número.
   *
   * Sem este argumento a busca cai no modo antigo (um número por
   * conta), que ERRA se a conta tiver mais de um — todo chamador real
   * passa o nome.
   */
  instanceName?: string | null,
): Promise<{ proxyId: string; config: EvolutionProxyConfig }> {
  // Proxy já vinculado a esta conta, se houver. Consultado ANTES da
  // seleção para decidir se é caso de reuso (sticky).
  let consultaAtual = db
    .from("evolution_instances")
    .select("proxy_id")
    .eq("account_id", accountId);
  if (instanceName) {
    consultaAtual = consultaAtual.eq("instance_name", instanceName);
  }
  const { data: currentInst, error: currentInstError } =
    await consultaAtual.maybeSingle();

  if (currentInstError) {
    throwDbFailure("proxy_instance_query_failed", currentInstError);
  }

  const currentProxyId =
    (currentInst?.proxy_id as string | null | undefined) ?? null;

  const { data: rows, error } = await db
    .from("proxies")
    .select(
      "id, host, port, protocol, username, password_encrypted, region, max_instances, status",
    )
    .eq("status", "active");

  if (error) {
    throwDbFailure("proxy_query_failed", error);
  }

  const proxyRows = (rows ?? []) as ProxyRow[];
  if (proxyRows.length === 0) {
    throw new ProxyPoolError("proxy_pool_empty");
  }

  // Carga atual por proxy, contando as instâncias já vinculadas.
  // Exclui a própria conta da contagem para não enviesar a escolha (ela
  // já ocupa uma vaga do proxy atual, se tiver um; não deve contar
  // como uma vaga extra de outra conta).
  const { data: usage, error: usageError } = await db
    .from("evolution_instances")
    .select("proxy_id")
    .not("proxy_id", "is", null)
    .neq("account_id", accountId);

  if (usageError) {
    throwDbFailure("proxy_usage_query_failed", usageError);
  }

  const counts = new Map<string, number>();
  for (const row of (usage ?? []) as { proxy_id: string }[]) {
    counts.set(row.proxy_id, (counts.get(row.proxy_id) ?? 0) + 1);
  }

  const candidates: ProxyCandidate[] = proxyRows.map((r) => ({
    id: r.id,
    region: r.region,
    maxInstances: r.max_instances,
    currentInstances: counts.get(r.id) ?? 0,
    status: r.status,
  }));

  // Sticky: `currentInstances` acima já exclui a própria conta (o
  // `.neq` da query de uso), então o mesmo limiar usado por
  // `hasCapacity` para uma escolha NOVA (currentInstances < maxInstances)
  // já responde corretamente "cabe também esta conta, que já está
  // nele?" — sem contar a conta duas vezes nem deixar de contá-la.
  if (currentProxyId) {
    const stuck = candidates.find((c) => c.id === currentProxyId);
    if (stuck && stuck.status === "active" && stuck.currentInstances < stuck.maxInstances) {
      const stuckRow = proxyRows.find((r) => r.id === currentProxyId)!;
      return { proxyId: currentProxyId, config: toConfig(stuckRow) };
    }
  }

  const picked = selectProxy(candidates, { phone });
  if (!picked) {
    throw new ProxyPoolError("proxy_pool_exhausted");
  }

  const row = proxyRows.find((r) => r.id === picked.id)!;

  // Valida a config (inclusive decrypt) ANTES de gravar o vínculo.
  // Assim, se a senha estiver corrompida, o vínculo nunca é gravado.
  const config = toConfig(row);

  // Grava o vínculo e valida que a instância existe.
  let vinculo = db
    .from("evolution_instances")
    .update({ proxy_id: picked.id })
    .eq("account_id", accountId);
  if (instanceName) {
    // Sem isto, vincular o proxy de um número o gravaria em TODOS os
    // números do cliente — e a vaga contada no pool ficaria errada.
    vinculo = vinculo.eq("instance_name", instanceName);
  }
  const { data: linkData, error: linkError } = await vinculo.select("id");

  if (linkError) {
    throwDbFailure("proxy_link_failed", linkError);
  }

  if (!linkData || linkData.length === 0) {
    throw new ProxyPoolError("proxy_instance_not_found");
  }

  return { proxyId: picked.id, config };
}

/**
 * Variante com fallback DELIBERADO e restrito: com o pool VAZIO
 * (nenhum proxy ativo cadastrado), devolve `config: null` para a
 * conexão seguir SEM proxy, em vez de recusar. Decisão de produto
 * registrada em docs/superpowers/specs/2026-08-03-proxy-fallback-
 * pool-vazio-design.md: enquanto a agência não contratou proxy, o
 * produto precisa conectar; cadastrar o primeiro proxy reativa a
 * exigência sozinho (este fallback só dispara com o pool vazio).
 *
 * QUALQUER outro erro relança sem alteração — em especial
 * `proxy_pool_exhausted`: com proxies cadastrados e lotados, conectar
 * sem proxy continua proibido (regra antiban da fase 1).
 */
export async function assignProxyIfAvailable(
  db: SupabaseClient,
  accountId: string,
  phone?: string | null,
  /** De qual número — ver `assignProxy`. */
  instanceName?: string | null,
): Promise<{ proxyId: string | null; config: EvolutionProxyConfig | null }> {
  try {
    return await assignProxy(db, accountId, phone, instanceName);
  } catch (err) {
    if (err instanceof ProxyPoolError && err.code === "proxy_pool_empty") {
      console.warn(
        "[proxy-pool] POOL VAZIO: conectando SEM proxy. Cadastre um proxy para ativar a protecao antiban.",
      );
      return { proxyId: null, config: null };
    }
    throw err;
  }
}

/** Solta a vaga do proxy. Chamado ao excluir o cliente. */
export async function releaseProxy(
  db: SupabaseClient,
  accountId: string,
  /**
   * Solta só a vaga deste número. Omitir solta a de TODOS os números
   * do cliente — que é o certo ao excluir o cliente inteiro, e errado
   * ao remover um número só.
   */
  instanceName?: string | null,
): Promise<void> {
  let consulta = db
    .from("evolution_instances")
    .update({ proxy_id: null })
    .eq("account_id", accountId);
  if (instanceName) {
    consulta = consulta.eq("instance_name", instanceName);
  }
  const { error } = await consulta;
  if (error) {
    console.error("[proxy-pool] releaseProxy falhou:", error.message);
  }
}

/** Config decifrada de um proxy específico, para reaplicar. */
export async function loadProxyConfig(
  db: SupabaseClient,
  proxyId: string,
): Promise<EvolutionProxyConfig> {
  const { data, error } = await db
    .from("proxies")
    .select(
      "id, host, port, protocol, username, password_encrypted, region, max_instances, status",
    )
    .eq("id", proxyId)
    .maybeSingle();

  if (error || !data) {
    // O detalhe do banco fica no log: o chamador (rota de saúde ou de
    // conexão) só precisa saber que o proxy sumiu do pool.
    console.error(
      `[proxy-pool] proxy_not_found: proxy ${proxyId} não pôde ser carregado:`,
      error?.message ?? "nenhuma linha",
    );
    throw new ProxyPoolError("proxy_not_found");
  }
  return toConfig(data as ProxyRow);
}
