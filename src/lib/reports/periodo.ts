/**
 * Períodos do relatório.
 *
 * Tudo aqui trabalha no fuso de QUEM está olhando. "Últimos 30 dias"
 * para um usuário em São Paulo não é o mesmo intervalo absoluto que
 * para um em Lisboa, e o servidor não tem como saber qual dos dois é —
 * por isso a tela calcula o recorte e manda ISO pronto para a API.
 */

export type PeriodoId = "7d" | "30d" | "90d" | "mes" | "mes_passado";

export const PERIODOS: { id: PeriodoId; label: string }[] = [
  { id: "7d", label: "7 dias" },
  { id: "30d", label: "30 dias" },
  { id: "90d", label: "90 dias" },
  { id: "mes", label: "Este mês" },
  { id: "mes_passado", label: "Mês passado" },
];

export interface Intervalo {
  from: Date;
  to: Date;
}

/** Meia-noite local do dia de `d`. */
function inicioDoDia(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

/** Último instante do dia de `d` — o `to` precisa incluir o dia inteiro. */
function fimDoDia(d: Date): Date {
  const c = new Date(d);
  c.setHours(23, 59, 59, 999);
  return c;
}

export function intervaloDe(periodo: PeriodoId, agora = new Date()): Intervalo {
  switch (periodo) {
    case "7d":
    case "30d":
    case "90d": {
      const dias = Number(periodo.replace("d", ""));
      const from = inicioDoDia(agora);
      // -(dias - 1): "7 dias" inclui hoje, então volta 6. Sem o -1 o
      // recorte pega 8 dias e não bate com o rótulo.
      from.setDate(from.getDate() - (dias - 1));
      return { from, to: fimDoDia(agora) };
    }
    case "mes": {
      const from = inicioDoDia(agora);
      from.setDate(1);
      return { from, to: fimDoDia(agora) };
    }
    case "mes_passado": {
      const from = inicioDoDia(agora);
      from.setDate(1);
      from.setMonth(from.getMonth() - 1);
      // Dia 0 do mês seguinte = último dia do mês anterior. Evita a
      // tabela de "quantos dias tem cada mês" e acerta fevereiro
      // bissexto de graça.
      const to = new Date(from.getFullYear(), from.getMonth() + 1, 0);
      return { from, to: fimDoDia(to) };
    }
  }
}

/** Rótulo curto do intervalo, para cabeçalho e nome de arquivo. */
export function rotuloIntervalo(i: Intervalo): string {
  const f = (d: Date) =>
    d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  return `${f(i.from)} a ${f(i.to)}`;
}

/** Minutos → "3 min", "1 h 20 min", "2 d 4 h". */
export function formatarDuracao(minutos: number | null): string {
  if (minutos === null) return "—";
  if (minutos < 1) return "< 1 min";
  if (minutos < 60) return `${Math.round(minutos)} min`;
  const horas = minutos / 60;
  if (horas < 24) {
    const h = Math.floor(horas);
    const m = Math.round(minutos - h * 60);
    return m === 0 ? `${h} h` : `${h} h ${m} min`;
  }
  const dias = Math.floor(horas / 24);
  const h = Math.round(horas - dias * 24);
  return h === 0 ? `${dias} d` : `${dias} d ${h} h`;
}
