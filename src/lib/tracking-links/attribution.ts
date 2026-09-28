// ============================================================
// Atribuição de "Conversas Geradas" aos links rastreáveis.
//
// A mensagem padrão do link é a ASSINATURA: quando um contato NOVO
// chega pelo webhook e a primeira mensagem casa com ela (trim +
// case-insensitive, o mesmo critério do índice único parcial da
// migration 041), o lead é atribuído ao link.
//
// UTMs efetivos: os do clique mais recente do link; se esse clique
// não trouxe nenhum utm_* (ou não há cliques), caem os padrões
// configurados no link. O snapshot vai em contacts.source_utm.
//
// Limitação aceita (spec): a associação lead-clique é por "último
// clique". Campanhas simultâneas no MESMO link podem trocar UTMs
// entre leads próximos no tempo; para precisão, um link por campanha.
//
// NUNCA lança: roda dentro dos webhooks e não pode derrubar o
// processamento da mensagem.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { pickUtm, type UtmKey } from '@/lib/tracking-links/utm';

type UtmRow = Partial<Record<UtmKey, string | null>>;

export async function attributeLeadToLink(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  text: string,
  contactCreated: boolean
): Promise<void> {
  if (!contactCreated) return;
  const normalized = String(text ?? '').trim().toLowerCase();
  if (!normalized) return;

  try {
    const { data: links, error } = await db
      .from('tracking_links')
      .select(
        'id, message, utm_source, utm_medium, utm_campaign, utm_term, utm_content'
      )
      .eq('account_id', accountId)
      .eq('active', true);
    if (error) {
      console.error('[tracking-links] atribuição (select):', error);
      return;
    }

    const match = (links ?? []).find(
      (l: { message: string }) =>
        l.message.trim().toLowerCase() === normalized
    );
    if (!match) return;

    const { data: click } = await db
      .from('link_clicks')
      .select('utm_source, utm_medium, utm_campaign, utm_term, utm_content')
      .eq('link_id', match.id)
      .order('clicked_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const utm = pickUtm(click as UtmRow | null) ?? pickUtm(match as UtmRow);

    const { error: updateError } = await db
      .from('contacts')
      .update({
        source_link_id: match.id,
        source_utm: utm,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contactId);
    if (updateError) {
      console.error('[tracking-links] atribuição (update):', updateError);
      return;
    }

    const { error: rpcError } = await db.rpc('increment_link_conversations', {
      p_link_id: match.id,
    });
    if (rpcError) {
      console.error('[tracking-links] atribuição (rpc):', rpcError);
    }
  } catch (err) {
    console.error('[tracking-links] atribuição:', err);
  }
}
