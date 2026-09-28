/**
 * Título de cada seção do app, em um lugar só.
 *
 * Três superfícies consomem isto e precisam concordar: o rótulo do
 * header, a trilha de "voltar" em sub-rotas e o título da aba do
 * navegador. Quando o mapa vivia dentro do header, a aba mostrava
 * sempre "OpenCRM" — e qualquer rota nova nascia sem título em duas das
 * três superfícies.
 *
 * Mantenha em sincronia com `navItems` (src/components/layout/sidebar.tsx).
 */
export const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/clients": "Clientes",
  "/inbox": "Caixa de Entrada",
  "/contacts": "Contatos",
  "/team": "Equipe",
  "/conversion-events": "Eventos de Conversão",
  "/reports": "Relatórios",
  "/pipelines": "Funis",
  "/broadcasts": "Disparos",
  // Rota mantida: /meta-ads virou redirect para as Configurações, mas o
  // navegador ainda passa por ela. Sem esta entrada, o título piscaria
  // "Dashboard" (o padrão de resolveSection) durante o pulo.
  "/meta-ads": "Rastreamento de Anúncios",
  "/tracking-links": "Links Rastreáveis",
  "/automations": "Automações",
  "/flows": "Fluxos",
  "/agents": "Agentes de IA",
  "/settings": "Configurações",
  "/notifications": "Notificações",
};

/** Nome do produto — prefixo do título da aba. */
export const APP_NAME = "OpenCRM";

/**
 * Título + caminho-base da seção de um pathname.
 *
 * O casamento por prefixo exige a barra (`base + "/"`) para `/clients`
 * não engolir uma futura `/clients-xyz`. Rota desconhecida cai no
 * Dashboard, que é a home do app.
 */
export function resolveSection(pathname: string): {
  title: string;
  base: string;
} {
  if (PAGE_TITLES[pathname]) {
    return { title: PAGE_TITLES[pathname], base: pathname };
  }
  const match = Object.entries(PAGE_TITLES).find(([path]) =>
    pathname.startsWith(path + "/"),
  );
  if (match) return { title: match[1], base: match[0] };
  return { title: "Dashboard", base: "/dashboard" };
}

/** Título da aba: "OpenCRM · Funis". */
export function documentTitleFor(pathname: string): string {
  const { title } = resolveSection(pathname);
  return `${APP_NAME} · ${title}`;
}
