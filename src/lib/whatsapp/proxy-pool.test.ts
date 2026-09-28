import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  assignProxy,
  assignProxyIfAvailable,
  ProxyPoolError,
} from "./proxy-pool";

// ---------------------------------------------------------------------------
// Task 5 (correção pós-review), item 3: assignProxy ganhou um caminho
// "sticky" — se a conta já tem um proxy_id vinculado e ele continua active
// e com vaga, REUSA em vez de rodar a seleção de novo (que poderia migrar
// uma sessão de WhatsApp Web já pareada para outro IP, sinal de risco no
// domínio anti-ban). Este arquivo trava:
//   1. o caminho feliz do reuso (sem update, sem selectProxy);
//   2. a queda para seleção normal quando o proxy vinculado perdeu vaga;
//   3. a queda para seleção normal quando o proxy vinculado ficou inativo;
//   4. o caminho sem vínculo prévio (comportamento pré-existente, intacto);
//   5. o esgotamento do pool continua lançando ProxyPoolError.
//
// O mock de `db` implementa só o subconjunto do query builder do Supabase
// que assignProxy usa: .from(table).select(...).eq(...).maybeSingle() /
// .from(table).select(...).eq(...) (thenable) / .from(table).select(...)
// .not(...).neq(...) (thenable) / .from(table).update(...).eq(...)
// .select(...) (thenable). Cada `.from()` cria um builder novo com seu
// próprio estado (isUpdate/hasNot), decidido pela combinação de tabela e
// métodos encadeados, igual ao padrão usado nos testes de rota do
// connect-public.
//
// Review final, item 4: `.neq` e `.not` FILTRAM DE VERDADE a fixture de uso.
// Antes eram no-ops (`vi.fn(() => b)`) e a fixture já vinha escrita sem a
// linha da própria conta, então remover `.neq("account_id", accountId)` da
// implementação deixava a suíte verde. Esse é justamente o bug de
// auto-contagem que já foi cometido e corrigido no fix round 1 da Task 4: se
// a própria conta entra na contagem, o proxy vinculado parece cheio, o
// caminho sticky é recusado e o cliente que reconecta é migrado para outro
// IP, que é exatamente o risco anti-ban que o sticky existe para evitar.
// Agora as fixtures CONTÊM a linha da própria conta, e os testes só passam
// se o filtro existir. Ver o teste "a própria conta não ocupa vaga".
// ---------------------------------------------------------------------------

