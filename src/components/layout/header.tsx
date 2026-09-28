"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Menu } from "lucide-react";
import { ModeToggle } from "@/components/layout/mode-toggle";
import { NotificationsBell } from "@/components/layout/notifications-bell";
import { GlobalSearch } from "@/components/layout/global-search";
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher";
import { WhatsAppHeaderStatus } from "@/components/layout/whatsapp-header-status";
import { resolveSection } from "@/lib/nav/page-titles";

interface HeaderProps {
  /** Wired to the shell's drawer state. Used only on mobile — the
   *  hamburger button is hidden on lg+. */
  onOpenSidebar?: () => void;
}

export function Header({ onOpenSidebar }: HeaderProps) {
  const pathname = usePathname();
  const { title, base } = resolveSection(pathname);
  // Sub-rota (ex.: /broadcasts/123): oferece "voltar" pra seção.
  const isSubRoute = pathname !== base && pathname.startsWith(base + "/");

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-4 lg:px-6">
      <div className="flex min-w-0 items-center gap-2">
        {/* Hamburger — mobile only. 44×44 hit target per Apple HIG. */}
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label="Abrir menu"
          className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* Voltar pra seção em sub-rotas (detalhe/edição/logs). */}
        {isSubRoute && (
          <Link
            href={base}
            aria-label={`Voltar para ${title}`}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        )}

        {/* Cada página já tem seu próprio título (h1). No topo de seção o
            header NÃO repete o título (evita "Clientes" duas vezes na tela);
            em sub-rotas ele vira trilha clicável de volta à seção. */}
        {isSubRoute && (
          <div className="flex min-w-0 items-center gap-1.5">
            <Link
              href={base}
              className="truncate text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              {title}
            </Link>
            <span className="text-sm text-muted-foreground">›</span>
          </div>
        )}
      </div>

      {/* Busca global — centro do header, como o padrão de CRM. Escondida
          no mobile (o espaço é do título/hambúrguer); lá o atalho continua
          valendo se houver teclado. */}
      <div className="hidden min-w-0 flex-1 justify-center px-2 md:flex">
        <GlobalSearch />
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        {/* Cliente ativo no topo, sempre visível: quem opera várias contas
            precisa ver EM QUAL está antes de agir. Continua também no
            rodapé da sidebar (mesmo componente, outra variante). */}
        <div className="hidden lg:block">
          <WorkspaceSwitcher variant="inline" />
        </div>
        {/* Colado no seletor de cliente: as duas informações respondem
            juntas a "qual cliente, e por qual número?". Enquanto o
            WhatsApp vivia no rodapé da sidebar, dava para ler o cliente
            no topo sem ver que o número dele estava fora do ar. */}
        <WhatsAppHeaderStatus />
        <NotificationsBell />
        <ModeToggle />
      </div>
    </header>
  );
}
