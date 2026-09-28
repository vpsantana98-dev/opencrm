// ============================================================
// Decisão pura do middleware para usuários com senha temporária
// (app_metadata.must_change_password = true, gravada pelo admin
// na criação — só a service role escreve app_metadata, o próprio
// usuário não consegue limpar a flag).
//
// Extraída do middleware para ser testável sem NextRequest.
// ============================================================

export type MustChangeDecision = "allow" | "redirect" | "forbid";

interface UserLike {
  app_metadata?: Record<string, unknown>;
}

const EXEMPT_PAGES = new Set(["/trocar-senha"]);
const EXEMPT_APIS = new Set(["/api/auth/change-password"]);
// O callback precisa passar para o fluxo de recovery conseguir
// estabelecer a sessão ANTES de cair em /trocar-senha.
const EXEMPT_PREFIXES = ["/auth/callback"];

export function resolveMustChangePassword(
  user: UserLike | null,
  pathname: string,
): MustChangeDecision {
  if (!user || user.app_metadata?.must_change_password !== true) {
    return "allow";
  }
  if (EXEMPT_PAGES.has(pathname)) return "allow";
  if (EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return "allow";
  }
  if (pathname.startsWith("/api/")) {
    return EXEMPT_APIS.has(pathname) ? "allow" : "forbid";
  }
  return "redirect";
}
