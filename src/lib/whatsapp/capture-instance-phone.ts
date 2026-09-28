// ============================================================
// Grava evolution_instances.phone quando a instância conecta.
//
// A coluna existia desde a migration 036 mas nunca era escrita, o que
// deixava o select de números dos Links Rastreáveis vazio e mantinha
// morta a preferência de proxy por DDD (fase 1 do anti-ban). Chamado
// nos três pontos em que o estado vira "connected": rota de status,
// rota status-public e webhook connection.update.
//
// Best-effort: falha de rede/API só loga; nunca quebra o chamador.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchInstanceInfo } from '@/lib/whatsapp/evolution-api';

export async function captureInstancePhone(
  db: SupabaseClient,
  accountId: string,
  instanceName: string,
): Promise<void> {
  try {
    // Busca pelo NOME da instância, não pela conta.
    //
    // `instance_name` é UNIQUE, então isto aponta para exatamente um
    // número. Antes procurava por `account_id`: com dois números o
    // `.maybeSingle()` erraria, e o update abaixo escreveria o telefone
    // de um número em cima da linha do outro.
    const { data: row } = await db
      .from('evolution_instances')
      .select('phone')
      .eq('account_id', accountId)
      .eq('instance_name', instanceName)
      .maybeSingle();
    if (!row) return;
    if (typeof row.phone === 'string' && row.phone.trim()) return;

    const { phone } = await fetchInstanceInfo(instanceName);
    if (!phone) return;

    await db
      .from('evolution_instances')
      .update({ phone })
      .eq('account_id', accountId)
      .eq('instance_name', instanceName);
  } catch (err) {
    console.error('[capture-instance-phone]', err);
  }
}
