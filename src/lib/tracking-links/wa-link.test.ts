import { describe, expect, it } from 'vitest';

import { buildWaMeUrl } from './wa-link';

describe('buildWaMeUrl', () => {
  it('monta wa.me com dígitos do telefone e mensagem codificada', () => {
    expect(buildWaMeUrl('+5531999998888', 'Olá! Vi seu anúncio')).toBe(
      'https://wa.me/5531999998888?text=Ol%C3%A1!%20Vi%20seu%20an%C3%BAncio'
    );
  });

  it('remove qualquer formatação do telefone', () => {
    expect(buildWaMeUrl('+55 (31) 99999-8888', 'oi')).toBe(
      'https://wa.me/5531999998888?text=oi'
    );
  });
});
