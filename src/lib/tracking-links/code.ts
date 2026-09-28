// ============================================================
// Código curto dos links rastreáveis (/t/<code>), estilo SgK5PPPw.
// Base62, aleatoriedade criptográfica com rejection sampling (sem
// viés do módulo). Roda no browser (modal) e no Node (testes):
// globalThis.crypto existe nos dois.
// ============================================================

const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export const LINK_CODE_LENGTH = 8;

// Maior múltiplo de 62 abaixo de 256; bytes acima são descartados
// para a distribuição ficar uniforme.
const MAX_UNBIASED = 248;

export function generateLinkCode(): string {
  let out = '';
  while (out.length < LINK_CODE_LENGTH) {
    const bytes = new Uint8Array(LINK_CODE_LENGTH * 2);
    globalThis.crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (out.length >= LINK_CODE_LENGTH) break;
      if (b < MAX_UNBIASED) out += ALPHABET[b % ALPHABET.length];
    }
  }
  return out;
}
