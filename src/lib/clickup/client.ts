// ============================================================
// Cliente da API do ClickUp. SERVER-ONLY.
//
// Chave é POR USUÁRIO (profiles.clickup_api_key, cifrada). O token
// pessoal do ClickUp vai direto no header Authorization (sem "Bearer").
//
// Aqui só o mínimo da Fase 1: validar a chave (GET /user). As leituras
// de tarefas/materiais do card vêm na fase do painel.
// ============================================================

const BASE = "https://api.clickup.com/api/v2";

const TIMEOUT_MS = 10_000;
const MAX_429_RETRIES = 2;
const RATE_LIMIT_MSG =
  "O ClickUp está limitando as requisições. Tente de novo em instantes.";

export interface ClickUpUser {
  id: number;
  username: string;
  email: string;
}

async function call(
  apiKey: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<{ ok: boolean; status: number; data: unknown }> {
  // Retry só pra 429 (rate limit); erro de rede/timeout sobe pro try/catch
  // de quem chamou. `attempt` conta as tentativas EXTRAS além da 1ª.
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${BASE}${path}`, {
        method: init?.method ?? "GET",
        headers: { Authorization: apiKey, "Content-Type": "application/json" },
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
        cache: "no-store",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 429 && attempt < MAX_429_RETRIES) {
      const retryAfterHeader = Number(res.headers.get("retry-after"));
      const waitMs =
        Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
          ? retryAfterHeader * 1000
          : 1000;
      await new Promise((resolve) => setTimeout(resolve, Math.max(waitMs, 1000)));
      continue;
    }
    if (res.status === 429) {
      // Esgotou as tentativas: erro legível em vez de HTTP 429 cru.
      return { ok: false, status: 429, data: { err: RATE_LIMIT_MSG } };
    }
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  }
}

/** Mensagem de erro padrão a partir de uma resposta de `call()`. */
function callErrorMessage(res: { status: number; data: unknown }): string {
  return (
    (res.data as { err?: string } | null)?.err ??
    (res.status === 401 ? "Chave inválida" : `HTTP ${res.status}`)
  );
}

/** Valida a chave e devolve o usuário do ClickUp dono dela. */
export async function getClickUpUser(
  apiKey: string,
): Promise<{ ok: boolean; user?: ClickUpUser; error?: string }> {
  try {
    const res = await call(apiKey, "/user");
    if (!res.ok) return { ok: false, error: callErrorMessage(res) };
    const user = (res.data as { user?: ClickUpUser } | null)?.user;
    return { ok: true, user };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Erro de rede" };
  }
}

export interface ClickUpStatus {
  status: string;
  color: string | null;
}

export interface ClickUpTask {
  id: string;
  name: string;
  status: string;
  statusColor: string | null;
  url: string;
  assignees: string[];
  /** Vencimento em ms (epoch), ou null. */
  due: number | null;
  /** Lista (ClickUp) a que a tarefa pertence — casa a tarefa com as opções de status certas. */
  listId: string;
}

/** Extrai o id da Lista de uma URL do ClickUp (ou aceita o id cru). */
export function parseListId(input: string): string | null {
  const s = input.trim();
  if (/^\d+$/.test(s)) return s;
  const m = s.match(/\/(?:li|l)\/(\d+)/) ?? s.match(/(\d{6,})/);
  return m ? m[1] : null;
}

// ------------------------------------------------------------
// Paginação: a API do ClickUp devolve no máximo 100 itens por página.
// Teto de segurança de 10 páginas (1000 itens) pra nunca ficar em loop.
// ------------------------------------------------------------

const PAGE_SIZE = 100;
const MAX_PAGES = 10;

function withPageParam(path: string, page: number): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}page=${page}`;
}

/**
 * Busca todas as páginas de um endpoint do ClickUp, parando na primeira
 * página com menos de 100 itens (última página) ou no teto de 10 páginas.
 * Falha em QUALQUER página é propagada — nunca vira lista parcial silenciosa.
 */
async function callPaginated<T>(
  apiKey: string,
  path: string,
  extract: (data: unknown) => T[],
): Promise<{ ok: boolean; items?: T[]; error?: string }> {
  const all: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await call(apiKey, withPageParam(path, page));
    if (!res.ok) return { ok: false, error: callErrorMessage(res) };
    const items = extract(res.data);
    all.push(...items);
    if (items.length < PAGE_SIZE) break;
  }
  return { ok: true, items: all };
}

