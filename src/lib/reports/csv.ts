import type { ReportsBundle } from "./types";

/**
 * Serialização do relatório para planilha.
 *
 * Duas escolhas aqui existem só por causa do Excel em português, e sem
 * elas o arquivo abre quebrado na máquina de quem vai usar:
 *
 *  1. Separador `;` em vez de `,`. O Excel pt-BR usa a vírgula como
 *     separador DECIMAL, então um CSV com vírgula chega com todas as
 *     colunas empilhadas numa só.
 *  2. BOM no início. Sem ele o Excel lê o arquivo como Latin-1 e todo
 *     acento vira caractere estranho ("Joao Silva" fica legível, mas
 *     "Conversas atribuídas" não).
 *
 * O Google Sheets e o LibreOffice detectam os dois casos sozinhos, então
 * a escolha não prejudica quem não usa Excel.
 */

const SEP = ";";
const BOM = "﻿";

/** Escapa um campo para CSV: aspas ao redor e aspas internas dobradas. */
function campo(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined) return "";
  const s = String(valor);
  // Só encapsula quando precisa — arquivo menor e mais legível a olho.
  if (s.includes(SEP) || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Número com vírgula decimal, como o Excel pt-BR espera. */
function numeroBR(n: number, casas: number): string {
  return n.toFixed(casas).replace(".", ",");
}

const PAPEL_LABEL: Record<string, string> = {
  owner: "Proprietário",
  admin: "Admin",
  agent: "Agente",
  viewer: "Visualizador",
};

export function bundleParaCSV(bundle: ReportsBundle): string {
  const linhas: string[] = [];

  const cabecalho = [
    "Atendente",
    "E-mail",
    "Papel",
    "Mensagens enviadas",
    "Conversas atendidas",
    "Conversas atribuídas",
    "Tempo médio de resposta (min)",
    "Amostras de resposta",
  ];
  linhas.push(cabecalho.map(campo).join(SEP));

  for (const a of bundle.agentes) {
    linhas.push(
      [
        campo(a.nome),
        campo(a.email ?? ""),
        campo(a.papel ? (PAPEL_LABEL[a.papel] ?? a.papel) : ""),
        campo(a.mensagensEnviadas),
        campo(a.conversasAtendidas),
        campo(a.conversasAtribuidas),
        // Célula vazia, não "0": nunca ter respondido é diferente de
        // responder instantaneamente, e num gráfico de planilha um zero
        // falso puxaria a média do time para baixo.
        campo(
          a.tempoMedioRespostaMin === null
            ? ""
            : numeroBR(a.tempoMedioRespostaMin, 1),
        ),
        campo(a.amostrasResposta),
      ].join(SEP),
    );
  }

  // Rodapé com o contexto do recorte. Vai DENTRO do arquivo porque a
  // planilha costuma ser reenviada por e-mail solta, longe da tela que
  // a gerou — sem isto ninguém sabe de que período ela fala, nem que
  // parte do total ficou sem autoria.
  const dia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");
  linhas.push("");
  linhas.push(
    [campo("Período"), campo(`${dia(bundle.periodo.from)} a ${dia(bundle.periodo.to)}`)].join(SEP),
  );
  linhas.push(
    [campo("Mensagens enviadas (total)"), campo(bundle.totais.mensagensEnviadas)].join(SEP),
  );
  linhas.push(
    [campo("Mensagens recebidas (total)"), campo(bundle.totais.mensagensRecebidas)].join(SEP),
  );
  linhas.push([campo("Conversas novas"), campo(bundle.totais.conversasNovas)].join(SEP));
  linhas.push([campo("Contatos novos"), campo(bundle.totais.contatosNovos)].join(SEP));

  if (bundle.mensagensSemAutoria > 0) {
    linhas.push(
      [
        campo("Mensagens sem autoria"),
        campo(bundle.mensagensSemAutoria),
        campo("Enviadas antes do registro de autor, ou pela API pública. Não somam para nenhum atendente."),
      ].join(SEP),
    );
  }
  if (bundle.truncado) {
    linhas.push(
      [
        campo("ATENÇÃO"),
        campo("Período grande demais: os números são uma amostra, não o total."),
      ].join(SEP),
    );
  }

  return BOM + linhas.join("\r\n");
}
