import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { captureInstancePhone } from '@/lib/whatsapp/capture-instance-phone';
import { phoneFromJid } from '@/lib/whatsapp/evolution-api';

// Mock pelo MESMO especificador que o código fonte usa (alias @/),
// para o vitest casar o mock com o módulo importado por
// capture-instance-phone.ts. phoneFromJid segue real via
// importOriginal.
vi.mock('@/lib/whatsapp/evolution-api', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/whatsapp/evolution-api')>();
  return { ...original, fetchInstanceInfo: vi.fn() };
});

import { fetchInstanceInfo } from '@/lib/whatsapp/evolution-api';

// Duplo encadeável que ANOTA os filtros.
//
// Antes ele aceitava um `.eq()` só, o que travava a leitura e a
// escrita em "um número por conta". Agora registra os pares para o
// teste poder afirmar que a busca e o update miram o número certo — é
// isso que impede o telefone de um número ser gravado na linha do
// outro quando o cliente tem vários.
function fakeDb(existingPhone: string | null) {
  const updates: Record<string, unknown>[] = [];
  const filtrosLeitura: Record<string, unknown> = {};
  const filtrosUpdate: Record<string, unknown> = {};

  function cadeia(
    onde: Record<string, unknown>,
    terminal: () => Promise<unknown>,
  ) {
    const alvo: Record<string, unknown> = {
      eq: (col: string, val: unknown) => {
        onde[col] = val;
        return alvo;
      },
      maybeSingle: terminal,
      // Thenable: `await db.from().update().eq().eq()` cai aqui.
      then: (resolve: (v: unknown) => void) => resolve({ error: null }),
    };
    return alvo;
  }

  const db = {
    from: () => ({
      select: () =>
        cadeia(filtrosLeitura, () =>
          Promise.resolve({ data: { phone: existingPhone }, error: null }),
        ),
      update: (values: Record<string, unknown>) => {
        updates.push(values);
        return cadeia(filtrosUpdate, () =>
          Promise.resolve({ data: null, error: null }),
        );
      },
    }),
  };
  return {
    db: db as unknown as SupabaseClient,
    updates,
    filtrosLeitura,
    filtrosUpdate,
  };
}

describe('phoneFromJid', () => {
  it('extrai E.164 de um jid do WhatsApp', () => {
    expect(phoneFromJid('5531999998888@s.whatsapp.net')).toBe('+5531999998888');
    expect(phoneFromJid('5531999998888:17@s.whatsapp.net')).toBe(
      '+5531999998888'
    );
  });

  it('retorna null para jid vazio ou curto demais', () => {
    expect(phoneFromJid(null)).toBeNull();
    expect(phoneFromJid('abc@s.whatsapp.net')).toBeNull();
  });
});

describe('captureInstancePhone', () => {
  it('grava o telefone quando a coluna está vazia', async () => {
    vi.mocked(fetchInstanceInfo).mockResolvedValue({ phone: '+5531999998888' });
    const { db, updates } = fakeDb(null);
    await captureInstancePhone(db, 'acc-1', 'inst-1');
    expect(updates).toEqual([{ phone: '+5531999998888' }]);
  });

  it('mira o NÚMERO, não a conta (cliente com vários números)', async () => {
    // Regressão: com dois números, filtrar só por `account_id` fazia o
    // `.maybeSingle()` errar na leitura e o update gravar o telefone
    // deste número em cima da linha do outro.
    vi.mocked(fetchInstanceInfo).mockResolvedValue({ phone: '+5531999998888' });
    const { db, filtrosLeitura, filtrosUpdate } = fakeDb(null);
    await captureInstancePhone(db, 'acc-1', 'inst-1');
    expect(filtrosLeitura).toEqual({
      account_id: 'acc-1',
      instance_name: 'inst-1',
    });
    expect(filtrosUpdate).toEqual({
      account_id: 'acc-1',
      instance_name: 'inst-1',
    });
  });

  it('não faz nada quando já há telefone', async () => {
    const { db, updates } = fakeDb('+5531988887777');
    await captureInstancePhone(db, 'acc-1', 'inst-1');
    expect(fetchInstanceInfo).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('nunca lança quando a busca falha', async () => {
    vi.mocked(fetchInstanceInfo).mockRejectedValue(new Error('rede caiu'));
    const { db, updates } = fakeDb(null);
    await expect(
      captureInstancePhone(db, 'acc-1', 'inst-1')
    ).resolves.toBeUndefined();
    expect(updates).toHaveLength(0);
  });
});
