import { describe, expect, it } from "vitest";
import {
  generateTempPassword,
  TEMP_PASSWORD_LENGTH,
} from "./temp-password";

describe("generateTempPassword", () => {
  it("gera exatamente 16 caracteres", () => {
    expect(generateTempPassword()).toHaveLength(16);
    expect(TEMP_PASSWORD_LENGTH).toBe(16);
  });

  it("contém pelo menos uma maiúscula, uma minúscula, um dígito e um símbolo", () => {
    // 50 amostras para não passar por sorte com uma senha boa.
    for (let i = 0; i < 50; i++) {
      const pw = generateTempPassword();
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[0-9]/);
      expect(pw).toMatch(/[!@#$%&*+\-=?]/);
    }
  });

  it("não usa caracteres confundíveis (I, l, O, 0, 1)", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateTempPassword()).not.toMatch(/[IlO01]/);
    }
  });

  it("gera senhas diferentes a cada chamada", () => {
    const seen = new Set(
      Array.from({ length: 20 }, () => generateTempPassword()),
    );
    expect(seen.size).toBe(20);
  });
});
