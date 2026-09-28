import type { Metadata } from "next";

import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Termos de Servico",
  description: "Termos de servico do OpenCRM.",
  robots: {
    index: true,
    follow: true,
  },
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Termos de Servico"
      description="Ultima atualizacao: agosto de 2026. Estes termos regulam o uso do OpenCRM e de suas integracoes."
      sections={[
        {
          title: "Uso da plataforma",
          body: [
            "O OpenCRM e uma plataforma para gestao de contatos, conversas, funis comerciais, automacoes e integracoes com servicos externos.",
            "O usuario e responsavel por usar a plataforma de forma licita, respeitando a legislacao aplicavel, politicas da Meta, politicas do WhatsApp e regras de privacidade dos seus contatos.",
          ],
        },
        {
          title: "Responsabilidade sobre configuracoes",
          body: [
            "O cliente e responsavel por informar credenciais, pixels, tokens, numeros de telefone, contas de anuncio e demais ativos corretos.",
            "O mau uso de tokens, envio de mensagens indevidas, campanhas irregulares ou configuracoes incorretas pode causar bloqueios, perdas de dados ou rejeicoes por terceiros.",
          ],
        },
        {
          title: "Disponibilidade e suporte",
          body: [
            "A plataforma pode passar por manutencoes, atualizacoes ou interrupcoes tecnicas. Buscamos manter o servico estavel, mas nao garantimos disponibilidade ininterrupta.",
            "Solicitacoes de suporte podem ser enviadas para hello@opencrm.tech.",
          ],
        },
        {
          title: "Integracoes externas",
          body: [
            "Recursos ligados a Meta, WhatsApp, anuncios, pixels e API de Conversao dependem de autorizacoes, aprovacoes, permissoes e disponibilidade dessas plataformas.",
            "Alteracoes nas APIs de terceiros podem exigir ajustes no CRM ou novas configuracoes pelo usuario.",
          ],
        },
        {
          title: "Cancelamento e exclusao",
          body: [
            "O usuario pode solicitar cancelamento, desconexao de integracoes ou exclusao de dados conforme as politicas comerciais aplicaveis e a legislacao vigente.",
            "Pedidos relacionados a dados pessoais podem ser feitos pela pagina de exclusao de dados ou pelo email de contato informado neste site.",
          ],
        },
      ]}
    />
  );
}
