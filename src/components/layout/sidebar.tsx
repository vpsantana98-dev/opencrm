"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { WhatsAppStatusPill } from "./whatsapp-status-pill";
import { AppLogo, AppSymbol } from "@/components/brand/app-logo";
import { useTotalUnread } from "@/hooks/use-total-unread";
import {
  Activity,
  BarChart3,
  Bot,
  Building2,
  Crown,
  GitBranch,
  HelpCircle,
  LayoutDashboard,
  LifeBuoy,
  Link2,
  LogOut,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  Settings,
  Shield,
  User,
  UserCog,
  Users,
  UsersRound,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import type { AccountRole } from "@/lib/auth/roles";

// Per-role chip metadata used in the sidebar's account strip + the
// Members tab roster. Keeping this near both consumers in a single
// place avoids drift between the two surfaces — when a designer
// wants to recolour "agent" rows, this is the one diff.
const ROLE_CHIP: Record<
  AccountRole,
  { icon: typeof Crown; label: string; className: string }
> = {
  owner: {
    icon: Crown,
    label: "Proprietário",
    // Amber: scarce, immutable, "the boss" — gets visual emphasis.
    className:
      "border-amber-500/40 bg-amber-500/10 text-amber-300",
  },
  admin: {
    icon: Shield,
    label: "Admin",
    // Primary-tinted: significant but not as scarce as owner.
    className:
      "border-primary/40 bg-primary/10 text-primary",
  },
  agent: {
    icon: UserCog,
    label: "Agente",
    // Neutral slate: the operational default.
    className:
      "border-border bg-muted text-foreground",
  },
  viewer: {
    icon: User,
    label: "Visualizador",
    // Muted slate: read-only role; visually quieter than agent.
    className:
      "border-border bg-card text-muted-foreground",
  },
};
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /**
   * When true, the nav row renders a small "Beta" chip after the label.
   * Purely informational — doesn't affect routing or access.
   */
  beta?: boolean;
  section?: "operation" | "analysis" | "automation";
}

// Ordem definida a partir de dois pareceres (gestor de tráfego + CS): ambos
// põem Clientes e Caixa de Entrada no topo (primeiras decisões do dia) e
// tratam o Dashboard como consulta, não grind. Operação diária em cima;
// análise/aquisição no meio; setup (automação/IA/fluxos) embaixo.
const navItems: NavItem[] = [
  // — Operação diária —
  // Sem "/notificações" aqui: o sino no header substituiu a página, o
  // item da sidebar e o badge (main, 77feb9f). O agrupamento por
  // `section` deste PR continua valendo para o resto.
  { href: "/clients", label: "Clientes", icon: Building2, section: "operation" },
  { href: "/inbox", label: "Caixa de Entrada", icon: MessageSquare, section: "operation" },
  { href: "/pipelines", label: "Funis", icon: GitBranch, section: "operation" },
  { href: "/contacts", label: "Contatos", icon: Users, section: "operation" },
  // Quem atende o quê é decisão do dia a dia — por isso fica em Operação,
  // não enterrado em Configurações (onde estava).
  { href: "/team", label: "Equipe", icon: UsersRound, section: "operation" },
  // — Análise & aquisição —
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, section: "analysis" },
  { href: "/reports", label: "Relatórios", icon: BarChart3, section: "analysis" },
  // "Rastreamento de Anúncios" saiu daqui: a página /meta-ads renderizava
  // exatamente os mesmos dois componentes da aba "Rastreamento" das
  // Configurações. Duas portas para a mesma sala deixavam a dúvida de
  // ter que configurar nos dois lugares. A rota virou redirect.
  { href: "/tracking-links", label: "Links Rastreáveis", icon: Link2, section: "analysis" },
  { href: "/conversion-events", label: "Eventos de Conversão", icon: Activity, section: "analysis" },
  { href: "/broadcasts", label: "Disparos", icon: Radio, section: "analysis" },
  // — Automação / setup —
  { href: "/automations", label: "Automações", icon: Zap, section: "automation" },
  { href: "/agents", label: "Agentes de IA", icon: Bot, section: "automation" },
  { href: "/flows", label: "Fluxos", icon: Workflow, beta: true, section: "automation" },
];

const bottomNavItems = [
  { href: "/settings", label: "Configurações", icon: Settings },
];

