import { describe, expect, it } from "vitest";

import {
  montarPendencias,
  type ContaOverview,
  type ConversaAberta,
} from "./pendencias";

const AGORA = new Date("2026-08-12T15:00:00.000Z");

function conta(over: Partial<ContaOverview> = {}): ContaOverview {
  return {
    account_id: "a1",
    account_name: "Cliente A",
    whatsapp_connected: true,
    ...over,
  };
}

/** Conversa aberta; `minAtras` = há quantos minutos foi a última msg. */
function conversa(
  over: Partial<ConversaAberta> = {},
  minAtras = 0,
): ConversaAberta {
  return {
    account_id: "a1",
    assigned_agent_id: "ag1",
    unread_count: 0,
    last_message_at: new Date(AGORA.getTime() - minAtras * 60_000).toISOString(),
    ...over,
  };
}

describe("montarPendencias — WhatsApp", () => {
  it("desconectado é pendência", () => {
    const r = montarPendencias([conta({ whatsapp_connected: false })], [], AGORA);
    expect(r.clientes).toHaveLength(1);
    expect(r.clientes[0].whatsappCaido).toBe(true);
  });

  it("conectado não é pendência", () => {
    expect(montarPendencias([conta()], [], AGORA).clientes).toHaveLength(0);
  });

  it("NUNCA configurado não conta como queda", () => {
    // `null` = cliente que ainda não ligou o WhatsApp. Não dá para
    // "cair" o que nunca subiu — e acusar isso encheria a faixa de
    // cliente recém-criado, ensinando o usuário a ignorá-la.
    const r = montarPendencias([conta({ whatsapp_connected: null })], [], AGORA);
    expect(r.clientes).toHaveLength(0);
  });
});

describe("montarPendencias — cliente esperando", () => {
  it("conta quando passou do limite e há mensagem não lida", () => {
    const r = montarPendencias(
      [conta()],
      [conversa({ unread_count: 2 }, 90)],
      AGORA,
    );
    expect(r.clientes[0].esperando).toBe(1);
  });

  it("NÃO conta antes do limite", () => {
    const r = montarPendencias(
      [conta()],
      [conversa({ unread_count: 2 }, 30)],
      AGORA,
    );
    expect(r.clientes).toHaveLength(0);
  });

  it("exatamente no limite já conta", () => {
    const r = montarPendencias(
      [conta()],
      [conversa({ unread_count: 1 }, 60)],
      AGORA,
    );
    expect(r.clientes[0].esperando).toBe(1);
  });

  it("sem mensagem não lida não é espera, por mais antiga que seja", () => {
    // Conversa parada há dias mas já respondida: a bola está com o
    // cliente, não com a equipe.
    const r = montarPendencias(
      [conta()],
      [conversa({ unread_count: 0 }, 60 * 24 * 3)],
      AGORA,
    );
    expect(r.clientes).toHaveLength(0);
  });

  it("respeita um limite customizado", () => {
    const conv = [conversa({ unread_count: 1 }, 20)];
    expect(montarPendencias([conta()], conv, AGORA, 60).clientes).toHaveLength(0);
    expect(montarPendencias([conta()], conv, AGORA, 15).clientes[0].esperando).toBe(1);
  });

  it("last_message_at nulo não quebra nem conta", () => {
    const r = montarPendencias(
      [conta()],
      [conversa({ unread_count: 5, last_message_at: null })],
      AGORA,
    );
    expect(r.clientes).toHaveLength(0);
  });
});

describe("montarPendencias — sem responsável", () => {
  it("conversa aberta sem agente é pendência", () => {
    const r = montarPendencias(
      [conta()],
      [conversa({ assigned_agent_id: null })],
      AGORA,
    );
    expect(r.clientes[0].semResponsavel).toBe(1);
  });

  it("uma conversa pode ser as DUAS coisas ao mesmo tempo", () => {
    const r = montarPendencias(
      [conta()],
      [conversa({ assigned_agent_id: null, unread_count: 1 }, 120)],
      AGORA,
    );
    expect(r.clientes[0]).toMatchObject({ esperando: 1, semResponsavel: 1 });
  });
});

describe("montarPendencias — agregação e ordem", () => {
  it("separa por cliente", () => {
    const r = montarPendencias(
      [
        conta({ account_id: "a1", account_name: "A" }),
        conta({ account_id: "a2", account_name: "B" }),
      ],
      [
        conversa({ account_id: "a1", assigned_agent_id: null }),
        conversa({ account_id: "a2", assigned_agent_id: null }),
        conversa({ account_id: "a2", assigned_agent_id: null }),
      ],
      AGORA,
    );
    expect(r.clientes.find((c) => c.nome === "A")!.semResponsavel).toBe(1);
    expect(r.clientes.find((c) => c.nome === "B")!.semResponsavel).toBe(2);
  });

  it("WhatsApp caído vem antes de quem tem mais gente esperando", () => {
    // Um WhatsApp fora do ar impede QUALQUER atendimento; fila grande
    // ainda está sendo atendida. A ordem reflete essa diferença.
    const r = montarPendencias(
      [
        conta({ account_id: "a1", account_name: "Fila", whatsapp_connected: true }),
        conta({ account_id: "a2", account_name: "Caiu", whatsapp_connected: false }),
      ],
      Array.from({ length: 10 }, () =>
        conversa({ account_id: "a1", unread_count: 1 }, 120),
      ),
      AGORA,
    );
    expect(r.clientes[0].nome).toBe("Caiu");
  });

  it("cliente sem nenhuma pendência fica FORA da lista", () => {
    const r = montarPendencias(
      [
        conta({ account_id: "a1", account_name: "Ok" }),
        conta({ account_id: "a2", account_name: "Problema", whatsapp_connected: false }),
      ],
      [],
      AGORA,
    );
    expect(r.clientes.map((c) => c.nome)).toEqual(["Problema"]);
  });

  it("nada acontecendo devolve lista vazia", () => {
    expect(montarPendencias([conta()], [conversa()], AGORA).clientes).toEqual([]);
  });
});
