import { describe, expect, it } from "vitest";

import { agregarMensagens, type MessageRow } from "./queries";

const T0 = new Date(2026, 4, 20, 9, 0, 0).getTime();

/** Atalho: linha de mensagem a `min` minutos do início. */
function msg(
  conv: string,
  tipo: "customer" | "agent" | "bot",
  min: number,
  senderId: string | null = null,
): MessageRow {
  return {
    conversation_id: conv,
    sender_type: tipo,
    sender_id: senderId,
    created_at: new Date(T0 + min * 60_000).toISOString(),
  };
}

describe("agregarMensagens — contagem", () => {
  it("separa enviadas de recebidas", () => {
    const r = agregarMensagens([
      msg("c1", "customer", 0),
      msg("c1", "agent", 5, "ana"),
      msg("c1", "agent", 6, "ana"),
    ]);
    expect(r.totalRecebidas).toBe(1);
    expect(r.totalEnviadas).toBe(2);
    expect(r.enviadas.get("ana")).toBe(2);
  });

  it("conta conversas distintas, não mensagens", () => {
    const r = agregarMensagens([
      msg("c1", "agent", 1, "ana"),
      msg("c1", "agent", 2, "ana"),
      msg("c2", "agent", 3, "ana"),
    ]);
    expect(r.enviadas.get("ana")).toBe(3);
    expect(r.conversasPorAgente.get("ana")?.size).toBe(2);
  });

  it("mensagem do bot não vira mensagem de agente", () => {
    // O bot responde, mas ninguém do time trabalhou por isso — contar
    // como enviada inflaria a produtividade do atendimento.
    const r = agregarMensagens([
      msg("c1", "customer", 0),
      msg("c1", "bot", 1),
    ]);
    expect(r.totalEnviadas).toBe(0);
    expect(r.semAutoria).toBe(0);
  });

  it("mensagem de agente sem sender_id vai para 'sem autoria'", () => {
    const r = agregarMensagens([
      msg("c1", "agent", 1, null),
      msg("c1", "agent", 2, "ana"),
    ]);
    expect(r.semAutoria).toBe(1);
    expect(r.totalEnviadas).toBe(2); // ainda conta no total do time
    expect(r.enviadas.get("ana")).toBe(1);
  });
});

describe("agregarMensagens — tempo de resposta", () => {
  it("credita o tempo a quem de fato respondeu", () => {
    const r = agregarMensagens([
      msg("c1", "customer", 0),
      msg("c1", "agent", 12, "ana"),
    ]);
    expect(r.temposResposta.get("ana")).toEqual([12]);
  });

  it("cinco mensagens do cliente seguidas são UMA espera", () => {
    // Sem isto, um cliente ansioso geraria cinco amostras e afundaria
    // a média do atendente que respondeu uma vez só.
    const r = agregarMensagens([
      msg("c1", "customer", 0),
      msg("c1", "customer", 1),
      msg("c1", "customer", 2),
      msg("c1", "customer", 3),
      msg("c1", "customer", 4),
      msg("c1", "agent", 10, "ana"),
    ]);
    expect(r.temposResposta.get("ana")).toEqual([10]);
  });

  it("mede a partir da PRIMEIRA mensagem não respondida", () => {
    const r = agregarMensagens([
      msg("c1", "customer", 0),
      msg("c1", "customer", 8),
      msg("c1", "agent", 10, "ana"),
    ]);
    // 10 (desde a primeira), não 2 (desde a última).
    expect(r.temposResposta.get("ana")).toEqual([10]);
  });

  it("conta uma nova espera depois de cada resposta", () => {
    const r = agregarMensagens([
      msg("c1", "customer", 0),
      msg("c1", "agent", 5, "ana"),
      msg("c1", "customer", 20),
      msg("c1", "agent", 23, "ana"),
    ]);
    expect(r.temposResposta.get("ana")).toEqual([5, 3]);
  });

  it("resposta do bot zera a espera mas não entra na média de ninguém", () => {
    // Um bot rápido não pode mascarar um time lento.
    const r = agregarMensagens([
      msg("c1", "customer", 0),
      msg("c1", "bot", 1),
      msg("c1", "agent", 60, "ana"),
    ]);
    expect(r.temposResposta.get("ana")).toBeUndefined();
  });

  it("agente sem autoria não recebe crédito de tempo", () => {
    const r = agregarMensagens([
      msg("c1", "customer", 0),
      msg("c1", "agent", 5, null),
    ]);
    expect(r.temposResposta.size).toBe(0);
  });

  it("a espera NÃO atravessa a fronteira entre conversas", () => {
    // As linhas vêm agrupadas por conversa; sem o reset, a pergunta
    // pendente de c1 seria "respondida" pela primeira mensagem de c2 e
    // produziria um tempo inventado.
    const r = agregarMensagens([
      msg("c1", "customer", 0),
      msg("c2", "agent", 500, "ana"),
    ]);
    expect(r.temposResposta.size).toBe(0);
  });

  it("mensagem do agente sem pergunta pendente não gera amostra", () => {
    // Abordagem ativa (o atendente puxa conversa) não é "resposta".
    const r = agregarMensagens([
      msg("c1", "agent", 0, "ana"),
      msg("c1", "agent", 1, "ana"),
    ]);
    expect(r.temposResposta.size).toBe(0);
    expect(r.enviadas.get("ana")).toBe(2);
  });

  it("dois atendentes na mesma conversa recebem cada um o seu", () => {
    const r = agregarMensagens([
      msg("c1", "customer", 0),
      msg("c1", "agent", 4, "ana"),
      msg("c1", "customer", 30),
      msg("c1", "agent", 36, "bruno"),
    ]);
    expect(r.temposResposta.get("ana")).toEqual([4]);
    expect(r.temposResposta.get("bruno")).toEqual([6]);
  });

  it("ignora tempo negativo em vez de subtrair da média", () => {
    // Relógio do webhook fora de sincronia já produziu created_at
    // anterior ao da mensagem que veio antes; um negativo aqui puxaria
    // a média para baixo silenciosamente.
    const r = agregarMensagens([
      { ...msg("c1", "customer", 10) },
      { ...msg("c1", "agent", 5, "ana") },
    ]);
    expect(r.temposResposta.size).toBe(0);
  });
});

describe("agregarMensagens — entrada vazia", () => {
  it("devolve zeros, não erro", () => {
    const r = agregarMensagens([]);
    expect(r.totalEnviadas).toBe(0);
    expect(r.totalRecebidas).toBe(0);
    expect(r.semAutoria).toBe(0);
    expect(r.enviadas.size).toBe(0);
  });
});
