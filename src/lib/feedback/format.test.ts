import { describe, expect, it } from "vitest";

import {
  bytesDeBase64,
  derivarTitulo,
  mimeAceito,
  montarCorpo,
  parseAssignees,
  partesDataUrl,
  prioridadeDe,
} from "./format";

describe("derivarTitulo", () => {
  it("prefixa com o tipo", () => {
    expect(derivarTitulo("problema", "O botão não salva")).toBe(
      "[Problema] O botão não salva",
    );
    expect(derivarTitulo("ideia", "Filtrar por data")).toBe(
      "[Ideia] Filtrar por data",
    );
  });

  it("usa só a PRIMEIRA linha", () => {
    // Quem relata escreve o resumo na primeira linha e o passo a passo
    // embaixo; o título não pode virar o roteiro inteiro.
    const t = derivarTitulo(
      "problema",
      "Não consigo excluir cliente\n\nPassos:\n1. Abrir Clientes\n2. Clicar em excluir",
    );
    expect(t).toBe("[Problema] Não consigo excluir cliente");
  });

  it("ignora linhas vazias no começo", () => {
    expect(derivarTitulo("outro", "\n\n  Sugestão de cor  ")).toBe(
      "[Outro] Sugestão de cor",
    );
  });

  it("corta texto longo e marca com reticências", () => {
    const longo =
      "Quando eu tento mover um negócio de uma etapa para outra no funil de vendas o sistema trava";
    const t = derivarTitulo("problema", longo);
    expect(t.length).toBeLessThanOrEqual("[Problema] ".length + 71);
    expect(t.endsWith("…")).toBe(true);
  });

  it("corta em palavra inteira, nao no meio", () => {
    const longo =
      "Quando eu tento mover um negocio de uma etapa para outra o sistema trava sempre";
    const t = derivarTitulo("problema", longo).replace("[Problema] ", "");
    // Sem o "…", o texto tem que bater com um prefixo do original
    // terminando em palavra completa.
    const semRetic = t.slice(0, -1);
    expect(longo.startsWith(semRetic)).toBe(true);
    expect(semRetic.endsWith(" ")).toBe(false);
  });

  it("texto colado sem espacos ainda corta", () => {
    const semEspaco = "a".repeat(200);
    const t = derivarTitulo("problema", semEspaco);
    expect(t.endsWith("…")).toBe(true);
    expect(t.length).toBeLessThan(90);
  });

  it("mensagem vazia tem reserva — nunca titulo em branco", () => {
    // Tarefa sem título é tarefa que ninguém acha na lista.
    expect(derivarTitulo("problema", "")).toBe("[Problema] Sem descrição");
    expect(derivarTitulo("ideia", "   \n  \n ")).toBe("[Ideia] Sem descrição");
  });
});

describe("montarCorpo", () => {
  it("a mensagem vem primeiro", () => {
    const corpo = montarCorpo("Está quebrado", {}, {});
    expect(corpo.startsWith("Está quebrado")).toBe(true);
  });

  it("campos ausentes viram ? e NUNCA undefined", () => {
    const corpo = montarCorpo("teste", {}, {});
    expect(corpo).not.toContain("undefined");
    expect(corpo).not.toContain("null");
    expect(corpo).toContain("**Nome:** ?");
    expect(corpo).toContain("**Navegador:** ?");
  });

  it("string vazia tambem vira ?", () => {
    const corpo = montarCorpo("x", { nome: "   ", email: "" }, { rota: "" });
    expect(corpo).toContain("**Nome:** ?");
    expect(corpo).toContain("**E-mail:** ?");
    expect(corpo).toContain("**Tela:** ?");
  });

  it("preenche o que existe", () => {
    const corpo = montarCorpo(
      "não salva",
      { nome: "Ana", email: "ana@x.com", conta: "Padaria" },
      { rota: "/pipelines?id=7", navegador: "Chrome/120", tema: "dark" },
    );
    expect(corpo).toContain("**Nome:** Ana");
    expect(corpo).toContain("**Cliente ativo:** Padaria");
    expect(corpo).toContain("**Tela:** /pipelines?id=7");
    expect(corpo).toContain("**Tema:** dark");
  });

  it("mensagem vazia nao deixa o corpo comecar em branco", () => {
    expect(montarCorpo("", {}, {})).toContain("_(sem mensagem)_");
  });
});