// ------------------------------------------------------------
// Fan-out com limite: evita disparar dezenas de requisições simultâneas
// pro ClickUp quando o workspace real tem muitos espaços/listas.
// ------------------------------------------------------------

const FANOUT_LIMIT = 4;

async function withPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

// ------------------------------------------------------------
// Alvos do cliente (Pasta ou Lista) — pra conectar via API, sem link.
// ------------------------------------------------------------

export interface ClickUpTarget {
  type: "folder" | "list";
  id: string;
  name: string;
  spaceName: string;
  teamId: string;
}

interface Named {
  id: string;
  name: string;
}

/**
 * Lista TODAS as "operações de cliente" acessíveis pela chave: pastas
 * (Folders) e listas soltas (folderless Lists) de todos os espaços de
 * todos os workspaces. É o que alimenta o seletor e o casamento por nome.
 */
export async function listClickUpTargets(
  apiKey: string,
): Promise<{ ok: boolean; targets?: ClickUpTarget[]; error?: string }> {
  try {
    const teamsRes = await call(apiKey, "/team");
    if (!teamsRes.ok) return { ok: false, error: callErrorMessage(teamsRes) };
    const teams = (teamsRes.data as { teams?: Named[] } | null)?.teams ?? [];
    const targets: ClickUpTarget[] = [];

    for (const team of teams) {
      const spacesRes = await callPaginated<Named>(
        apiKey,
        `/team/${team.id}/space?archived=false`,
        (data) => (data as { spaces?: Named[] } | null)?.spaces ?? [],
      );
      if (!spacesRes.ok) return { ok: false, error: spacesRes.error };
      const spaces = spacesRes.items ?? [];

      const perSpace = await withPool(spaces, FANOUT_LIMIT, async (space) => {
        const foldersRes = await callPaginated<Named>(
          apiKey,
          `/space/${space.id}/folder?archived=false`,
          (data) => (data as { folders?: Named[] } | null)?.folders ?? [],
        );
        if (!foldersRes.ok) return { ok: false as const, error: foldersRes.error };
        const listsRes = await callPaginated<Named>(
          apiKey,
          `/space/${space.id}/list?archived=false`,
          (data) => (data as { lists?: Named[] } | null)?.lists ?? [],
        );
        if (!listsRes.ok) return { ok: false as const, error: listsRes.error };
        return {
          ok: true as const,
          space,
          folders: foldersRes.items ?? [],
          lists: listsRes.items ?? [],
        };
      });

      for (const r of perSpace) {
        if (!r.ok) return { ok: false, error: r.error };
        for (const f of r.folders) {
          targets.push({
            type: "folder",
            id: f.id,
            name: f.name,
            spaceName: r.space.name,
            teamId: team.id,
          });
        }
        for (const l of r.lists) {
          targets.push({
            type: "list",
            id: l.id,
            name: l.name,
            spaceName: r.space.name,
            teamId: team.id,
          });
        }
      }
    }
    return { ok: true, targets };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Erro de rede" };
  }
}

/**
 * Tarefas abertas do alvo do cliente. Se for Lista, lê direto; se for
 * Pasta, agrega as tarefas abertas de todas as Listas da pasta.
 * `statusesByList` traz, por id de lista, as opções de status que a
 * própria lista do ClickUp devolve (usado no seletor de status).
 * `lists` traz id+nome das Listas do alvo — na Pasta, pra escolher em qual
 * Lista criar uma tarefa nova (Pasta em si não recebe tarefa).
 */
