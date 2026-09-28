import { redirect } from "next/navigation";

/**
 * `/meta-ads` virou um atalho para a aba de Rastreamento.
 *
 * Esta página renderizava exatamente `<MetaAdsConfig />` +
 * `<GoogleAdsConfig />` — os MESMOS dois componentes, na mesma ordem,
 * que a aba "Rastreamento" das Configurações. Eram duas portas para a
 * mesma sala: quem configurasse por um caminho ficava na dúvida se
 * precisava repetir pelo outro.
 *
 * O item saiu do menu lateral, mas a rota fica de pé como redirect
 * porque link salvo, favorito e URL colada em conversa continuam
 * existindo — e um 404 seria pior do que a duplicação que estamos
 * removendo.
 */
export default function MetaAdsPage() {
  redirect("/settings?tab=meta-ads");
}
