import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Review final, item 3: `requirePlatformAdmin` é o ÚNICO portão de
// autorização das rotas do pool de proxies (elas usam o cliente com service
// role, que ignora RLS, e `proxies` é global, sem account_id). Até aqui não
// tinha nenhum teste.
//
// O que este arquivo trava é o fail-closed: `PLATFORM_ADMIN_USER_IDS`
// ausente, vazia, só com vírgulas ou só com espaços significa que NINGUÉM é
// admin de plataforma, nunca que todo mundo é. Uma implementação que libera
// geral quando a env falta seria pior que o bug que o módulo corrige, porque
// `handle_new_user` faz todo cadastro virar "owner" de uma conta própria.
// ---------------------------------------------------------------------------

const getUser = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

const { requirePlatformAdmin } = await import("./platform-admin");
const { ForbiddenError, UnauthorizedError } = await import("./account");

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const OUTSIDER_ID = "22222222-2222-4222-8222-222222222222";

function signedInAs(id: string) {
  getUser.mockResolvedValue({ data: { user: { id } }, error: null });
}

describe("requirePlatformAdmin: fail-closed", () => {
  const ORIGINAL = process.env.PLATFORM_ADMIN_USER_IDS;

  beforeEach(() => {
    signedInAs(ADMIN_ID);
  });

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.PLATFORM_ADMIN_USER_IDS;
    } else {
      process.env.PLATFORM_ADMIN_USER_IDS = ORIGINAL;
    }
  });

  // Cada entrada é uma forma de "a env não nomeia ninguém". Todas têm que
  // NEGAR, inclusive para um usuário autenticado.
  const vazias: Array<{ nome: string; valor: string | undefined }> = [
    { nome: "ausente", valor: undefined },
    { nome: "vazia", valor: "" },
    { nome: "só vírgulas", valor: ",,," },
    { nome: "só espaços", valor: "   " },
    { nome: "espaços e vírgulas", valor: " , ,  , " },
    { nome: "quebra de linha", valor: "\n" },
  ];

  for (const caso of vazias) {
    it(`env ${caso.nome}: nega mesmo um usuário autenticado`, async () => {
      if (caso.valor === undefined) {
        delete process.env.PLATFORM_ADMIN_USER_IDS;
      } else {
        process.env.PLATFORM_ADMIN_USER_IDS = caso.valor;
      }

      await expect(requirePlatformAdmin()).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });
  }

  it("usuário fora da allowlist: nega", async () => {
    process.env.PLATFORM_ADMIN_USER_IDS = ADMIN_ID;
    signedInAs(OUTSIDER_ID);

    await expect(requirePlatformAdmin()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("sem sessão: 401, e nem chega a consultar a allowlist", async () => {
    process.env.PLATFORM_ADMIN_USER_IDS = ADMIN_ID;
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(requirePlatformAdmin()).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it("erro do getUser: 401", async () => {
    process.env.PLATFORM_ADMIN_USER_IDS = ADMIN_ID;
    getUser.mockResolvedValue({
      data: { user: null },
      error: { message: "jwt expired" },
    });

    await expect(requirePlatformAdmin()).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  // Os dois casos positivos existem para o arquivo não passar por acidente:
  // sem eles, uma implementação que negasse SEMPRE deixaria toda a bateria
  // acima verde.
  it("usuário na allowlist: permite", async () => {
    process.env.PLATFORM_ADMIN_USER_IDS = ADMIN_ID;

    await expect(requirePlatformAdmin()).resolves.toBeUndefined();
  });

  it("allowlist com vários IDs e espaços em volta: permite quem está nela", async () => {
    process.env.PLATFORM_ADMIN_USER_IDS = ` ${OUTSIDER_ID} , ${ADMIN_ID} `;

    await expect(requirePlatformAdmin()).resolves.toBeUndefined();
  });
});
