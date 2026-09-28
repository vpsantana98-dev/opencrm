import type { Metadata } from "next";

import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Exclusao de Dados",
  description: "Instrucoes para solicitar exclusao de dados no OpenCRM.",
  robots: {
    index: true,
    follow: true,
  },
};

export default function DataDeletionPage() {
  return (
    <LegalPage
      title="Exclusao de Dados"
      description="Esta pagina informa como solicitar a exclusao de dados pessoais tratados pelo OpenCRM."
      sections={[
        {
          title: "Como solicitar",
          body: [
            "Envie um email para contato.OpenCRM.2021@gmail.com com o assunto Exclusao de Dados.",
            "Inclua o nome, email usado no CRM, empresa ou conta relacionada e uma descricao curta dos dados que deseja excluir.",
          ],
        },
        {
          title: "O que acontece depois",
          body: [
            "A equipe analisara a solicitacao, confirmara a identidade do solicitante quando necessario e removera ou anonimizara os dados conforme a legislacao aplicavel.",
            "Quando a solicitacao estiver ligada a uma integracao Meta, tambem poderemos desconectar tokens e remover identificadores associados ao usuario Meta conectado.",
          ],
        },
        {
          title: "Prazo",
          body: [
            "Solicitacoes validas serao tratadas em prazo razoavel, observadas obrigacoes legais, fiscais, de seguranca e de prevencao a fraude.",
            "Alguns registros tecnicos podem ser mantidos temporariamente quando forem necessarios para auditoria, seguranca ou cumprimento legal.",
          ],
        },
        {
          title: "Callback para a Meta",
          body: [
            "Para configuracao tecnica no painel da Meta, a URL de callback de exclusao de dados deste sistema e /api/meta/data-deletion.",
            "Para uma pagina de instrucoes, use esta propria URL publica: /exclusao-de-dados.",
          ],
        },
      ]}
    />
  );
}