interface ProxyRowInput {
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

function proxyRow(over: Partial<ProxyRowInput> & { id: string }): ProxyRowInput {
  return {
    host: "203.0.113.1",
    port: 8080,
    protocol: "http",
    username: null,
    password_encrypted: null,
    region: null,
    max_instances: 5,
    status: "active",
    ...over,
  };
}

/** Uma linha de `evolution_instances` na fixture de ocupação do pool. */
interface UsageRow {
  account_id: string;
  proxy_id: string | null;
}

interface DbConfig {
  currentProxyId: string | null;
  currentInstError?: { message: string } | null;
  proxies: ProxyRowInput[];
  proxiesError?: { message: string } | null;
  usage: UsageRow[];
  usageError?: { message: string } | null;
  linkError?: { message: string } | null;
  /** false simula update que não bateu nenhuma linha (conta sem instância). */
  linkFound?: boolean;
}

function makeDb(config: DbConfig) {
  const updateCalls: Array<{ table: string; payload: Record<string, unknown> }> = [];

  function builder(table: string) {
    const state = {
      isUpdate: false,
      hasNot: false,
      // Filtros de verdade, aplicados na resolução. Um `.neq` no-op faz o
      // teste passar mesmo sem o `.neq` da implementação, que é a
      // regressão de auto-contagem descrita no topo do arquivo.
      neq: [] as Array<{ column: string; value: unknown }>,
      notNull: [] as string[],
    };
    const b: Record<string, unknown> = {};
    b.select = vi.fn(() => b);
    b.eq = vi.fn(() => b);
    b.neq = vi.fn((column: string, value: unknown) => {
      state.neq.push({ column, value });
      return b;
    });
    b.not = vi.fn((column: string, operator: string) => {
      state.hasNot = true;
      if (operator === "is") state.notNull.push(column);
      return b;
    });
    b.update = vi.fn((payload: Record<string, unknown>) => {
      state.isUpdate = true;
      updateCalls.push({ table, payload });
      return b;
    });
    b.maybeSingle = vi.fn(() =>
      Promise.resolve({
        data: config.currentInstError
          ? null
          : { proxy_id: config.currentProxyId },
        error: config.currentInstError ?? null,
      }),
    );
    b.then = (resolve: (v: unknown) => unknown) => {
      if (state.isUpdate) {
        return resolve(
          config.linkError
            ? { data: null, error: config.linkError }
            : {
                data: config.linkFound === false ? [] : [{ account_id: "acct-1" }],
                error: null,
              },
        );
      }
      if (table === "proxies") {
        return resolve(
          config.proxiesError
            ? { data: null, error: config.proxiesError }
            : { data: config.proxies, error: null },
        );
      }
      if (table === "evolution_instances" && state.hasNot) {
        if (config.usageError) {
          return resolve({ data: null, error: config.usageError });
        }
        const rows = config.usage.filter((row) => {
          const cell = row as unknown as Record<string, unknown>;
          return (
            state.notNull.every((column) => cell[column] !== null) &&
            state.neq.every((f) => cell[f.column] !== f.value)
          );
        });
        return resolve({ data: rows, error: null });
      }
      return resolve({ data: null, error: null });
    };
    return b;
  }

  return {
    db: { from: vi.fn((table: string) => builder(table)) } as unknown as SupabaseClient,
    updateCalls,
  };
}

describe("assignProxy: reuso sticky do proxy já vinculado", () => {
  it("reusa o proxy já vinculado, MESMO sendo ele o mais carregado, sem gravar update", async () => {
    // Fixture DESBALANCEADA de propósito: proxy-a (o vinculado) é o mais
    // carregado e proxy-b está vazio. Com o sticky desligado, a seleção
    // por menor carga migraria a conta para proxy-b, então a asserção de
    // proxyId trava a propriedade "o IP não muda" diretamente, e não por
    // acidente de empate. A linha da própria conta está na fixture: sem
    // o `.neq` da implementação, proxy-a conta 4 de 4, o sticky é
    // recusado e a conta migra.
    const { db, updateCalls } = makeDb({
      currentProxyId: "proxy-a",
      proxies: [
        proxyRow({ id: "proxy-a", host: "1.1.1.1", max_instances: 4 }),
        proxyRow({ id: "proxy-b", host: "2.2.2.2", max_instances: 4 }),
      ],
      usage: [
        { account_id: "acct-1", proxy_id: "proxy-a" }, // a PRÓPRIA conta
        { account_id: "acct-2", proxy_id: "proxy-a" },
        { account_id: "acct-3", proxy_id: "proxy-a" },
        { account_id: "acct-4", proxy_id: "proxy-a" },
        { account_id: "acct-9", proxy_id: null }, // conta sem proxy ainda
      ],
    });

    const result = await assignProxy(db, "acct-1", null);

    expect(result.proxyId).toBe("proxy-a");
    expect(result.config.host).toBe("1.1.1.1");
    expect(updateCalls).toHaveLength(0);
  });

  it("a própria conta não ocupa vaga: proxy vinculado com uma vaga só continua reusável", async () => {
    // O caso mais direto da auto-contagem. Com o `.neq`, a ocupação de
    // proxy-a é zero e o sticky reusa. Sem ele, a própria conta ocupa a
    // única vaga, o sticky é recusado, a seleção não acha candidato e a
    // reconexão de um cliente já pareado falha com pool esgotado.
    const { db, updateCalls } = makeDb({
      currentProxyId: "proxy-a",
      proxies: [proxyRow({ id: "proxy-a", host: "1.1.1.1", max_instances: 1 })],
      usage: [{ account_id: "acct-1", proxy_id: "proxy-a" }],
    });

    const result = await assignProxy(db, "acct-1", null);

    expect(result.proxyId).toBe("proxy-a");
    expect(updateCalls).toHaveLength(0);
  });

  it("proxy vinculado sem vaga: cai para a seleção normal e migra", async () => {
    const { db, updateCalls } = makeDb({
      currentProxyId: "proxy-a",
      proxies: [
        proxyRow({ id: "proxy-a", host: "1.1.1.1", max_instances: 1 }),
        proxyRow({ id: "proxy-b", host: "2.2.2.2", max_instances: 5 }),
      ],
      // OUTRA conta já ocupa a única vaga de proxy-a; a própria conta
      // também está vinculada a ele, e não deve contar.
      usage: [
        { account_id: "acct-1", proxy_id: "proxy-a" },
        { account_id: "acct-2", proxy_id: "proxy-a" },
      ],
    });

    const result = await assignProxy(db, "acct-1", null);

    expect(result.proxyId).toBe("proxy-b");
    expect(result.config.host).toBe("2.2.2.2");
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].payload).toEqual({ proxy_id: "proxy-b" });
  });

