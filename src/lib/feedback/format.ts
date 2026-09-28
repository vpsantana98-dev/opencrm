/**
 * Lógica pura do feedback in-app: o que vira título, o que vira corpo da
 * tarefa, o que é anexo aceitável e quem é o responsável.
 *
 * Tudo aqui é função pura de propósito — é a parte que dá para testar
 * sem ClickUp, sem banco e sem rede, e é onde moram os erros que só
 * apareceriam como "tarefa sem título" ou "corpo com undefined" depois
 * de alguém já ter reportado um problema de verdade.
 */

export type FeedbackKind = "problema" | "ideia" | "outro";

export const FEEDBACK_KINDS: FeedbackKind[] = ["problema", "ideia", "outro"];

export const MENSAGEM_MIN = 10;
export const MENSAGEM_MAX = 4000;
export const ANEXOS_MAX = 3;
export const ANEXO_MAX_BYTES = 5 * 1024 * 1024;

/** Quanto do texto cabe no título antes de cortar. */
const TITULO_MAX = 70;

const ROTULO: Record<FeedbackKind, string> = {
  problema: "Problema",
  ideia: "Ideia",
  outro: "Outro",
};

/** Prioridade do ClickUp: 1 urgente, 2 alta, 3 normal, 4 baixa. */
export function prioridadeDe(kind: FeedbackKind): number {
  // Problema é algo quebrado para alguém agora; ideia e "outro" entram
  // na fila normal.
  return kind === "problema" ? 2 : 3;
}

export function ehFeedbackKind(v: unknown): v is FeedbackKind {
  return typeof v === "string" && (FEEDBACK_KINDS as string[]).includes(v);
}

/**
 * Título da tarefa a partir da mensagem: `[Problema] primeira linha…`.
 *
 * Usa só a PRIMEIRA linha porque quem relata costuma escrever o resumo
 * na primeira e o detalhe embaixo — pegar o texto inteiro encheria o
 * título com o passo a passo.
 *
 * Mensagem vazia ou só espaços tem reserva: tarefa sem título é tarefa
 * que ninguém acha na lista.
 */
export function derivarTitulo(kind: FeedbackKind, mensagem: string): string {
  const rotulo = ROTULO[kind] ?? ROTULO.outro;
  const primeiraLinha = (mensagem ?? "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);

  if (!primeiraLinha) return `[${rotulo}] Sem descrição`;

  const cortado =
    primeiraLinha.length <= TITULO_MAX
      ? primeiraLinha
      : // Corta na última palavra inteira dentro do limite, para o
        // título não terminar no meio de uma palavra. Se não houver
        // espaço (texto colado sem espaços), corta seco.
        (() => {
          const bruto = primeiraLinha.slice(0, TITULO_MAX);
          const ultimoEspaco = bruto.lastIndexOf(" ");
          const base = ultimoEspaco > TITULO_MAX * 0.6
            ? bruto.slice(0, ultimoEspaco)
            : bruto;
          return `${base.trimEnd()}…`;
        })();

  return `[${rotulo}] ${cortado}`;
}

export interface FeedbackContexto {
  rota?: string | null;
  navegador?: string | null;
  sistema?: string | null;
  tela?: string | null;
  tema?: string | null;
  recursoId?: string | null;
}

export interface FeedbackAutor {
  nome?: string | null;
  email?: string | null;
  conta?: string | null;
}

/** Campo ausente vira "?" — nunca a palavra `undefined` no corpo. */
function ou(v: string | null | undefined): string {
  const t = typeof v === "string" ? v.trim() : "";
  return t.length > 0 ? t : "?";
}

/**
 * Corpo da tarefa em markdown.
 *
 * A mensagem vem primeiro e sozinha: é o que a pessoa escreveu, e quem
 * abrir a tarefa precisa ler isso antes de qualquer metadado. As seções
 * de contexto vêm depois, porque respondem "onde/como reproduzir" —
 * importantes, mas só depois de entender o que aconteceu.
 */
export function montarCorpo(
  mensagem: string,
  autor: FeedbackAutor,
  ctx: FeedbackContexto,
): string {
  const texto = (mensagem ?? "").trim() || "_(sem mensagem)_";

  return [
    texto,
    "",
    "---",
    "",
    "### Quem relatou",
    `- **Nome:** ${ou(autor.nome)}`,
    `- **E-mail:** ${ou(autor.email)}`,
    `- **Cliente ativo:** ${ou(autor.conta)}`,
    "",
    "### Onde aconteceu",
    `- **Tela:** ${ou(ctx.rota)}`,
    `- **Recurso aberto:** ${ou(ctx.recursoId)}`,
    "",
    "### Ambiente",
    `- **Navegador:** ${ou(ctx.navegador)}`,
    `- **Sistema:** ${ou(ctx.sistema)}`,
    `- **Tela (resolução):** ${ou(ctx.tela)}`,
    `- **Tema:** ${ou(ctx.tema)}`,
  ].join("\n");
}

/**
 * Tipos de imagem aceitos como anexo.
 *
 * SVG fica de FORA mesmo sendo imagem: é XML, executa script quando
 * aberto no navegador, e o anexo será aberto por quem for atender o
 * chamado. Aceitar seria transformar o canal de feedback em vetor de
 * XSS contra a própria equipe.
 */
const MIMES_ACEITOS = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

export function mimeAceito(mime: string | null | undefined): boolean {
  if (typeof mime !== "string") return false;
  // Corta parâmetros ("image/png; charset=..."), normaliza a caixa.
  const limpo = mime.split(";")[0].trim().toLowerCase();
  return MIMES_ACEITOS.has(limpo);
}

/**
 * Tamanho REAL em bytes de um payload base64.
 *
 * Base64 infla ~33%: validar pelo tamanho da string recusaria arquivos
 * legítimos de ~3,8 MB achando que passam de 5 MB. A conta certa é
 * `len/4*3` descontando o padding `=`.
 */
export function bytesDeBase64(base64: string): number {
  const limpo = (base64 ?? "").replace(/\s/g, "");
  if (!limpo) return 0;
  const padding = limpo.endsWith("==") ? 2 : limpo.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((limpo.length * 3) / 4) - padding);
}

/** Separa `data:image/png;base64,AAAA` em mime + carga. */
export function partesDataUrl(
  dataUrl: string,
): { mime: string; base64: string } | null {
  // `[\s\S]` no lugar de `.` com flag `s`: o alvo de compilação do
  // projeto é anterior a ES2018, onde esse flag não existe.
  const m = /^data:([^;,]+);base64,([\s\S]+)$/.exec((dataUrl ?? "").trim());
  if (!m) return null;
  return { mime: m[1], base64: m[2] };
}

/**
 * Lê os ids de responsável da env var, tolerando lixo.
 *
 * Aceita "123", "123,456", com espaços. Descarta o que não for inteiro
 * positivo — texto, zero, negativo e decimal — porque o ClickUp devolve
 * erro se receber qualquer um deles, e um erro de digitação na env não
 * pode derrubar a criação da tarefa.
 */
export function parseAssignees(raw: string | null | undefined): number[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  const vistos = new Set<number>();
  for (const parte of raw.split(",")) {
    const t = parte.trim();
    // Só dígitos: rejeita "12.5", "-3", "1e3", "abc" antes de converter.
    if (!/^\d+$/.test(t)) continue;
    const n = Number(t);
    if (!Number.isSafeInteger(n) || n <= 0) continue;
    vistos.add(n);
  }
  return [...vistos];
}
