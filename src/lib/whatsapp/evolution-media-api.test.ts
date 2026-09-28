import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/webhooks/ssrf", () => ({
  isDeliverableUrl: vi.fn(async () => true),
}));

const { sendMedia } = await import("./evolution-api");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("sendMedia", () => {
  beforeEach(() => {
    process.env.EVOLUTION_API_URL = "https://evolution.example.com";
    process.env.EVOLUTION_API_KEY = "test-key";
  });

  afterEach(() => vi.unstubAllGlobals());

  it("baixa a URL pública e envia multipart com o tipo correto", async () => {
    const apiCalls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "https://cdn.example.com/foto.jpg") {
          return new Response(new Uint8Array([1, 2, 3]), {
            headers: { "Content-Type": "image/jpeg" },
          });
        }
        apiCalls.push({ url, init });
        return jsonResponse({ key: { id: "WA-123" } });
      }),
    );

    await expect(
      sendMedia(
        "inst-1",
        "+5511999999999",
        "image",
        "https://cdn.example.com/foto.jpg",
        { caption: "Comprovante", filename: "comprovante.jpg" },
      ),
    ).resolves.toEqual({ ok: true, status: 200, messageId: "WA-123" });

    expect(apiCalls).toHaveLength(1);
    expect(apiCalls[0].url).toBe(
      "https://evolution.example.com/message/sendMedia/inst-1",
    );
    const form = apiCalls[0].init?.body as FormData;
    expect(form.get("number")).toBe("+5511999999999");
    expect(form.get("mediatype")).toBe("image");
    expect(form.get("caption")).toBe("Comprovante");
    expect((form.get("media") as File).name).toBe("comprovante.jpg");
    const headers = new Headers(apiCalls[0].init?.headers);
    expect(headers.get("apikey")).toBe("test-key");
    expect(headers.has("Content-Type")).toBe(false);
  });
});
