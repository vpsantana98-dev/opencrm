import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/whatsapp/evolution-api", () => ({
  getMediaBase64: vi.fn(),
}));

const { persistEvolutionIncomingMedia, normalizeMimeType } = await import(
  "./evolution-incoming-media"
);
const { getMediaBase64 } = await import("./evolution-api");

function storageDb() {
  const upload = vi.fn(async () => ({ error: null }));
  const getPublicUrl = vi.fn((path: string) => ({
    data: { publicUrl: `https://storage.example.com/${path}` },
  }));
  const db = {
    storage: {
      from: vi.fn(() => ({ upload, getPublicUrl })),
    },
  } as unknown as SupabaseClient;
  return { db, upload };
}

describe("persistEvolutionIncomingMedia", () => {
  it("grava o base64 do webhook no bucket público", async () => {
    const { db, upload } = storageDb();
    const url = await persistEvolutionIncomingMedia(db, {
      accountId: "acct-1",
      instanceName: "inst-1",
      messageId: "MSG/1",
      message: {
        message: {
          imageMessage: { mimetype: "image/jpeg" },
          base64: Buffer.from("foto").toString("base64"),
        },
      },
    });

    expect(url).toBe(
      "https://storage.example.com/account-acct-1/evolution/MSG_1.jpg",
    );
    expect(upload).toHaveBeenCalledWith(
      "account-acct-1/evolution/MSG_1.jpg",
      expect.any(Buffer),
      expect.objectContaining({ contentType: "image/jpeg" }),
    );
    expect(getMediaBase64).not.toHaveBeenCalled();
  });

  it("busca a mídia na Evolution quando o webhook vem sem base64", async () => {
    vi.mocked(getMediaBase64).mockResolvedValueOnce({
      base64: Buffer.from("audio").toString("base64"),
      mimeType: "audio/ogg",
      fileName: "voz.ogg",
    });
    const { db } = storageDb();

    const url = await persistEvolutionIncomingMedia(db, {
      accountId: "acct-1",
      instanceName: "inst-1",
      messageId: "MSG2",
      message: { message: { audioMessage: {} } },
    });

    expect(url).toContain("/evolution/MSG2.ogg");
    expect(getMediaBase64).toHaveBeenCalledWith(
      "inst-1",
      expect.objectContaining({ message: { audioMessage: {} } }),
    );
  });
});

// ---------------------------------------------------------------------------
// Regressao vinda de producao: todo audio recebido era rejeitado com
//   "mime type audio/ogg; codecs=opus is not supported"
// O bucket chat-media permite "audio/ogg", mas o Supabase Storage compara a
// string INTEIRA — e o WhatsApp manda o sufixo de codec junto.
// ---------------------------------------------------------------------------
describe("normalizeMimeType", () => {
  it("tira o parametro de codec do audio do WhatsApp", () => {
    expect(normalizeMimeType("audio/ogg; codecs=opus")).toBe("audio/ogg");
  });

  it("aceita sem espaco depois do ponto-e-virgula", () => {
    expect(normalizeMimeType("audio/ogg;codecs=opus")).toBe("audio/ogg");
  });

  it("normaliza caixa alta", () => {
    // Storage e a tabela de extensoes comparam em minusculas.
    expect(normalizeMimeType("AUDIO/OGG")).toBe("audio/ogg");
  });

  it("deixa intacto o que ja esta limpo", () => {
    expect(normalizeMimeType("video/mp4")).toBe("video/mp4");
    expect(normalizeMimeType("image/jpeg")).toBe("image/jpeg");
  });

  it("apara espacos em volta", () => {
    expect(normalizeMimeType("  image/png  ")).toBe("image/png");
  });
});
