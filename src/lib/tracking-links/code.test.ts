import { describe, expect, it } from 'vitest';

import { generateLinkCode, LINK_CODE_LENGTH } from './code';

describe('generateLinkCode', () => {
  it('gera código com 8 caracteres', () => {
    expect(generateLinkCode()).toHaveLength(LINK_CODE_LENGTH);
  });

  it('usa somente o alfabeto base62', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateLinkCode()).toMatch(/^[A-Za-z0-9]{8}$/);
    }
  });

  it('não repete em uma amostra pequena', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateLinkCode()));
    expect(seen.size).toBe(200);
  });
});
