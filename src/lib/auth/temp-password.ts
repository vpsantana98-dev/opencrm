// ============================================================
// Senha temporária para usuários criados pelo admin da
// plataforma. Gerada no servidor, exibida UMA vez na tela e
// nunca persistida fora do hash do próprio Supabase Auth.
//
// Alfabeto sem confundíveis (I/l/O/0/1) porque a senha é
// transmitida ao cliente por canal humano (WhatsApp, e-mail)
// e pode acabar digitada à mão.
// ============================================================
import { randomInt } from "node:crypto";

const UPPER = "ABCDEFGHJKMNPQRSTUVWXYZ"; // sem I, L, O
const LOWER = "abcdefghijkmnpqrstuvwxyz"; // sem l
const DIGITS = "23456789";
const SYMBOLS = "!@#$%&*+-=?";
const ALL = UPPER + LOWER + DIGITS + SYMBOLS;

export const TEMP_PASSWORD_LENGTH = 16;

function pick(alphabet: string): string {
  return alphabet[randomInt(alphabet.length)];
}

export function generateTempPassword(): string {
  // Garante uma amostra de cada classe; o resto vem do alfabeto
  // completo. Embaralha com Fisher-Yates para a posição das
  // classes garantidas não ser previsível.
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < TEMP_PASSWORD_LENGTH) {
    chars.push(pick(ALL));
  }
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
