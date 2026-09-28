"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { documentTitleFor } from "@/lib/nav/page-titles";

/**
 * Mantém o título da aba do navegador em sincronia com a página aberta
 * ("OpenCRM · Funis").
 *
 * Por que em JS e não pelo `metadata` do Next: as telas do dashboard são
 * client components (`"use client"`), e `export const metadata` só vale
 * em server component. Trocar todas para poder exportar metadata seria
 * uma refatoração grande para um ganho pequeno; este componente resolve
 * com um efeito, lendo o MESMO mapa que o header usa.
 *
 * Não renderiza nada.
 */
export function PageTitleSync() {
  const pathname = usePathname();

  useEffect(() => {
    document.title = documentTitleFor(pathname);
  }, [pathname]);

  return null;
}
