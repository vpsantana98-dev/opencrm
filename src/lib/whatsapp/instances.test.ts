import { describe, expect, it } from "vitest";

import {
  escolherPadrao,
  escolherParaConversa,
  resumo,
  type EvolutionInstance,
} from "./instances";

function inst(over: Partial<EvolutionInstance> = {}): EvolutionInstance {
  return {
    id: "i1",
    account_id: "a1",
    instance_name: "inst-1",
    status: "connected",
    phone: "+5531999998888",
    label: null,
    is_default: false,
    ...over,
  };
}

describe("escolherPadrao", () => {
  it("sem numeros devolve null", () => {
    expect(escolherPadrao([])).toBeNull();
  });

  it("prefere o padrao CONECTADO", () => {
    const escolhido = escolherPadrao([
      inst({ id: "a", is_default: false, status: "connected" }),
      inst({ id: "b", is_default: true, status: "connected" }),
    ]);
    expect(escolhido?.id).toBe("b");
  });

  it("padrao caido perde para outro no ar", () => {
    // Um padrao desconectado nao pode travar o envio quando existe
    // outro numero funcionando.
    const escolhido = escolherPadrao([
      inst({ id: "a", is_default: true, status: "disconnected" }),
      inst({ id: "b", is_default: false, status: "connected" }),
    ]);
    expect(escolhido?.id).toBe("b");
  });

  it("todos caidos: devolve o padrao mesmo assim", () => {
    // Melhor tentar pelo padrao e falhar com erro claro do que nao
    // escolher nada e falhar com "sem numero".
    const escolhido = escolherPadrao([
      inst({ id: "a", is_default: false, status: "disconnected" }),
      inst({ id: "b", is_default: true, status: "disconnected" }),
    ]);
    expect(escolhido?.id).toBe("b");
  });

  it("nenhum padrao e nenhum conectado: cai no primeiro", () => {
    const escolhido = escolherPadrao([
      inst({ id: "a", is_default: false, status: "disconnected" }),
      inst({ id: "b", is_default: false, status: "disconnected" }),
    ]);
    expect(escolhido?.id).toBe("a");
  });
});

describe("escolherParaConversa", () => {
  const numeros = [
    inst({ id: "vendas", is_default: true }),
    inst({ id: "suporte", is_default: false }),
  ];

  it("a resposta sai pelo numero DA conversa", () => {
    // O ponto do recurso: quem escreveu para o Suporte recebe resposta
    // do Suporte, nao do Vendas.
    expect(escolherParaConversa(numeros, "suporte")?.id).toBe("suporte");
  });

  it("conversa sem numero cai no padrao", () => {
    // Conversas anteriores a esta mudanca nao tem numero atribuido.
    expect(escolherParaConversa(numeros, null)?.id).toBe("vendas");
  });

  it("numero da conversa que nao existe mais cai no padrao", () => {
    // Numero desconectado e removido: melhor responder por outro do que
    // nao responder.
    expect(escolherParaConversa(numeros, "apagado")?.id).toBe("vendas");
  });

  it("sem numero nenhum devolve null em vez de estourar", () => {
    expect(escolherParaConversa([], "qualquer")).toBeNull();
  });
});

describe("resumo", () => {
  it("conta total e conectados", () => {
    expect(
      resumo([
        inst({ status: "connected" }),
        inst({ status: "disconnected" }),
        inst({ status: "connected" }),
      ]),
    ).toEqual({ total: 3, conectados: 2 });
  });

  it("lista vazia", () => {
    expect(resumo([])).toEqual({ total: 0, conectados: 0 });
  });
});
