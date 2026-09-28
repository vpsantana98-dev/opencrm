import { describe, expect, it } from "vitest";

import { classificarOrigem } from "./queries";

function contato(over: Partial<Parameters<typeof classificarOrigem>[0]> = {}) {
  return {
    ctwa_clid: null,
    ad_source_id: null,
    source_link_id: null,
    ...over,
  };
}

describe("classificarOrigem", () => {
  it("ctwa_clid marca origem Meta", () => {
    expect(classificarOrigem(contato({ ctwa_clid: "abc123" }))).toBe("meta");
  });

  it("ad_source_id sozinho também marca Meta", () => {
    // Nem todo clique em anúncio traz ctwa_clid; o source_id vem em
    // mais casos e sozinho já prova que veio de anúncio.
    expect(classificarOrigem(contato({ ad_source_id: "6301" }))).toBe("meta");
  });

  it("source_link_id marca Link Rastreável", () => {
    expect(classificarOrigem(contato({ source_link_id: "lnk" }))).toBe("link");
  });

  it("sem nenhum marcador é Orgânico", () => {
    expect(classificarOrigem(contato())).toBe("organico");
  });

  it("anúncio VENCE link rastreável quando os dois estão presentes", () => {
    // A primeira origem é a que trouxe a pessoa. Sem esta precedência o
    // mesmo lead poderia ser contado como link só porque clicou depois,
    // e o anúncio perderia o crédito que é dele.
    expect(
      classificarOrigem(contato({ ctwa_clid: "abc", source_link_id: "lnk" })),
    ).toBe("meta");
  });

  it("string vazia não conta como origem", () => {
    // Coluna preenchida com "" acontece quando o webhook recebe o campo
    // presente mas sem valor; tratá-la como origem inflaria o Meta.
    expect(classificarOrigem(contato({ ctwa_clid: "" }))).toBe("organico");
    expect(classificarOrigem(contato({ source_link_id: "" }))).toBe("organico");
  });
});