describe("mimeAceito", () => {
  it("aceita os formatos de imagem comuns", () => {
    for (const m of ["image/png", "image/jpeg", "image/webp", "image/gif"]) {
      expect(mimeAceito(m)).toBe(true);
    }
  });

  it("RECUSA SVG mesmo sendo imagem", () => {
    // SVG e XML e executa script quando aberto no navegador. O anexo vai
    // ser aberto por quem atender o chamado — aceitar seria transformar
    // o canal de feedback em vetor de XSS contra a propria equipe.
    expect(mimeAceito("image/svg+xml")).toBe(false);
    expect(mimeAceito("IMAGE/SVG+XML")).toBe(false);
    expect(mimeAceito("image/svg+xml; charset=utf-8")).toBe(false);
  });

  it("recusa o que nao e imagem", () => {
    expect(mimeAceito("application/pdf")).toBe(false);
    expect(mimeAceito("text/html")).toBe(false);
    expect(mimeAceito("video/mp4")).toBe(false);
  });

  it("ignora parametro e caixa", () => {
    expect(mimeAceito("IMAGE/PNG")).toBe(true);
    expect(mimeAceito("image/png; charset=binary")).toBe(true);
  });

  it("entrada invalida e recusada em vez de estourar", () => {
    expect(mimeAceito(null)).toBe(false);
    expect(mimeAceito(undefined)).toBe(false);
    expect(mimeAceito("")).toBe(false);
  });
});

describe("bytesDeBase64", () => {
  it("calcula o tamanho REAL, nao o da string", () => {
    // "AAAA" (4 chars) = 3 bytes. Medir pela string inflaria 33%.
    expect(bytesDeBase64("AAAA")).toBe(3);
  });

  it("desconta o padding", () => {
    expect(bytesDeBase64("AA==")).toBe(1);
    expect(bytesDeBase64("AAA=")).toBe(2);
  });

  it("um arquivo de ~3,8 MB NAO e recusado como se tivesse 5 MB", () => {
    // O erro que este calculo evita: 5 MB de base64 representam ~3,75 MB
    // reais. Medir pela string recusaria arquivos legitimos.
    const base64De4MB = "A".repeat(Math.ceil((4 * 1024 * 1024 * 4) / 3));
    expect(bytesDeBase64(base64De4MB)).toBeLessThanOrEqual(5 * 1024 * 1024);
    expect(bytesDeBase64(base64De4MB)).toBeGreaterThan(3.9 * 1024 * 1024);
  });

  it("ignora quebras de linha", () => {
    expect(bytesDeBase64("AA\nAA")).toBe(3);
  });

  it("vazio e zero", () => {
    expect(bytesDeBase64("")).toBe(0);
  });
});

describe("partesDataUrl", () => {
  it("separa mime e carga", () => {
    expect(partesDataUrl("data:image/png;base64,AAAA")).toEqual({
      mime: "image/png",
      base64: "AAAA",
    });
  });

  it("aceita carga com quebras de linha", () => {
    expect(partesDataUrl("data:image/png;base64,AA\nAA")?.base64).toBe("AA\nAA");
  });

  it("recusa o que nao e data URL", () => {
    expect(partesDataUrl("https://exemplo.com/a.png")).toBeNull();
    expect(partesDataUrl("data:image/png,AAAA")).toBeNull();
    expect(partesDataUrl("")).toBeNull();
  });
});

describe("parseAssignees", () => {
  it("le um id", () => {
    expect(parseAssignees("123")).toEqual([123]);
  });

  it("le varios separados por virgula, com espacos", () => {
    expect(parseAssignees(" 123 , 456 ")).toEqual([123, 456]);
  });

  it("descarta texto, zero, negativo e decimal", () => {
    // Um erro de digitacao na env nao pode derrubar a criacao da tarefa:
    // o ClickUp devolve erro para qualquer um destes.
    expect(parseAssignees("abc")).toEqual([]);
    expect(parseAssignees("0")).toEqual([]);
    expect(parseAssignees("-5")).toEqual([]);
    expect(parseAssignees("12.5")).toEqual([]);
    expect(parseAssignees("1e3")).toEqual([]);
  });

  it("mantem os validos e descarta os invalidos na mesma lista", () => {
    expect(parseAssignees("123,abc,0,456")).toEqual([123, 456]);
  });

  it("nao repete id duplicado", () => {
    expect(parseAssignees("123,123")).toEqual([123]);
  });

  it("ausente ou vazio devolve lista vazia", () => {
    expect(parseAssignees(null)).toEqual([]);
    expect(parseAssignees(undefined)).toEqual([]);
    expect(parseAssignees("   ")).toEqual([]);
    expect(parseAssignees(",,,")).toEqual([]);
  });
});

describe("prioridadeDe", () => {
  it("problema e alta; ideia e outro sao normais", () => {
    expect(prioridadeDe("problema")).toBe(2);
    expect(prioridadeDe("ideia")).toBe(3);
    expect(prioridadeDe("outro")).toBe(3);
  });
});