  it("proxy vinculado ficou inativo (fora da lista active): cai para a seleção normal", async () => {
    const { db, updateCalls } = makeDb({
      currentProxyId: "proxy-a",
      // proxy-a não aparece: simula status != 'active' (a query real
      // filtra .eq("status", "active"))
      proxies: [proxyRow({ id: "proxy-b", host: "2.2.2.2", max_instances: 5 })],
      usage: [{ account_id: "acct-1", proxy_id: "proxy-a" }],
    });

    const result = await assignProxy(db, "acct-1", null);

    expect(result.proxyId).toBe("proxy-b");
    expect(updateCalls).toHaveLength(1);
  });

  it("sem vínculo prévio, atribui via seleção normal e grava o vínculo", async () => {
    const { db, updateCalls } = makeDb({
      currentProxyId: null,
      proxies: [proxyRow({ id: "proxy-b", host: "2.2.2.2", max_instances: 5 })],
      usage: [],
    });

    const result = await assignProxy(db, "acct-1", null);

    expect(result.proxyId).toBe("proxy-b");
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].payload).toEqual({ proxy_id: "proxy-b" });
  });

  it("pool esgotado (mesmo sem sticky) continua lançando ProxyPoolError", async () => {
    const { db } = makeDb({
      currentProxyId: null,
      proxies: [proxyRow({ id: "proxy-a", max_instances: 1 })],
      // única vaga ocupada por OUTRA conta
      usage: [{ account_id: "acct-2", proxy_id: "proxy-a" }],
    });

    await expect(assignProxy(db, "acct-1", null)).rejects.toMatchObject({
      name: "ProxyPoolError",
      code: "proxy_pool_exhausted",
      status: 503,
    });
  });

  it("ProxyPoolError é uma classe real (instanceof funciona, como as rotas exigem)", async () => {
    const { db } = makeDb({
      currentProxyId: null,
      proxies: [],
      usage: [],
    });

    await expect(assignProxy(db, "acct-1", null)).rejects.toBeInstanceOf(
      ProxyPoolError,
    );
  });
});

