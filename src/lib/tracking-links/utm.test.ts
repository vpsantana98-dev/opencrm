import { describe, expect, it } from 'vitest';

import { extractUtmParams, pickUtm } from './utm';

describe('extractUtmParams', () => {
  it('extrai só os 5 utm_* conhecidos e ignora o resto', () => {
    const sp = new URLSearchParams(
      'utm_source=googleads&utm_campaign=promo&foo=bar&gclid=abc'
    );
    expect(extractUtmParams(sp)).toEqual({
      utm_source: 'googleads',
      utm_campaign: 'promo',
    });
  });

  it('retorna null quando não há nenhum UTM', () => {
    expect(extractUtmParams(new URLSearchParams('foo=bar'))).toBeNull();
    expect(extractUtmParams(new URLSearchParams(''))).toBeNull();
  });

  it('apara espaços e descarta valores vazios', () => {
    const sp = new URLSearchParams('utm_source=%20%20&utm_medium=%20social%20');
    expect(extractUtmParams(sp)).toEqual({ utm_medium: 'social' });
  });

  it('trunca valores em 255 caracteres', () => {
    const long = 'x'.repeat(300);
    const sp = new URLSearchParams(`utm_term=${long}`);
    expect(extractUtmParams(sp)).toEqual({ utm_term: 'x'.repeat(255) });
  });
});

describe('pickUtm', () => {
  it('extrai o subconjunto não vazio de um row do banco', () => {
    expect(
      pickUtm({ utm_source: 'meta', utm_medium: null, utm_term: '  ' })
    ).toEqual({ utm_source: 'meta' });
  });

  it('retorna null para row nulo ou sem valores', () => {
    expect(pickUtm(null)).toBeNull();
    expect(pickUtm({ utm_source: null })).toBeNull();
  });
});
