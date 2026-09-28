import type { Metadata } from "next";

import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Politica de Privacidade",
  description: "Politica de privacidade do OpenCRM.",
  robots: {
    index: true,
    follow: true,
  },
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Politica de Privacidade"
      description="Ultima atualizacao: agosto de 2026. Esta pagina explica como o OpenCRM trata dados usados para operar CRM, WhatsApp, Meta Ads e integracoes relacionadas."
      sections={[
        {
          title: "Dados que tratamos",
          body: [
            "Podemos tratar dados cadastrais, dados de contato, conversas, informacoes de funil comercial, eventos de conversao, identificadores de campanhas, contas de anuncio, paginas, pixels e configuracoes tecnicas necessarias para operar o CRM.",
            "Quando uma integracao da Meta e conectada, o sistema pode armazenar identificadores de usuario, contas de anuncio, paginas, pixels e tokens de acesso criptografados para executar as funcoes autorizadas.",
          ],
        },
        {
          title: "Como usamos os dados",
          body: [
            "Usamos os dados para entregar as funcoes do CRM, enviar e receber mensagens, organizar contatos, registrar oportunidades, conectar ativos da Meta, disparar eventos de conversao e manter logs operacionais e de seguranca.",
            "Nao vendemos dados pessoais. Compartilhamos dados somente quando necessario para prestar o servico, cumprir obrigacoes legais, proteger a plataforma ou executar integracoes solicitadas pelo usuario.",
          ],
        },
        {
          title: "Integracoes de terceiros",
          body: [
            "O CRM pode se conectar a provedores como Meta, WhatsApp Business Platform, Supabase e outros servicos configurados pelo cliente. O uso desses servicos tambem segue os termos e politicas de cada fornecedor.",
            "Eventos enviados para a API de Conversao da Meta podem conter dados hashados, como telefone, e identificadores de clique quando disponiveis, para mensuracao e otimizacao de campanhas.",
          ],
        },
        {
          title: "Seguranca e retencao",
          body: [
            "Tokens e credenciais sensiveis sao armazenados de forma criptografada no servidor. O acesso aos dados e limitado por conta, usuario e permissao dentro do CRM.",
            "Mantemos dados pelo tempo necessario para operar o servico, cumprir obrigacoes legais e atender solicitacoes de suporte, exclusao ou auditoria.",
          ],
        },
        {
          title: "Direitos do usuario",
          body: [
            "Usuarios podem solicitar acesso, correcao, portabilidade ou exclusao de dados pessoais conforme a legislacao aplicavel.",
            "Solicitacoes podem ser feitas pelo email hello@opencrm.tech ou pela pagina de exclusao de dados deste site.",
          ],
        },
      ]}
    />
  );
}
