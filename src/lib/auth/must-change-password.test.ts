import { describe, expect, it } from "vitest";
import { resolveMustChangePassword } from "./must-change-password";

const flagged = { app_metadata: { must_change_password: true } };

describe("resolveMustChangePassword", () => {
  it("permite tudo sem usuário (rotas públicas, webhooks)", () => {
    expect(resolveMustChangePassword(null, "/dashboard")).toBe("allow");
    expect(resolveMustChangePassword(null, "/api/whatsapp/webhook")).toBe("allow");
  });

  it("permite tudo para usuário sem a flag", () => {
    expect(resolveMustChangePassword({ app_metadata: {} }, "/dashboard")).toBe("allow");
    expect(
      resolveMustChangePassword({ app_metadata: { must_change_password: false } }, "/inbox"),
    ).toBe("allow");
    // Sem app_metadata nenhum (defensivo)
    expect(resolveMustChangePassword({}, "/dashboard")).toBe("allow");
  });

  it("redireciona páginas quando a flag está ligada", () => {
    expect(resolveMustChangePassword(flagged, "/dashboard")).toBe("redirect");
    expect(resolveMustChangePassword(flagged, "/inbox")).toBe("redirect");
    expect(resolveMustChangePassword(flagged, "/login")).toBe("redirect");
    expect(resolveMustChangePassword(flagged, "/")).toBe("redirect");
  });

  it("bloqueia APIs com 403 quando a flag está ligada", () => {
    expect(resolveMustChangePassword(flagged, "/api/contacts")).toBe("forbid");
    expect(resolveMustChangePassword(flagged, "/api/whatsapp/send")).toBe("forbid");
  });

  it("isenta a própria página de troca, a rota de troca e o callback de auth", () => {
    expect(resolveMustChangePassword(flagged, "/trocar-senha")).toBe("allow");
    expect(resolveMustChangePassword(flagged, "/api/auth/change-password")).toBe("allow");
    expect(resolveMustChangePassword(flagged, "/auth/callback")).toBe("allow");
  });
});