// ---------------------------------------------------------------------------
// Review final, item 1: o erro cru do Postgres não pode chegar ao chamador.
//
// `assignProxy` é alcançado por /api/whatsapp/evolution/connect-public, que
// NÃO exige login: basta o token do link de conexão. Interpolar o
// `error.message` do PostgREST na mensagem do ProxyPoolError entregava nome
// de tabela, de coluna e de constraint para quem só tem esse token. Os
// testes abaixo travam as duas metades da correção: o detalhe VAI para o log
// do servidor, e NÃO vai para a mensagem que a rota devolve.
//
// De quebra, exercitam os cinco ramos de erro de assignProxy, que antes eram
// só opções não usadas na fixture (andaime morto apontado no review).
// ---------------------------------------------------------------------------
describe("assignProxy: detalhe do banco fica no log, nunca na mensagem", () => {
  // Cara de mensagem real do PostgREST: revela schema.
  const PG_DETAIL =
    'column evolution_instances.proxy_id does not exist (hint: perhaps you meant "proxy")';

  let errorSpy: ReturnType<typeof vi.spyOn>;

  function spyOnConsoleError() {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    return errorSpy;
  }

  afterEach(() => {
    errorSpy?.mockRestore();
  });

  /** Junta tudo que foi logado numa string só, para procurar o detalhe. */
  function loggedText(): string {
    return (errorSpy.mock.calls as unknown[][])
      .map((args) => args.map((a) => String(a)).join(" "))
      .join("\n");
  }

  const cases: Array<{
    nome: string;
    config: DbConfig;
    code: string;
    status: number;
  }> = [
    {
      nome: "falha ao consultar a instância atual",
      config: {
        currentProxyId: null,
        currentInstError: { message: PG_DETAIL },
        proxies: [proxyRow({ id: "proxy-a" })],
        usage: [],
      },
      code: "proxy_instance_query_failed",
      status: 500,
    },
    {
      nome: "falha ao consultar o pool",
      config: {
        currentProxyId: null,
        proxies: [],
        proxiesError: { message: PG_DETAIL },
        usage: [],
      },
      code: "proxy_query_failed",
      status: 500,
    },
    {
      nome: "falha ao contar a ocupação",
      config: {
        currentProxyId: null,
        proxies: [proxyRow({ id: "proxy-a" })],
        usage: [],
        usageError: { message: PG_DETAIL },
      },
      code: "proxy_usage_query_failed",
      status: 500,
    },
    {
      nome: "falha ao gravar o vínculo",
      config: {
        currentProxyId: null,
        proxies: [proxyRow({ id: "proxy-a" })],
        usage: [],
        linkError: { message: PG_DETAIL },
      },
      code: "proxy_link_failed",
      status: 500,
    },
  ];

  for (const c of cases) {
    it(`${c.nome}: responde ${c.code} sem citar o detalhe do Postgres`, async () => {
      const spy = spyOnConsoleError();
      const { db } = makeDb(c.config);

      const err = await assignProxy(db, "acct-1", null).then(
        () => null,
        (e: unknown) => e as ProxyPoolError,
      );

      expect(err).toBeInstanceOf(ProxyPoolError);
      expect(err!.code).toBe(c.code);
      expect(err!.status).toBe(c.status);
      // A metade que importa para a segurança.
      expect(err!.message).not.toContain("evolution_instances");
      expect(err!.message).not.toContain("column");
      expect(err!.message).not.toContain(PG_DETAIL);
      // A metade que importa para a operação: o detalhe existe, no log.
      expect(spy).toHaveBeenCalled();
      expect(loggedText()).toContain(PG_DETAIL);
      expect(loggedText()).toContain(c.code);
    });
  }

  it("update que não bate nenhuma linha vira 404 proxy_instance_not_found", async () => {
    const { db } = makeDb({
      currentProxyId: null,
      proxies: [proxyRow({ id: "proxy-a" })],
      usage: [],
      linkFound: false,
    });

    await expect(assignProxy(db, "acct-1", null)).rejects.toMatchObject({
      name: "ProxyPoolError",
      code: "proxy_instance_not_found",
      status: 404,
    });
  });
});

describe("assignProxyIfAvailable: fallback restrito ao pool vazio", () => {
  // db mínimo que reproduz as duas consultas do assignProxy:
  //   evolution_instances.select("proxy_id").eq(...).maybeSingle()
  //   proxies.select(...).eq("status","active")  (await direto)
  function makeFallbackDb(proxiesResult: { data: unknown; error: unknown }) {
    return {
      from: (table: string) => ({
        select: () => ({
          eq: () => {
            if (table === "evolution_instances") {
              return { maybeSingle: async () => ({ data: null, error: null }) };
            }
            return Promise.resolve(proxiesResult);
          },
        }),
      }),
    } as unknown as SupabaseClient;
  }

  it("pool vazio: resolve { config: null } com warn, em vez de lançar", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await assignProxyIfAvailable(
      makeFallbackDb({ data: [], error: null }),
      "acct-1",
      null,
    );
    expect(result).toEqual({ proxyId: null, config: null });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("SEM proxy"));
    warn.mockRestore();
  });

  it("erro de banco na consulta do pool: relança (não vira fallback)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      assignProxyIfAvailable(
        makeFallbackDb({ data: null, error: { message: "boom" } }),
        "acct-1",
        null,
      ),
    ).rejects.toMatchObject({ code: "proxy_query_failed", status: 500 });
    errorSpy.mockRestore();
  });
});
