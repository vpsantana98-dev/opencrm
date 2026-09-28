import { describe, expect, it, vi } from "vitest";

import { loadPipelineFunnel } from "./queries";

/**
 * Mock mínimo do cliente Supabase para as três consultas que o funil
 * faz. Cada tabela devolve um encadeamento próprio; o que importa é
 * que `.eq()` e `.order()` sejam encadeáveis e o resultado final seja
 * aguardável.
 */
function fakeDb(opts: {
  pipelines?: { id: string; name: string }[];
  stages?: { id: string; name: string; color: string; position: number }[];
  deals?: { stage_id: string; value: number | null; status: string | null }[];
}) {
  const chain = (data: unknown) => {
    const obj: Record<string, unknown> = {};
    const ret = () => obj;
    obj.select = ret;
    obj.eq = ret;
    obj.order = ret;
    obj.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data, error: null }).then(resolve);
    return obj;
  };

  return {
    from: vi.fn((table: string) => {
      if (table === "pipelines") return chain(opts.pipelines ?? []);
      if (table === "pipeline_stages") return chain(opts.stages ?? []);
      if (table === "deals") return chain(opts.deals ?? []);
      throw new Error(`tabela inesperada: ${table}`);
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const ETAPAS = [
  { id: "s1", name: "Novo", color: "#111", position: 0 },
  { id: "s2", name: "Qualificado", color: "#222", position: 1 },
  { id: "s3", name: "Proposta", color: "#333", position: 2 },
  { id: "s4", name: "Ganho", color: "#444", position: 3 },
];

const FUNIS = [{ id: "p1", name: "Funil de Vendas" }];

function deal(stage: string, value = 100, status: string | null = "open") {
  return { stage_id: stage, value, status };
}

describe("loadPipelineFunnel — acúmulo", () => {
  it("'alcançaram' soma a etapa e todas as seguintes", async () => {
    // 10 parados no Novo, 5 no Qualificado, 2 na Proposta, 1 no Ganho.
    const deals = [
      ...Array.from({ length: 10 }, () => deal("s1")),
      ...Array.from({ length: 5 }, () => deal("s2")),
      ...Array.from({ length: 2 }, () => deal("s3")),
      deal("s4"),
    ];
    const r = await loadPipelineFunnel(
      fakeDb({ pipelines: FUNIS, stages: ETAPAS, deals }),
      "acc",
    );

    expect(r!.stages.map((s) => s.naEtapa)).toEqual([10, 5, 2, 1]);
    // 18 passaram pelo Novo, 8 pelo Qualificado, 3 pela Proposta, 1 pelo Ganho.
    expect(r!.stages.map((s) => s.alcancaram)).toEqual([18, 8, 3, 1]);
  });

  it("a taxa é a passagem de uma etapa para a seguinte", async () => {
    const deals = [
      ...Array.from({ length: 90 }, () => deal("s1")),
      ...Array.from({ length: 5 }, () => deal("s2")),
      ...Array.from({ length: 4 }, () => deal("s3")),
      deal("s4"),
    ];
    const r = await loadPipelineFunnel(
      fakeDb({ pipelines: FUNIS, stages: ETAPAS, deals }),
      "acc",
    );

    // alcançaram: [100, 10, 5, 1]
    expect(r!.stages.map((s) => s.alcancaram)).toEqual([100, 10, 5, 1]);
    expect(r!.stages[0].taxaDaAnterior).toBeNull(); // não há anterior
    expect(r!.stages[1].taxaDaAnterior).toBeCloseTo(0.1);
    expect(r!.stages[2].taxaDaAnterior).toBeCloseTo(0.5);
    expect(r!.stages[3].taxaDaAnterior).toBeCloseTo(0.2);
    expect(r!.taxaGeral).toBeCloseTo(0.01); // 1 de 100
  });

  it("etapa anterior zerada devolve null, não 0% nem Infinity", async () => {
    // Ninguém no funil inteiro.
    const r = await loadPipelineFunnel(
      fakeDb({ pipelines: FUNIS, stages: ETAPAS, deals: [] }),
      "acc",
    );
    expect(r!.stages.every((s) => s.taxaDaAnterior === null)).toBe(true);
    expect(r!.taxaGeral).toBeNull();
    expect(r!.totalEntraram).toBe(0);
  });

  it("etapa vazia no meio NÃO some do funil", async () => {
    // A rosca antiga filtrava etapas zeradas. Num funil, a etapa vazia
    // é justamente a informação: foi ali que todo mundo parou.
    const r = await loadPipelineFunnel(
      fakeDb({
        pipelines: FUNIS,
        stages: ETAPAS,
        deals: [deal("s1"), deal("s1"), deal("s4")],
      }),
      "acc",
    );
    expect(r!.stages).toHaveLength(4);
    expect(r!.stages.map((s) => s.naEtapa)).toEqual([2, 0, 0, 1]);
    expect(r!.stages.map((s) => s.alcancaram)).toEqual([3, 1, 1, 1]);
  });
});

describe("loadPipelineFunnel — status dos negócios", () => {
  it("ganho e perdido contam: eles também passaram pelas etapas", async () => {
    const r = await loadPipelineFunnel(
      fakeDb({
        pipelines: FUNIS,
        stages: ETAPAS,
        deals: [
          deal("s1", 100, "open"),
          deal("s2", 200, "lost"),
          deal("s4", 300, "won"),
        ],
      }),
      "acc",
    );
    expect(r!.totalEntraram).toBe(3);
    expect(r!.valorTotal).toBe(600);
  });
});

describe("loadPipelineFunnel — escolha do funil", () => {
  it("sem funil na conta devolve null em vez de estourar", async () => {
    const r = await loadPipelineFunnel(fakeDb({ pipelines: [] }), "acc");
    expect(r).toBeNull();
  });

  it("usa o primeiro funil quando nenhum é pedido", async () => {
    const r = await loadPipelineFunnel(
      fakeDb({
        pipelines: [
          { id: "p1", name: "Primeiro" },
          { id: "p2", name: "Segundo" },
        ],
        stages: ETAPAS,
      }),
      "acc",
    );
    expect(r!.pipelineId).toBe("p1");
    expect(r!.funisDisponiveis).toHaveLength(2);
  });

  it("id desconhecido cai no primeiro em vez de tela vazia", async () => {
    // Acontece com URL antiga ou funil apagado.
    const r = await loadPipelineFunnel(
      fakeDb({
        pipelines: [
          { id: "p1", name: "Primeiro" },
          { id: "p2", name: "Segundo" },
        ],
        stages: ETAPAS,
      }),
      "acc",
      "p-que-nao-existe",
    );
    expect(r!.pipelineId).toBe("p1");
  });

  it("respeita o funil pedido quando ele existe", async () => {
    const r = await loadPipelineFunnel(
      fakeDb({
        pipelines: [
          { id: "p1", name: "Primeiro" },
          { id: "p2", name: "Segundo" },
        ],
        stages: ETAPAS,
      }),
      "acc",
      "p2",
    );
    expect(r!.pipelineId).toBe("p2");
    expect(r!.pipelineName).toBe("Segundo");
  });
});
