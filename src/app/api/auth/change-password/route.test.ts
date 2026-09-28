import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- Knobs -----------------------------------------------------------------
let mockUser: { id: string } | null = null;
const updateUser = vi.fn();
const updateUserById = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: mockUser },
        error: mockUser ? null : { message: "no session" },
      }),
      updateUser,
    },
  }),
}));

vi.mock("@/lib/auth/admin-client", () => ({
  supabaseAdmin: () => ({ auth: { admin: { updateUserById } } }),
}));

const { POST } = await import("./route");

function post(body: unknown): Request {
  return new Request("https://app.test/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockUser = { id: "user-1" };
  updateUser.mockReset().mockResolvedValue({ error: null });
  updateUserById.mockReset().mockResolvedValue({ data: {}, error: null });
});

describe("POST /api/auth/change-password", () => {
  it("401 sem sessão", async () => {
    mockUser = null;
    const res = await POST(post({ password: "12345678", confirm: "12345678" }));
    expect(res.status).toBe(401);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("400 para senha curta", async () => {
    const res = await POST(post({ password: "curta", confirm: "curta" }));
    expect(res.status).toBe(400);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("400 quando a confirmação diverge", async () => {
    const res = await POST(post({ password: "12345678", confirm: "87654321" }));
    expect(res.status).toBe(400);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("200 troca a senha E limpa a flag via service role", async () => {
    const res = await POST(
      post({ password: "nova-senha-123", confirm: "nova-senha-123" }),
    );
    expect(res.status).toBe(200);
    expect(updateUser).toHaveBeenCalledWith({ password: "nova-senha-123" });
    expect(updateUserById).toHaveBeenCalledWith("user-1", {
      app_metadata: { must_change_password: false },
    });
  });

  it("400 repassando a mensagem quando o updateUser falha (ex.: senha igual à anterior)", async () => {
    updateUser.mockResolvedValue({
      error: { message: "New password should be different from the old password." },
    });
    const res = await POST(
      post({ password: "mesma-senha-1", confirm: "mesma-senha-1" }),
    );
    expect(res.status).toBe(400);
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("500 quando limpar a flag falha (senha já trocou, acesso ainda travado)", async () => {
    updateUserById.mockResolvedValue({
      data: null,
      error: { message: "boom" },
    });
    const res = await POST(
      post({ password: "nova-senha-123", confirm: "nova-senha-123" }),
    );
    expect(res.status).toBe(500);
  });
});
