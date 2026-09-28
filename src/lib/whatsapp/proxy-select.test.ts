import { describe, expect, it } from "vitest";
import {
  dddToUf,
  extractDdd,
  selectProxy,
  type ProxyCandidate,
} from "./proxy-select";

function candidate(over: Partial<ProxyCandidate> = {}): ProxyCandidate {
  return {
    id: "p1",
    region: null,
    maxInstances: 4,
    currentInstances: 0,
    status: "active",
    ...over,
  };
}

describe("extractDdd", () => {
  it("extrai o DDD de um celular brasileiro em E.164 sem o +", () => {
    expect(extractDdd("5511987654321")).toBe("11");
    expect(extractDdd("5571988887777")).toBe("71");
  });

  it("extrai o DDD com o + inicial (convenção de telefone do resto do app)", () => {
    expect(extractDdd("+5511987654321")).toBe("11");
    expect(extractDdd("+55 11 98765-4321")).toBe("11");
  });

  it("extrai o DDD ignorando espaços, hífen e parênteses em geral", () => {
    expect(extractDdd("+55 (71) 98888-7777")).toBe("71");
    expect(extractDdd("55 11 98765 4321")).toBe("11");
  });

  it("retorna null para número que não é do Brasil", () => {
    expect(extractDdd("14155551212")).toBeNull();
    expect(extractDdd("37063949836")).toBeNull();
    expect(extractDdd("+1 415 555 1212")).toBeNull();
  });

  it("retorna null para entrada curta demais ou vazia", () => {
    expect(extractDdd("55")).toBeNull();
    expect(extractDdd("")).toBeNull();
    expect(extractDdd("+55")).toBeNull();
  });
});

describe("dddToUf", () => {
  it("mapeia DDDs conhecidos para a UF", () => {
    expect(dddToUf("11")).toBe("SP");
    expect(dddToUf("21")).toBe("RJ");
    expect(dddToUf("31")).toBe("MG");
    expect(dddToUf("71")).toBe("BA");
    expect(dddToUf("85")).toBe("CE");
  });

  it("retorna null para DDD inexistente", () => {
    expect(dddToUf("00")).toBeNull();
    expect(dddToUf("23")).toBeNull();
  });
});

describe("selectProxy", () => {
  it("retorna null quando não há candidato", () => {
    expect(selectProxy([])).toBeNull();
  });

  it("ignora proxy que não está active", () => {
    const pool = [
      candidate({ id: "degradado", status: "degraded" }),
      candidate({ id: "desligado", status: "disabled" }),
    ];
    expect(selectProxy(pool)).toBeNull();
  });

  it("ignora proxy que já está na capacidade máxima", () => {
    const pool = [candidate({ id: "cheio", maxInstances: 4, currentInstances: 4 })];
    expect(selectProxy(pool)).toBeNull();
  });

  it("escolhe o menos carregado quando não há preferência de região", () => {
    const pool = [
      candidate({ id: "carregado", currentInstances: 3 }),
      candidate({ id: "vazio", currentInstances: 0 }),
      candidate({ id: "meio", currentInstances: 2 }),
    ];
    expect(selectProxy(pool)?.id).toBe("vazio");
  });

  it("prefere o proxy da região do DDD mesmo que esteja mais carregado", () => {
    const pool = [
      candidate({ id: "sp", region: "BR-SP", currentInstances: 3 }),
      candidate({ id: "rj", region: "BR-RJ", currentInstances: 0 }),
    ];
    expect(selectProxy(pool, { phone: "5511987654321" })?.id).toBe("sp");
  });

  it("entre proxies da região certa, escolhe o menos carregado", () => {
    const pool = [
      candidate({ id: "sp-cheio", region: "BR-SP", currentInstances: 3 }),
      candidate({ id: "sp-vazio", region: "BR-SP", currentInstances: 1 }),
    ];
    expect(selectProxy(pool, { phone: "5511987654321" })?.id).toBe("sp-vazio");
  });

  it("cai para o menos carregado quando a região do DDD não tem vaga", () => {
    const pool = [
      candidate({ id: "sp", region: "BR-SP", maxInstances: 2, currentInstances: 2 }),
      candidate({ id: "rj", region: "BR-RJ", currentInstances: 1 }),
    ];
    expect(selectProxy(pool, { phone: "5511987654321" })?.id).toBe("rj");
  });

  it("ignora a preferência de região para número não brasileiro", () => {
    const pool = [
      candidate({ id: "sp", region: "BR-SP", currentInstances: 3 }),
      candidate({ id: "generico", region: null, currentInstances: 0 }),
    ];
    expect(selectProxy(pool, { phone: "14155551212" })?.id).toBe("generico");
  });
});