export async function getTargetWithTasks(
  apiKey: string,
  type: "folder" | "list",
  id: string,
): Promise<{
  ok: boolean;
  name?: string;
  tasks?: ClickUpTask[];
  statusesByList?: Record<string, ClickUpStatus[]>;
  lists?: Named[];
  error?: string;
}> {
  if (type === "list") {
    const r = await getListWithTasks(apiKey, id);
    if (!r.ok) return { ok: false, error: r.error };
    return {
      ok: true,
      name: r.name,
      tasks: r.tasks,
      statusesByList: { [id]: r.statuses ?? [] },
      lists: [{ id, name: r.name ?? "Lista" }],
    };
  }
  try {
    const info = await call(apiKey, `/folder/${id}`);
    if (!info.ok) {
      const msg =
        (info.data as { err?: string } | null)?.err ??
        (info.status === 401
          ? "Chave inválida"
          : `Pasta não encontrada (HTTP ${info.status})`);
      return { ok: false, error: msg };
    }
    const folder = info.data as { name?: string; lists?: Named[] } | null;
    const name = folder?.name ?? "Pasta";
    const lists = folder?.lists ?? [];
    const perList = await withPool(lists, FANOUT_LIMIT, (l) =>
      getListWithTasks(apiKey, l.id),
    );
    const failed = perList.find((r) => !r.ok);
    if (failed) return { ok: false, error: failed.error };
    const tasks = perList.flatMap((r) => r.tasks ?? []);
    const statusesByList: Record<string, ClickUpStatus[]> = {};
    lists.forEach((l, i) => {
      statusesByList[l.id] = perList[i]?.statuses ?? [];
    });
    return { ok: true, name, tasks, statusesByList, lists };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Erro de rede" };
  }
}

/** URL web (best-effort) pro "Ver no ClickUp" de uma pasta/lista. */
export function buildTargetUrl(
  type: "folder" | "list",
  id: string,
  teamId: string,
): string {
  return type === "folder"
    ? `https://app.clickup.com/${teamId}/v/o/f/${id}`
    : `https://app.clickup.com/${teamId}/v/li/${id}`;
}

interface RawTask {
  id: string;
  name: string;
  url?: string;
  status?: { status?: string; color?: string };
  assignees?: { username?: string }[];
  due_date?: string | number | null;
}

function toClickUpTask(x: unknown, listId: string): ClickUpTask {
  const task = x as RawTask;
  const dueRaw = task.due_date;
  const due =
    dueRaw !== null && dueRaw !== undefined && `${dueRaw}` !== ""
      ? Number(dueRaw)
      : null;
  return {
    id: task.id,
    name: task.name,
    status: task.status?.status ?? "",
    statusColor: task.status?.color ?? null,
    url: task.url ?? "",
    assignees: (task.assignees ?? [])
      .map((a) => a.username)
      .filter((u): u is string => !!u),
    due: due !== null && Number.isFinite(due) ? due : null,
    listId,
  };
}

/**
 * Nome da Lista + suas tarefas abertas (não arquivadas, não fechadas) +
 * as opções de status que a lista aceita (pro seletor). Se o ClickUp não
 * trouxer `statuses` na resposta de `/list/{id}`, `statuses` vem vazio —
 * nunca inventamos uma lista fixa.
 */
