"use client";

import { MembersTab } from "@/components/settings/members-tab";

/**
 * Equipe — gestão de quem tem acesso à conta.
 *
 * A tela já existia inteira, só que enterrada como aba dentro de
 * Configurações (`?tab=members`), onde ninguém procura: gerir quem
 * atende é trabalho do dia a dia, não configuração. Aqui ela vira item
 * de primeiro nível no menu.
 *
 * Reusa o MESMO componente, sem cópia — a aba antiga passou a redirecionar
 * para cá (ver settings/page.tsx), então não existem duas telas para
 * divergirem com o tempo.
 *
 * O `MembersTab` já renderiza o próprio cabeçalho visível; o h1 aqui é
 * só para leitor de tela, mantendo um h1 por página sem título repetido.
 */
export default function TeamPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <h1 className="sr-only">Equipe</h1>
      <MembersTab />
    </div>
  );
}
