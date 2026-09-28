import type { SupabaseClient } from "@supabase/supabase-js";

import { isAccountRole } from "@/lib/auth/roles";
import type { AgentReportRow, ReportsBundle, ReportsTotals } from "./types";

type DB = SupabaseClient;

/**
 * PostgREST devolve no máximo 1000 linhas por requisição, e o corte é
 * SILENCIOSO — a resposta não avisa que sobrou coisa. Uma leitura única
 * de "mensagens dos últimos 90 dias" portanto pararia em 1000 e o
 * relatório mostraria números baixos com aparência de exatos.
 *
 * Por isso lemos em páginas até acabar, com um teto: acima dele o
 * bundle volta com `truncado: true` e a tela avisa em vez de mentir.
 */
const PAGE = 1000;
const MAX_PAGES = 20; // 20 mil mensagens

export interface MessageRow {
  conversation_id: string;
  sender_type: string;
  sender_id: string | null;
  created_at: string;
}

export interface AgregadoMensagens {
  /** userId → mensagens enviadas por ele. */
  enviadas: Map<string, number>;
  /** userId → conversas distintas em que ele falou. */
  conversasPorAgente: Map<string, Set<string>>;
  /** userId → tempos de resposta, em minutos. */
  temposResposta: Map<string, number[]>;
  totalEnviadas: number;
  totalRecebidas: number;
  /** Mensagens nossas que não dá para atribuir a ninguém. */
  semAutoria: number;
}

/**
 * Percorre as mensagens do período e produz tudo de uma vez.
 *
 * Separada da função que fala com o banco porque é aqui que mora a
 * regra sutil (o pareamento cliente → resposta), e essa regra precisa
 * ser testável sem um Supabase por perto.
 *
 * ESPERA as linhas agrupadas por conversa e, dentro de cada conversa,
 * em ordem cronológica — é o que a query garante com o duplo `order`.
 * Fora dessa ordem os tempos de resposta saem errados.
 */
export function agregarMensagens(rows: MessageRow[]): AgregadoMensagens {
  const enviadas = new Map<string, number>();
  const conversasPorAgente = new Map<string, Set<string>>();
  const temposResposta = new Map<string, number[]>();

  let totalEnviadas = 0;
  let totalRecebidas = 0;
  let semAutoria = 0;

  let convAtual: string | null = null;
  let clientePendente: Date | null = null;

  for (const row of rows) {
    if (row.conversation_id !== convAtual) {
      convAtual = row.conversation_id;
      // Espera não atravessa conversa: a pergunta de um cliente não
      // pode ser "respondida" pela primeira mensagem da conversa
      // seguinte só porque ela veio depois no tempo.
      clientePendente = null;
    }

    if (row.sender_type === "customer") {
      totalRecebidas += 1;
      // Só a PRIMEIRA mensagem não respondida conta: se o cliente manda
      // cinco seguidas enquanto espera, isso é uma espera, não cinco —
      // contar todas afundaria a média artificialmente.
      if (!clientePendente) clientePendente = new Date(row.created_at);
      continue;
    }

    if (row.sender_type === "agent") {
      totalEnviadas += 1;
      if (row.sender_id) {
        enviadas.set(row.sender_id, (enviadas.get(row.sender_id) ?? 0) + 1);
        let convs = conversasPorAgente.get(row.sender_id);
        if (!convs) {
          convs = new Set();
          conversasPorAgente.set(row.sender_id, convs);
        }
        convs.add(row.conversation_id);
      } else {
        // Envio anterior ao registro de autoria, ou vindo da API
        // pública (API key não tem usuário para atribuir).
        semAutoria += 1;
      }
    }

    // Tanto 'agent' quanto 'bot' encerram a espera: do ponto de vista
    // de quem escreveu, alguém respondeu. Mas o tempo só é creditado a
    // uma PESSOA — resposta automática não entra na média de ninguém,
    // senão um bot rápido mascararia um time lento.
    if (clientePendente) {
      if (row.sender_type === "agent" && row.sender_id) {
        const minutos =
          (new Date(row.created_at).getTime() - clientePendente.getTime()) /
          60_000;
        if (minutos >= 0) {
          const lista = temposResposta.get(row.sender_id) ?? [];
          lista.push(minutos);
          temposResposta.set(row.sender_id, lista);
        }
      }
      clientePendente = null;
    }
  }

  return {
    enviadas,
    conversasPorAgente,
    temposResposta,
    totalEnviadas,
    totalRecebidas,
    semAutoria,
  };
}

/**
 * Lê as mensagens do período, paginando.
 *
 * `messages` não tem `account_id` — o vínculo com a conta é só via
 * `conversation_id`. Daí o join `conversations!inner`: ele restringe de
 * verdade (inner join), enquanto a RLS de `messages` usa
 * `is_account_member`, que autoriza QUALQUER conta da qual o usuário
 * participa. Para quem atende mais de um cliente, a RLS sozinha
 * misturaria as contas neste relatório.
 */
async function fetchMessages(
  db: DB,
  accountId: string,
  fromISO: string,
  toISO: string,
): Promise<{ rows: MessageRow[]; truncado: boolean }> {
  const rows: MessageRow[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE;
    const { data, error } = await db
      .from("messages")
      .select("conversation_id, sender_type, sender_id, created_at, conversations!inner(account_id)")
      .eq("conversations.account_id", accountId)
      .gte("created_at", fromISO)
      .lte("created_at", toISO)
      // A ordem por conversa + tempo é o que permite o pareamento
      // cliente→resposta mais abaixo funcionar numa única passada.
      .order("conversation_id", { ascending: true })
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) throw error;

    const batch = (data ?? []) as unknown as MessageRow[];
    rows.push(...batch);
    if (batch.length < PAGE) return { rows, truncado: false };
  }

  return { rows, truncado: true };
}