export async function getListWithTasks(
  apiKey: string,
  listId: string,
): Promise<{
  ok: boolean;
  name?: string;
  tasks?: ClickUpTask[];
  statuses?: ClickUpStatus[];
  error?: string;
}> {
  try {
    const info = await call(apiKey, `/list/${listId}`);
    if (!info.ok) {
      const msg =
        (info.data as { err?: string } | null)?.err ??
        (info.status === 401 ? "Chave inválida" : `Lista não encontrada (HTTP ${info.status})`);
      return { ok: false, error: msg };
    }
    const infoData = info.data as { name?: string; statuses?: unknown[] } | null;
    const name = infoData?.name ?? "Lista";
    const statuses: ClickUpStatus[] = (infoData?.statuses ?? [])
      .map((s) => {
        const st = s as { status?: string; color?: string };
        return { status: st.status ?? "", color: st.color ?? null };
      })
      .filter((s) => s.status);

    const t = await callPaginated<unknown>(
      apiKey,
      `/list/${listId}/task?archived=false&include_closed=false&subtasks=false`,
      (data) => (data as { tasks?: unknown[] } | null)?.tasks ?? [],
    );
    if (!t.ok) return { ok: false, error: t.error };
    const tasks = (t.items ?? []).map((x) => toClickUpTask(x, listId));
    return { ok: true, name, tasks, statuses };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Erro de rede" };
  }
}

/**
 * Cria uma tarefa numa Lista do ClickUp.
 *
 * `markdownContent` usa o campo `markdown_content` da v2. O nome antigo
 * `markdown_description` foi REMOVIDO e falha em silêncio: a API
 * responde 200 e a tarefa nasce com corpo vazio. Se você só tem texto
 * simples, use `description`.
 *
 * `assignees` importa mais do que parece: sem responsável a tarefa fica
 * órfã na lista e não aparece no "Assigned to me" de ninguém — no
 * ClickUp, quem cria não vira responsável.
 */
export async function createTask(
  apiKey: string,
  listId: string,
  input: {
    name: string;
    description?: string;
    markdownContent?: string;
    assignees?: number[];
    priority?: number;
    tags?: string[];
  },
): Promise<{ ok: boolean; task?: ClickUpTask; error?: string }> {
  try {
    // Monta só o que veio: mandar `undefined` em campo opcional faz a
    // API tratar como "limpar", não como "não mexer".
    const body: Record<string, unknown> = { name: input.name };
    if (input.description !== undefined) body.description = input.description;
    if (input.markdownContent !== undefined) {
      body.markdown_content = input.markdownContent;
    }
    if (input.assignees?.length) body.assignees = input.assignees;
    if (input.priority !== undefined) body.priority = input.priority;
    if (input.tags?.length) body.tags = input.tags;

    const res = await call(apiKey, `/list/${listId}/task`, {
      method: "POST",
      body,
    });
    if (!res.ok) return { ok: false, error: callErrorMessage(res) };
    if (!res.data) return { ok: false, error: "Resposta vazia do ClickUp" };
    return { ok: true, task: toClickUpTask(res.data, listId) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Erro de rede" };
  }
}

/**
 * Anexa um arquivo a uma tarefa.
 *
 * Não passa pelo `call()` acima de propósito: aquele helper força
 * `Content-Type: application/json`, e aqui o corpo é multipart. Definir
 * o Content-Type à mão num FormData PERDE o boundary que o runtime
 * geraria, e a API recusa o upload sem dizer por quê — por isso só o
 * header `Authorization` vai junto.
 */
export async function attachToTask(
  apiKey: string,
  taskId: string,
  arquivo: { nome: string; mime: string; bytes: Uint8Array },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const form = new FormData();
    form.append(
      "attachment",
      new Blob([arquivo.bytes as unknown as BlobPart], { type: arquivo.mime }),
      arquivo.nome,
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${BASE}/task/${taskId}/attachment`, {
        method: "POST",
        headers: { Authorization: apiKey },
        body: form,
        cache: "no-store",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as {
        err?: string;
      } | null;
      return { ok: false, error: data?.err ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Erro de rede",
    };
  }
}

/** Muda o status de uma tarefa existente. */
export async function updateTaskStatus(
  apiKey: string,
  taskId: string,
  status: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await call(apiKey, `/task/${taskId}`, {
      method: "PUT",
      body: { status },
    });
    if (!res.ok) return { ok: false, error: callErrorMessage(res) };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Erro de rede" };
  }
}
