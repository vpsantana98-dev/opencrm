// src/app/api/admin/users/route.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth/account";

// ---- Knobs -----------------------------------------------------------------
let requireAdminError: Error | null = null;
const createUser = vi.fn();
const accountUpdateEq = vi.fn();

vi.mock("@/lib/auth/platform-admin", () => ({
  requirePlatformAdmin: async () => {
    if (requireAdminError) throw requireAdminError;
  },
}));

vi.mock("@/lib/auth/admin-client", () => ({
  supabaseAdmin: () => ({
    auth: { admin: { createUser } },
    from: () => ({ update: () => ({ eq: accountUpdateEq }) }),
  }),
}));

const { POST } = await import("./route");

function post(body: unknown): Request {
  return new Request("https://app.test/api/admin/users", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  full_name: "Cliente Exemplo",
  email: "cliente@exemplo.com",
  account_name: "Empresa Exemplo",
};

beforeEach(() => {
  requireAdminError = null;
  createUser.mockReset().mockResolvedValue({
    data: { user: { id: "new-user-id" } },
    error: null,
  });
  accountUpdateEq.mockReset().mockResolvedValue({ error: null });
});

describe("POST /api/admin/users", () => {
  it("401 sem sessão", async () => {
    requireAdminError = new UnauthorizedError();
    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(401);
    expect(createUser).not.toHaveBeenCalled();
  });

  it("403 fora da allowlist", async () => {
    requireAdminError = new ForbiddenError();
    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(403);
    expect(createUser).not.toHaveBeenCalled();
  });

  it("400 quando faltam campos ou o e-mail é inválido", async () => {
    for (const body of [
      { ...VALID_BODY, full_name: "  " },
      { ...VALID_BODY, account_name: "" },
      { ...VALID_BODY, email: "nao-e-email" },
      {},
    ]) {
      const res = await POST(post(body));
      expect(res.status).toBe(400);
    }
    expect(createUser).not.toHaveBeenCalled();
  });

  it("201 cria usuário confirmado, com flag e metadata, e devolve a senha", async () => {
    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(201);

    const payload = await res.json();
    expect(payload.email).toBe("cliente@exemplo.com");
    expect(payload.temp_password).toHaveLength(16);

    expect(createUser).toHaveBeenCalledWith({
      email: "cliente@exemplo.com",
      password: payload.temp_password,
      email_confirm: true,
      app_metadata: { must_change_password: true },
      user_metadata: {
        full_name: "Cliente Exemplo",
        account_name: "Empresa Exemplo",
      },
    });
    // Renomeia a conta criada pelo trigger handle_new_user.
    expect(accountUpdateEq).toHaveBeenCalledWith("owner_user_id", "new-user-id");
  });

  it("normaliza o e-mail para minúsculas", async () => {
    await POST(post({ ...VALID_BODY, email: "Cliente@Exemplo.COM" }));
    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "cliente@exemplo.com" }),
    );
  });

  it("409 quando o e-mail já está cadastrado", async () => {
    createUser.mockResolvedValue({
      data: { user: null },
      error: { code: "email_exists", message: "User already registered", status: 422 },
    });
    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(409);
  });

  it("500 opaco para outros erros do Supabase", async () => {
    createUser.mockResolvedValue({
      data: { user: null },
      error: { code: "unexpected_failure", message: "boom", status: 500 },
    });
    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(500);
    expect((await res.json()).error).not.toContain("boom");
  });
});