// Ajuda e Suporte moram no MENU, abaixo de Configurações — e não no
// rodapé fixo, onde estavam como uma linha miúda de 11px. São links
// externos (WhatsApp e e-mail), por isso <a> e não <Link>: o roteador
// do Next não deve tentar navegar para fora do app.
const externalLinks = [
  {
    href: "https://github.com/vpsantana98-dev/opencrm/issues",
    label: "Ajuda",
    icon: HelpCircle,
    externo: true,
  },
  {
    href: "mailto:vpsantana98@gmail.com?subject=Suporte%20OpenCRM",
    label: "Suporte",
    icon: LifeBuoy,
    externo: true,
  },
];

// Versão exibida no rodapé. Constante literal de propósito: importar o
// package.json aqui puxaria o arquivo inteiro pro bundle do cliente.
// Ao subir versão, atualize aqui junto com o package.json.
const APP_VERSION = "0.8.0";

interface SidebarProps {
  /** Controlled on mobile by the Header's hamburger button. Ignored on lg+. */
  open?: boolean;
  onClose?: () => void;
}

export function Sidebar({ open = false, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { profile, accountRole, isClientLogin, signOut } = useAuth();

  // Login de cliente (portal scoped) não vê as telas de agência: o hub
  // "Clientes" some do menu e o seletor de workspace some do rodapé.
  const visibleNavItems = isClientLogin
    ? navItems.filter((item) => item.href !== "/clients")
    : navItems;

  // Menu minimizado (só desktop). Persistido. As classes `collapsed &&
  // "lg:hidden"` afetam apenas o lg+, então o drawer mobile continua
  // sempre completo.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem("OpenCRM.sidebar.collapsed") === "1")
        setCollapsed(true);
    } catch {
      /* ignore */
    }
  }, []);
  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem("OpenCRM.sidebar.collapsed", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  const totalUnread = useTotalUnread();

  // Close the drawer when route changes — users opened it to navigate,
  // so once they pick a destination the drawer should get out of the way.
  useEffect(() => {
    onClose?.();
    // Only pathname drives this — onClose identity doesn't need to re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Lock body scroll and allow Escape to close while the drawer is open on
  // mobile. No-ops on desktop because the sidebar isn't positioned there.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop — only exists on mobile and only when open. Clicking
          it closes the drawer. Hidden from lg+ since the sidebar is
          part of the main flex row there. */}
      <button
        type="button"
        aria-label="Fechar menu"
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-background/70 backdrop-blur-sm transition-opacity lg:hidden",
          open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          // Mobile: fixed drawer that slides in from the left.
          "fixed inset-y-0 left-0 z-40 flex h-full w-64 flex-col border-r border-border bg-card",
          "transition-transform duration-200 ease-out will-change-transform",
          open ? "translate-x-0" : "-translate-x-full",
          // Desktop: static, always visible — reset all the mobile framing.
          "lg:static lg:z-0 lg:translate-x-0 lg:transition-none",
          collapsed ? "lg:w-16" : "lg:w-60",
        )}
        aria-label="Principal"
      >
        {/* Logo row. On mobile we put a close button here; on desktop the
            close button is hidden since the sidebar is always-visible. */}
        <div
          className={cn(
            "flex h-14 shrink-0 items-center gap-2 border-b border-border px-4",
            collapsed ? "lg:justify-center lg:px-2" : "justify-between",
          )}
        >
          <Link
            href="/dashboard"
            /* items-end, não items-center: no SVG da marca o símbolo sobe
               bem mais alto que as letras, então centralizar a CAIXA joga
               o "CRM" para cima em relação ao "OpenCRM". A linha de base do
               wordmark fica rente ao fundo do SVG — alinhar pelo fundo é o
               que casa os dois textos. */
            className="flex items-end gap-1.5 text-foreground"
            aria-label="OpenCRM"
          >
            {/* Logo completo; no desktop minimizado vira só o símbolo. */}
            <AppLogo
              className={cn("h-6 w-auto", collapsed && "lg:hidden")}
            />
            <AppSymbol
            className={cn("hidden h-6 w-auto", collapsed && "lg:block")}
          />
          </Link>
          {/* Minimizar/expandir (só desktop). */}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expandir menu" : "Minimizar menu"}
            title={collapsed ? "Expandir menu" : "Minimizar menu"}
            className={cn(
              "hidden h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:flex",
              collapsed && "lg:hidden",
            )}
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
          {/* Fechar (só mobile). */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar menu"
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {/* Quando minimizado, o botão de expandir aparece sozinho abaixo da
            logo (o de minimizar fica escondido pra não competir). */}
        {collapsed ? (
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label="Expandir menu"
            title="Expandir menu"
            className="hidden h-8 shrink-0 items-center justify-center border-b border-border text-muted-foreground hover:bg-muted hover:text-foreground lg:flex"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        ) : null}

        {/* Main navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-2">
          <TooltipProvider delay={150}>
            {/* Group items by section */}
            {["operation", "analysis", "automation"].map((section, sectionIdx) => {
              const sectionItems = visibleNavItems.filter((item) => item.section === section);
              if (sectionItems.length === 0) return null;

              const sectionLabels: Record<string, string> = {
                operation: "Operação",
                analysis: "Análise & Aquisição",
                automation: "Automação",
              };

              return (
                <div key={section}>
                  {/* O respiro entre seções vem SÓ da margem do título
                      (`mt-3`). Havia aqui um <div className="my-4 mb-2" />
                      vazio fazendo o mesmo papel — como margens verticais
                      de irmãos colapsam, ele não somava espaço nenhum,
                      só escondia de onde vinha o espaçamento real. */}
                  {sectionIdx > 0 && collapsed && (
                    <Separator className="my-2 lg:my-2" />
                  )}
                  {!collapsed && (
                    <div
                      className={cn(
                        "px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground",
                        sectionIdx > 0 && "mt-2.5 mb-1",
                        sectionIdx === 0 && "mb-1",
                      )}
                    >
                      {sectionLabels[section]}
                    </div>
                  )}
                  <ul className="flex flex-col gap-0.5">
                    {sectionItems.map((item) => {
                      const isActive =
                        pathname === item.href ||
                        (item.href !== "/dashboard" && pathname.startsWith(item.href));

                      const showUnreadDot =
                        item.href === "/inbox" && totalUnread > 0 && !isActive;

                      const linkElement = (
                        <Link
                          href={item.href}
                          title={item.label}
                          aria-current={isActive ? "page" : undefined}
                          className={cn(
                            // py-2.5 no mobile (alvo de toque), lg:py-1.5 no desktop: com o
                            // ponteiro do mouse a linha de 32px continua confortável
                            // e são 4px x 14 itens a menos de altura total — a
                            // diferença entre caber na tela e virar scroll.
                            "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:py-1.5",
                            collapsed && "lg:justify-center lg:gap-0 lg:px-2",
                            isActive
                              ? "bg-primary/10 text-foreground"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground",
                          )}
                        >
                          <item.icon
                            className={cn("h-4 w-4 shrink-0", isActive && "text-primary")}
                          />
                          <span className={cn("flex-1", collapsed && "lg:hidden")}>
                            {item.label}
                          </span>
                          {item.beta && (
                            <span
                              aria-label="Recurso beta"
                              className={cn(
                                "rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-300",
                                collapsed && "lg:hidden",
                              )}
                            >
                              Beta
                            </span>
                          )}
                          {showUnreadDot && (
                            <span
                              aria-label={`${totalUnread} conversa${totalUnread === 1 ? "" : "s"} não lida${totalUnread === 1 ? "" : "s"}`}
                              className="relative flex h-2 w-2"
                            >
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                            </span>
                          )}
                        </Link>
                      );

                      return (
                        <li key={item.href}>
                          {collapsed ? (
                            <Tooltip>
                              <TooltipTrigger render={linkElement}>
                              </TooltipTrigger>
                              <TooltipContent side="right">
                                {item.label}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            linkElement
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}

            <div className="my-2 border-t border-border" />

            <ul className="flex flex-col gap-0.5">
              {bottomNavItems.map((item) => {
                const isActive = pathname.startsWith(item.href);

                const linkElement = (
                  <Link
                    href={item.href}
                    title={item.label}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      // py-2.5 no mobile (alvo de toque), lg:py-1.5 no desktop: com o
                            // ponteiro do mouse a linha de 32px continua confortável
                            // e são 4px x 14 itens a menos de altura total — a
                            // diferença entre caber na tela e virar scroll.
                            "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:py-1.5",
                      collapsed && "lg:justify-center lg:gap-0 lg:px-2",
                      isActive
                        ? "bg-primary/10 text-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <item.icon
                      className={cn("h-4 w-4 shrink-0", isActive && "text-primary")}
                    />
                    <span className={cn(collapsed && "lg:hidden")}>
                      {item.label}
                    </span>
                  </Link>
                );

                return (
                  <li key={item.href}>
                    {collapsed ? (
                      <Tooltip>
                        <TooltipTrigger render={linkElement}>
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          {item.label}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      linkElement
                    )}
                  </li>
                );
              })}
            </ul>

            {/* Ajuda e Suporte. Mesma aparencia dos itens acima, mas
                sao <a> externos: WhatsApp e e-mail saem do app, e o
                roteador do Next nao deve tentar navegar para eles.
                Nunca ficam "ativos" — nao ha rota interna para casar. */}
            <ul className="mt-0.5 flex flex-col gap-0.5">
              {externalLinks.map((item) => {
                const linkElement = (
                  <a
                    href={item.href}
                    title={item.label}
                    {...(item.externo
                      ? { target: "_blank", rel: "noreferrer" }
                      : {})}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:py-1.5",
                      collapsed && "lg:justify-center lg:gap-0 lg:px-2",
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span className={cn(collapsed && "lg:hidden")}>
                      {item.label}
                    </span>
                  </a>
                );

                return (
                  <li key={item.href}>
                    {collapsed ? (
                      <Tooltip>
                        <TooltipTrigger render={linkElement}>
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          {item.label}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      linkElement
                    )}
                  </li>
                );
              })}
            </ul>

          </TooltipProvider>
        </nav>

        {/* User section */}
        <div className="shrink-0 border-t border-border p-2">
          {/* Só no mobile. No desktop o estado do WhatsApp subiu para o
              header, colado no seletor de cliente — mesmo caminho que o
              seletor de conta já fez. Aqui embaixo ele custava altura na
              área fixa do rodapé, que é o que empurra o menu para o
              scroll; no mobile o header não tem espaço, então fica. */}
          <div className="mb-1.5 lg:hidden">
            <WhatsAppStatusPill collapsed={collapsed} />
          </div>
          {/* Seletor de conta saiu daqui: ele agora vive no header, sempre
              visível. Mantê-lo nos dois lugares só engordava a área fixa do
              rodapé — que é justamente o que empurrava o menu para o scroll.
              No mobile o header fica escondido, então lá ele continua. */}
          {!isClientLogin ? (
            <div className="lg:hidden">
              <WorkspaceSwitcher />
            </div>
          ) : null}
          {/* A faixa com o nome da conta saiu daqui.
              Ela existia para dizer "você está operando NESTA conta" —
              papel que hoje é do seletor no header (desktop) e do
              WorkspaceSwitcher acima (mobile). Mantê-la repetia a mesma
              informação duas vezes seguidas: numa conta pessoal o nome da
              conta é o próprio e-mail do usuário, que reaparecia na linha
              logo abaixo. O selo de papel, que era a parte útil dela,
              subiu para a linha do usuário. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted/60 focus:bg-muted/60 focus:outline-none data-popup-open:bg-muted/60",
                collapsed && "lg:justify-center lg:px-2",
              )}
            >
              <Avatar className="size-8 shrink-0">
                {profile?.avatar_url ? (
                  <AvatarImage
                    src={profile.avatar_url}
                    alt={profile.full_name ?? "Avatar"}
                  />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
                  {profile?.full_name?.charAt(0)?.toUpperCase() ??
                    profile?.email?.charAt(0)?.toUpperCase() ??
                    "U"}
                </AvatarFallback>
              </Avatar>
              <div className={cn("min-w-0 flex-1", collapsed && "lg:hidden")}>
                <p className="truncate text-sm font-medium text-foreground">
                  {profile?.full_name ?? "Usuário"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {profile?.email ?? ""}
                </p>
              </div>
              {/* Selo de papel — veio da faixa removida acima. Aqui ele
                  fica ao lado de QUEM tem o papel, que é onde ele
                  significa alguma coisa, e sem custar uma linha própria.
                  Some no menu recolhido, onde não haveria espaço. */}
              {accountRole ? (
                (() => {
                  const meta = ROLE_CHIP[accountRole];
                  const Icon = meta.icon;
                  return (
                    <span
                      title={meta.label}
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                        meta.className,
                        collapsed && "lg:hidden",
                      )}
                    >
                      <Icon className="size-3" />
                    </span>
                  );
                })()
              ) : null}
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side="top"
              sideOffset={6}
              className="min-w-56 bg-popover text-popover-foreground ring-border"
            >
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=profile"
                    onClick={onClose}
                    className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                  />
                }
              >
                <User className="size-4" />
                Perfil
              </DropdownMenuItem>
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=whatsapp"
                    onClick={onClose}
                    className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                  />
                }
              >
                <Settings className="size-4" />
                Configurações
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem
                onClick={signOut}
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
              >
                <LogOut className="size-4" />
                Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <div
            className={cn(
              "mt-1 px-1 text-right text-[10px] tabular-nums text-muted-foreground/40",
              collapsed && "lg:hidden",
            )}
          >
            v{APP_VERSION}
          </div>
        </div>
      </aside>
    </>
  );
}
