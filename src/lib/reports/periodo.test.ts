import { describe, expect, it } from "vitest";

import { formatarDuracao, intervaloDe, rotuloIntervalo } from "./periodo";

// Uma quarta-feira qualquer, meio do dia, meio do mês — longe de
// virada de mês/ano para os casos normais não dependerem de sorte.
const AGORA = new Date(2026, 4, 20, 14, 30, 0); // 20/mai/2026

describe("intervaloDe — janelas de N dias", () => {
  it("inclui HOJE na contagem (7 dias = hoje + 6 anteriores)", () => {
    const { from, to } = intervaloDe("7d", AGORA);
    expect(from.getDate()).toBe(14);
    expect(to.getDate()).toBe(20);
    // O erro clássico aqui é voltar 7 dias e pegar 8 dias de dado.
    const dias = Math.round((to.getTime() - from.getTime()) / 86_400_000);
    expect(dias).toBe(7);
  });

  it("abre no primeiro instante do dia e fecha no último", () => {
    const { from, to } = intervaloDe("30d", AGORA);
    expect([from.getHours(), from.getMinutes(), from.getSeconds()]).toEqual([0, 0, 0]);
    expect([to.getHours(), to.getMinutes(), to.getSeconds()]).toEqual([23, 59, 59]);
  });

  it("atravessa a virada de mês", () => {
    const { from } = intervaloDe("7d", new Date(2026, 5, 2, 10, 0, 0)); // 02/jun
    expect(from.getMonth()).toBe(4); // maio
    expect(from.getDate()).toBe(27);
  });
});

describe("intervaloDe — mês corrente e anterior", () => {
  it("'este mês' começa no dia 1 e termina hoje", () => {
    const { from, to } = intervaloDe("mes", AGORA);
    expect(from.getDate()).toBe(1);
    expect(from.getMonth()).toBe(4);
    expect(to.getDate()).toBe(20);
  });

  it("'mês passado' cobre o mês inteiro, não até o dia de hoje", () => {
    const { from, to } = intervaloDe("mes_passado", AGORA);
    expect(from.getMonth()).toBe(3); // abril
    expect(from.getDate()).toBe(1);
    expect(to.getMonth()).toBe(3);
    expect(to.getDate()).toBe(30); // abril tem 30
  });

  it("acerta fevereiro em ano bissexto", () => {
    // Março de 2024: o mês passado é fevereiro, que teve 29 dias.
    const { to } = intervaloDe("mes_passado", new Date(2024, 2, 10, 9, 0, 0));
    expect(to.getMonth()).toBe(1);
    expect(to.getDate()).toBe(29);
  });

  it("volta de janeiro para dezembro do ano anterior", () => {
    const { from, to } = intervaloDe("mes_passado", new Date(2026, 0, 15, 9, 0, 0));
    expect(from.getFullYear()).toBe(2025);
    expect(from.getMonth()).toBe(11);
    expect(to.getDate()).toBe(31);
  });
});

describe("formatarDuracao", () => {
  it("distingue 'nunca respondeu' de 'respondeu na hora'", () => {
    // Esta é a razão de o tipo ser `number | null`: os dois casos
    // apareciam como "0 min" antes e significam coisas opostas.
    expect(formatarDuracao(null)).toBe("—");
    expect(formatarDuracao(0)).toBe("< 1 min");
  });

  it("usa minutos, horas e dias conforme a grandeza", () => {
    expect(formatarDuracao(45)).toBe("45 min");
    expect(formatarDuracao(60)).toBe("1 h");
    expect(formatarDuracao(80)).toBe("1 h 20 min");
    expect(formatarDuracao(60 * 24)).toBe("1 d");
    expect(formatarDuracao(60 * 28)).toBe("1 d 4 h");
  });
});

describe("rotuloIntervalo", () => {
  it("mostra dia/mês nas duas pontas", () => {
    expect(rotuloIntervalo(intervaloDe("7d", AGORA))).toBe("14/05 a 20/05");
  });
});