/** Média simples; `null` para lista vazia (≠ zero). */
function media(valores: number[]): number | null {
  if (valores.length === 0) return null;
  return valores.reduce((a, b) => a + b, 0) / valores.length;
}

/**
 * Relatório de desempenho por atendente no período.
 *
 * Toda a agregação acontece aqui, em JS, e não em SQL. É o mesmo
 * caminho que `lib/dashboard/queries.ts` já usa e serve bem na escala
 * atual; se um cliente passar do teto de leitura acima, o certo é
 * mover estas contas para uma RPC no Postgres em vez de aumentar o
 * teto.
 */
export async function loadAgentReport(
  db: DB,
  accountId: string,
  fromISO: string,
  toISO: string,
  opts: { incluirEmails: boolean },
): Promise<ReportsBundle> {
  const [rosterRes, mensagens, convsNovas, contatosNovos] = await Promise.all([
    // Mesma fonte que a tela de Equipe usa (/api/account/members), de
    // propósito: se as duas telas listassem pessoas de tabelas
    // diferentes, um atendente poderia aparecer numa e sumir na outra.
    db
      .from("profiles")
      .select("user_id, full_name, email, avatar_url, account_role")
      .eq("account_id", accountId),
    fetchMessages(db, accountId, fromISO, toISO),
    db
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId)
      .gte("created_at", fromISO)
      .lte("created_at", toISO),
    db
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId)
      // Grupo de WhatsApp não é contato — mesma exclusão que o
      // Dashboard aplica, senão as duas telas divergem.
      .eq("is_group", false)
      .gte("created_at", fromISO)
      .lte("created_at", toISO),
  ]);

  // Falha de qualquer uma das quatro derruba o relatório inteiro, de
  // propósito. O `count` do PostgREST volta `null` quando a query
  // falha, e `null ?? 0` renderiza um ZERO — indistinguível de "não
  // houve movimento no período". Um relatório que erra para baixo em
  // silêncio é pior do que um que não abre.
  if (rosterRes.error) throw rosterRes.error;
  if (convsNovas.error) throw convsNovas.error;
  if (contatosNovos.error) throw contatosNovos.error;

  const roster = (rosterRes.data ?? []) as Array<{
    user_id: string;
    full_name: string | null;
    email: string | null;
    avatar_url: string | null;
    account_role: string;
  }>;

  // --- Agregações por atendente -------------------------------------

  const {
    enviadas,
    conversasPorAgente,
    temposResposta,
    totalEnviadas,
    totalRecebidas,
    semAutoria,
  } = agregarMensagens(mensagens.rows);

  // --- Conversas atribuídas (estado atual) ---------------------------

  // Uma contagem por atendente, em paralelo, em vez de puxar todas as
  // conversas e contar aqui: o COUNT roda no banco, é exato e não
  // esbarra no teto de linhas. São tantas consultas quanto membros da
  // equipe — dezenas, não milhares.
  const atribuidas = await Promise.all(
    roster.map(async (p) => {
      const { count, error } = await db
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("account_id", accountId)
        .eq("assigned_agent_id", p.user_id);
      // Mesmo motivo das contagens acima: `count` nulo viraria zero, e
      // "não tem nada na fila dele" é uma afirmação forte demais para
      // sair de uma query que falhou.
      if (error) throw error;
      return [p.user_id, count ?? 0] as const;
    }),
  );
  const atribuidasPorAgente = new Map(atribuidas);

  const agentes: AgentReportRow[] = roster
    .map((p) => {
      const tempos = temposResposta.get(p.user_id) ?? [];
      return {
        userId: p.user_id,
        nome: p.full_name?.trim() || p.email || "Sem nome",
        email: opts.incluirEmails ? p.email : null,
        avatarUrl: p.avatar_url,
        papel: isAccountRole(p.account_role) ? p.account_role : null,
        mensagensEnviadas: enviadas.get(p.user_id) ?? 0,
        conversasAtendidas: conversasPorAgente.get(p.user_id)?.size ?? 0,
        conversasAtribuidas: atribuidasPorAgente.get(p.user_id) ?? 0,
        tempoMedioRespostaMin: media(tempos),
        amostrasResposta: tempos.length,
      };
    })
    // Mais ativo primeiro; empate desempata pelo nome para a ordem não
    // dançar entre carregamentos quando todo mundo está zerado.
    .sort(
      (a, b) =>
        b.mensagensEnviadas - a.mensagensEnviadas ||
        a.nome.localeCompare(b.nome, "pt-BR"),
    );

  const totais: ReportsTotals = {
    mensagensEnviadas: totalEnviadas,
    mensagensRecebidas: totalRecebidas,
    conversasNovas: convsNovas.count ?? 0,
    contatosNovos: contatosNovos.count ?? 0,
  };

  const dias = Math.max(
    1,
    Math.round(
      (new Date(toISO).getTime() - new Date(fromISO).getTime()) / 86_400_000,
    ),
  );

  return {
    periodo: { from: fromISO, to: toISO, dias },
    agentes,
    totais,
    mensagensSemAutoria: semAutoria,
    truncado: mensagens.truncado,
  };
}
