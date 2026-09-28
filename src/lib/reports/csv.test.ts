import { describe, expect, it } from "vitest";

import { bundleParaCSV } from "./csv";
import type { ReportsBundle } from "./types";

function bundle(over: Partial<ReportsBundle> = {}): ReportsBundle {
  return {
    periodo: {
      from: new Date(2026, 4, 1, 0, 0, 0).toISOString(),
      to: new Date(2026, 4, 31, 23, 59, 59).toISOString(),
      dias: 31,
    },
    agentes: [
      {
        userId: "u1",
        nome: "Ana Souza",
        email: "ana@exemplo.com",
        avatarUrl: null,
        papel: "admin",
        mensagensEnviadas: 120,
        conversasAtendidas: 18,
        conversasAtribuidas: 5,
        tempoMedioRespostaMin: 12.34,
        amostrasResposta: 17,
      },
    ],
    totais: {
      mensagensEnviadas: 120,
      mensagensRecebidas: 200,
      conversasNovas: 22,
      contatosNovos: 15,
    },
    mensagensSemAutoria: 0,
    truncado: false,
    ...over,
  };
}

describe("bundleParaCSV — compatibilidade com Excel pt-BR", () => {
  it("começa com BOM, senão o Excel come os acentos", () => {
    expect(bundleParaCSV(bundle()).charCodeAt(0)).toBe(0xfeff);
  });

  it("separa por ';' porque a vírgula é o decimal no pt-BR", () => {
    const csv = bundleParaCSV(bundle());
    const cabecalho = csv.split("\r\n")[0];
    expect(cabecalho).toContain("Atendente;E-mail;Papel;");
  });

  it("escreve o decimal com vírgula", () => {
    expect(bundleParaCSV(bundle())).toContain("12,3");
  });

  it("usa CRLF entre linhas", () => {
    expect(bundleParaCSV(bundle())).toContain("\r\n");
  });
});

describe("bundleParaCSV — escape", () => {
  it("encapsula nome que contém o separador", () => {
    const csv = bundleParaCSV(
      bundle({
        agentes: [
          { ...bundle().agentes[0], nome: "Souza; Ana" },
        ],
      }),
    );
    expect(csv).toContain('"Souza; Ana"');
  });

  it("dobra aspas internas em vez de quebrar a coluna", () => {
    const csv = bundleParaCSV(
      bundle({
        agentes: [{ ...bundle().agentes[0], nome: 'Ana "Aninha" Souza' }],
      }),
    );
    expect(csv).toContain('"Ana ""Aninha"" Souza"');
  });

  it("não encapsula o que não precisa", () => {
    expect(bundleParaCSV(bundle())).toContain("Ana Souza;ana@exemplo.com");
  });
});

describe("bundleParaCSV — honestidade dos números", () => {
  it("deixa a célula VAZIA quando não houve resposta nenhuma", () => {
    // Um "0" aqui viraria "respondeu instantaneamente" no gráfico da
    // planilha e puxaria a média do time para baixo.
    const csv = bundleParaCSV(
      bundle({
        agentes: [
          {
            ...bundle().agentes[0],
            tempoMedioRespostaMin: null,
            amostrasResposta: 0,
          },
        ],
      }),
    );
    const linha = csv.split("\r\n").find((l) => l.startsWith("Ana Souza"))!;
    expect(linha.endsWith(";;0")).toBe(true);
  });

  it("registra as mensagens sem autoria no rodapé", () => {
    const csv = bundleParaCSV(bundle({ mensagensSemAutoria: 42 }));
    expect(csv).toContain("Mensagens sem autoria;42");
  });

  it("omite a linha de sem-autoria quando não há nenhuma", () => {
    expect(bundleParaCSV(bundle())).not.toContain("Mensagens sem autoria");
  });

  it("avisa dentro do arquivo quando o período foi truncado", () => {
    // A planilha circula solta por e-mail, longe da tela que a gerou.
    const csv = bundleParaCSV(bundle({ truncado: true }));
    expect(csv).toContain("ATENÇÃO");
    expect(csv).toContain("amostra");
  });

  it("leva o período junto para o arquivo se explicar sozinho", () => {
    expect(bundleParaCSV(bundle())).toContain("Período;01/05/2026 a 31/05/2026");
  });
});
