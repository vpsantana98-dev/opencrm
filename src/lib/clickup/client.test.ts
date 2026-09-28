import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getClickUpUser,
  getListWithTasks,
  listClickUpTargets,
} from "./client";

// ---------------------------------------------------------------------------
// Testa client.ts no nível do fio (mocka só `fetch`, no padrão de
// evolution-api.test.ts): .ok checado em todas as sub-requisições (2.1),
// paginação (2.2) e 429 com backoff (2.3).
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Passo 2.1 — sub-requisição que falha não vira lista vazia", () => {
  it("getListWithTasks: falha ao buscar tarefas propaga o erro (não 'nenhuma tarefa')", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/list/123")) {
          return jsonResponse({ name: "Lista X", statuses: [] });
        }
        if (url.includes("/list/123/task")) {
          return jsonResponse({ err: "Team not authorized" }, 500);
        }
        return jsonResponse({}, 404);
      }),
    );

    const res = await getListWithTasks("key", "123");

    expect(res.ok).toBe(false);
    expect(res.tasks).toBeUndefined();
    expect(res.error).toBeTruthy();
  });

  it("listClickUpTargets: falha ao listar pastas de um espaço propaga o erro (não 'nenhuma pasta encontrada')", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/team")) {
          return jsonResponse({ teams: [{ id: "1", name: "acme" }] });
        }
        if (url.includes("/team/1/space")) {
          return jsonResponse({ spaces: [{ id: "10", name: "Space" }] });
        }
        if (url.includes("/space/10/folder")) {
          return jsonResponse({ err: "Team not authorized" }, 500);
        }
        if (url.includes("/space/10/list")) {
          return jsonResponse({ lists: [] });
        }
        return jsonResponse({}, 404);
      }),
    );

    const res = await listClickUpTargets("key");

    expect(res.ok).toBe(false);
    expect(res.targets).toBeUndefined();
    expect(res.error).toBeTruthy();
  });
});

describe("Passo 2.2 — paginação", () => {
  it("getListWithTasks: junta as páginas de tarefas até a página vir incompleta", async () => {
    const page0 = Array.from({ length: 100 }, (_, i) => ({
      id: `t${i}`,
      name: `Tarefa ${i}`,
    }));
    const page1 = [{ id: "t100", name: "Tarefa 100" }];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/list/123")) {
          return jsonResponse({ name: "Lista", statuses: [] });
        }
        if (url.includes("/list/123/task") && url.includes("page=0")) {
          return jsonResponse({ tasks: page0 });
        }
        if (url.includes("/list/123/task") && url.includes("page=1")) {
          return jsonResponse({ tasks: page1 });
        }
        return jsonResponse({}, 404);
      }),
    );

    const res = await getListWithTasks("key", "123");

    expect(res.ok).toBe(true);
    expect(res.tasks).toHaveLength(101);
  });

  it("getListWithTasks: respeita o teto de 10 páginas mesmo se o ClickUp continuar mandando página cheia", async () => {
    let taskPageCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/list/123")) {
          return jsonResponse({ name: "Lista", statuses: [] });
        }
        if (url.includes("/list/123/task")) {
          taskPageCalls++;
          const tasks = Array.from({ length: 100 }, (_, i) => ({
            id: `p${taskPageCalls}-${i}`,
            name: "x",
          }));
          return jsonResponse({ tasks });
        }
        return jsonResponse({}, 404);
      }),
    );

    const res = await getListWithTasks("key", "123");

    expect(res.ok).toBe(true);
    expect(res.tasks).toHaveLength(1000);
    expect(taskPageCalls).toBe(10);
  });
});

describe("Passo 2.3 — 429 com backoff", () => {
  it("tenta de novo em 429 e volta a funcionar se uma tentativa seguinte for 200", async () => {
    vi.useFakeTimers();
    let attempt = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        attempt++;
        if (attempt < 3) return jsonResponse({ err: "rate limited" }, 429);
        return jsonResponse({
          user: { id: 1, username: "cs", email: "cs@acme.com" },
        });
      }),
    );

    const promise = getClickUpUser("key");
    await vi.runAllTimersAsync();
    const res = await promise;

    expect(res.ok).toBe(true);
    expect(attempt).toBe(3);
  });

  it("desiste após 2 novas tentativas e devolve erro legível", async () => {
    vi.useFakeTimers();
    let attempt = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        attempt++;
        return jsonResponse({ err: "rate limited" }, 429);
      }),
    );

    const promise = getClickUpUser("key");
    await vi.runAllTimersAsync();
    const res = await promise;

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/limitando as requisições/i);
    // 1ª tentativa + 2 retries = 3.
    expect(attempt).toBe(3);
  });
});
