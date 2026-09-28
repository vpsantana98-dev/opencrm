import { describe, expect, it } from "vitest";

import { agruparOrigens, type ContatoOrigem } from "./queries";

function contato(over: Partial<ContatoOrigem> = {}): ContatoOrigem {
  return {
    ad_referral: null,
    ad_source_id: null,
    source_link_id: null,
    source_utm: null,
    ...over,
  };
}

const SEM_LINKS = new Map<string, string>();

describe("agruparOrigens — precedência do nome", () => {
  it("nome do link vence a campanha do UTM", () => {
    // Quem nomeou o link foi o usuário; a UTM veio da URL. O nome que a
    // pessoa escolheu é o que ela reconhece na tela.
    const r = agruparOrigens(
      [
        contato({
          source_link_id: "l1",
          source_utm: { utm_campaign: "black-friday-2026" },
        }),
      ],
      new Map([["l1", "Bio do Instagram"]]),
    );
    expect(r.origens[0].nome).toBe("Bio do Instagram");
    expect(r.origens[0].tipo).toBe("link");
  });

  it("link apagado cai para a campanha, não para um id cru", () => {
    const r = agruparOrigens(
      [
        contato({
          source_link_id: "sumiu",
          source_utm: { utm_campaign: "promo-julho" },
        }),
      ],
      SEM_LINKS,
    );
    expect(r.origens[0].nome).toBe("promo-julho");
  });

  it("link apagado e sem campanha vira rótulo legível", () => {
    const r = agruparOrigens(
      [contato({ source_link_id: "sumiu" })],
      SEM_LINKS,
    );
    expect(r.origens[0].nome).toBe("Link removido");
  });

  it("anúncio usa o headline que o lead viu", () => {
    const r = agruparOrigens(
      [
        contato({
          ad_source_id: "120210",
          ad_referral: { headline: "Consultoria grátis por 7 dias" },
        }),
      ],
      SEM_LINKS,
    );
    expect(r.origens[0].nome).toBe("Consultoria grátis por 7 dias");
    expect(r.origens[0].tipo).toBe("anuncio");
  });

  it("anúncio sem headline cai para o id, mas rotulado", () => {
    const r = agruparOrigens(
      [contato({ ad_source_id: "120210" })],
      SEM_LINKS,
    );
    expect(r.origens[0].nome).toBe("Anúncio 120210");
  });

  it("string vazia não vira nome", () => {
    // utm_campaign="" acontece quando a URL tem o parâmetro sem valor.
    const r = agruparOrigens(
      [
        contato({
          ad_source_id: "999",
          ad_referral: { headline: "   " },
        }),
      ],
      SEM_LINKS,
    );
    expect(r.origens[0].nome).toBe("Anúncio 999");
  });
});

describe("agruparOrigens — agrupamento", () => {
  it("soma leads do mesmo link", () => {
    const r = agruparOrigens(
      [
        contato({ source_link_id: "l1" }),
        contato({ source_link_id: "l1" }),
        contato({ source_link_id: "l2" }),
      ],
      new Map([
        ["l1", "Bio"],
        ["l2", "Story"],
      ]),
    );
    expect(r.origens).toHaveLength(2);
    expect(r.origens[0]).toMatchObject({ nome: "Bio", leads: 2 });
    expect(r.origens[1]).toMatchObject({ nome: "Story", leads: 1 });
  });

  it("agrupa campanha ignorando maiúsculas", () => {
    const r = agruparOrigens(
      [
        contato({ source_utm: { utm_campaign: "Verao" } }),
        contato({ source_utm: { utm_campaign: "verao" } }),
      ],
      SEM_LINKS,
    );
    expect(r.origens).toHaveLength(1);
    expect(r.origens[0].leads).toBe(2);
  });

  it("anúncios sem id caem num grupo só, não um por lead", () => {
    const r = agruparOrigens(
      [
        contato({ ad_referral: { ctwa_clid: "a" } }),
        contato({ ad_referral: { ctwa_clid: "b" } }),
      ],
      SEM_LINKS,
    );
    expect(r.origens).toHaveLength(1);
    expect(r.origens[0].leads).toBe(2);
  });

  it("ordena por volume, desempatando pelo nome", () => {
    const r = agruparOrigens(
      [
        contato({ source_utm: { utm_campaign: "zebra" } }),
        contato({ source_utm: { utm_campaign: "alpha" } }),
        contato({ source_utm: { utm_campaign: "meio" } }),
        contato({ source_utm: { utm_campaign: "meio" } }),
      ],
      SEM_LINKS,
    );
    expect(r.origens.map((o) => o.nome)).toEqual(["meio", "alpha", "zebra"]);
  });

  it("respeita o limite", () => {
    const contatos = Array.from({ length: 20 }, (_, i) =>
      contato({ source_utm: { utm_campaign: `c${i}` } }),
    );
    expect(agruparOrigens(contatos, SEM_LINKS, 5).origens).toHaveLength(5);
  });
});

describe("agruparOrigens — sem origem", () => {
  it("lead sem marcador NÃO entra no ranking", () => {
    // Ausência de origem não é uma origem. Se entrasse, viraria quase
    // sempre o primeiro lugar e esconderia as origens reais.
    const r = agruparOrigens(
      [contato(), contato(), contato({ source_link_id: "l1" })],
      new Map([["l1", "Bio"]]),
    );
    expect(r.origens).toHaveLength(1);
    expect(r.semOrigem).toBe(2);
  });

  it("a fração é sobre o ATRIBUÍDO, não sobre o total", () => {
    // Com 8 sem origem e 2 atribuídos, o link com 1 lead é 50% do que
    // sabemos — não 10% de tudo. Dizer 10% misturaria "pouco efetivo"
    // com "pouco medido".
    const r = agruparOrigens(
      [
        ...Array.from({ length: 8 }, () => contato()),
        contato({ source_link_id: "l1" }),
        contato({ source_link_id: "l2" }),
      ],
      new Map([
        ["l1", "A"],
        ["l2", "B"],
      ]),
    );
    expect(r.totalAtribuido).toBe(2);
    expect(r.origens[0].fracao).toBeCloseTo(0.5);
  });

  it("entrada vazia devolve zeros", () => {
    const r = agruparOrigens([], SEM_LINKS);
    expect(r).toEqual({ origens: [], totalAtribuido: 0, semOrigem: 0 });
  });
});
