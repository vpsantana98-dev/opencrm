import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import Script from "next/script";
import "./globals.css";
import { ThemeProvider } from "@/hooks/use-theme";
import { ThemedToaster } from "@/components/themed-toaster";
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  MODE_STORAGE_KEY,
  MODES,
  STORAGE_KEY,
  THEME_IDS,
} from "@/lib/themes";

// Identidade OpenCRM: Poppins (corpo/UI), Exo 2 (display/títulos),
// JetBrains Mono (labels/código).
//
// HOSPEDADAS NO PROJETO, e não via `next/font/google`. O motivo é uma
// quebra real de deploy: o Google troca os nomes dos arquivos .woff2
// dentro da MESMA versão da fonte, sem aviso. Quando isso acontece, o
// build guarda a URL antiga em cache, ela passa a devolver 404 e a
// construção falha inteira — em produção, nunca na máquina de quem
// desenvolve, porque lá o arquivo já está baixado. Aconteceu com o
// Exo 2 (v26) em 13/08/2026: 25 erros de "Module not found".
//
// Com os arquivos versionados aqui, o build não depende mais de rede e
// esse modo de falha deixa de existir. As três fontes são licença SIL
// Open Font, que permite redistribuição.
//
// Exo 2 e JetBrains Mono sao VARIAVEIS: um arquivo cobre toda a faixa
// de peso. Poppins nao e, entao vai um arquivo por peso — os mesmos
// cinco que o app usava antes.
const poppins = localFont({
  variable: "--font-sans",
  display: "swap",
  src: [
    { path: "./fonts/Poppins-300.woff2", weight: "300", style: "normal" },
    { path: "./fonts/Poppins-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/Poppins-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/Poppins-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/Poppins-700.woff2", weight: "700", style: "normal" },
  ],
});

const exo2 = localFont({
  variable: "--font-display",
  display: "swap",
  src: "./fonts/Exo2-Variable.woff2",
  // Faixa da fonte variavel: cobre de 100 a 900 com um arquivo so.
  weight: "100 900",
});

const jetbrainsMono = localFont({
  variable: "--font-mono-brand",
  display: "swap",
  src: "./fonts/JetBrainsMono-Variable.woff2",
  weight: "100 800",
});

export const metadata: Metadata = {
  // A marca vem PRIMEIRO: a aba do navegador corta o fim do texto quando
  // há muitas abertas, e o que precisa sobrar é "OpenCRM". As telas do
  // dashboard sobrescrevem isto em runtime (PageTitleSync) para virar
  // "OpenCRM · Funis"; este valor cobre login, portal e 404.
  title: {
    default: "OpenCRM",
    template: "OpenCRM · %s",
  },
  description: "OpenCRM: CRM de WhatsApp para agências.",
  robots: {
    index: false,
    follow: false,
  },
  icons: {
    icon: [{ url: "/icon" }],
  },
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#0D0D16",
  colorScheme: "dark light",
};

// Inline boot script — runs before React hydrates so the user's
// chosen accent (data-theme) AND mode (data-mode) are on the <html>
// element before first paint. Without this every page load flashes
// the server-rendered defaults for a frame before the React tree
// mounts and applies the picked values.
//
// Kept dependency-free (no imports, no JSX) — must be a string the
// browser can run as a single <script>. Knowledge of valid ids is
// sourced from the THEME_IDS / MODES constants so adding one doesn't
// silently break the boot path.
const THEME_BOOT_SCRIPT = `
(function(){
  var d = document.documentElement;
  try {
    var THEME_KEY = ${JSON.stringify(STORAGE_KEY)};
    var THEME_DEFAULT = ${JSON.stringify(DEFAULT_THEME)};
    var THEMES = ${JSON.stringify(THEME_IDS)};
    var savedTheme = localStorage.getItem(THEME_KEY);
    d.dataset.theme = THEMES.indexOf(savedTheme) !== -1 ? savedTheme : THEME_DEFAULT;

    var MODE_KEY = ${JSON.stringify(MODE_STORAGE_KEY)};
    var MODE_DEFAULT = ${JSON.stringify(DEFAULT_MODE)};
    var MODES = ${JSON.stringify(MODES)};
    var savedMode = localStorage.getItem(MODE_KEY);
    d.dataset.mode = MODES.indexOf(savedMode) !== -1 ? savedMode : MODE_DEFAULT;
  } catch (_e) {
    d.dataset.theme = ${JSON.stringify(DEFAULT_THEME)};
    d.dataset.mode = ${JSON.stringify(DEFAULT_MODE)};
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      data-theme={DEFAULT_THEME}
      data-mode={DEFAULT_MODE}
      className={`${poppins.variable} ${exo2.variable} ${jetbrainsMono.variable} h-full antialiased`}
      // The `theme-boot` script below rewrites `data-theme` and
      // `data-mode` on <html> from localStorage before React hydrates,
      // so for any non-default choice the client DOM intentionally
      // differs from the server-rendered defaults. suppressHydration-
      // Warning silences the expected mismatch — it only applies to
      // this element's own attributes, so genuine mismatches in
      // children still surface.
      suppressHydrationWarning
    >
      <head>
        <Script
          id="theme-boot"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }}
        />
      </head>
      <body
        className="min-h-full bg-background text-foreground font-sans"
        // Extensões de navegador (ColorZilla: cz-shortcut-listen,
        // Grammarly: data-gr-*) injetam atributos no <body> antes da
        // hidratação, e o React 19 acusa mismatch para atributos que o
        // servidor não renderizou. Mesma técnica do <html> acima: vale
        // só para os atributos DESTE elemento; mismatches reais nos
        // filhos continuam aparecendo.
        suppressHydrationWarning
      >
        <ThemeProvider>
          {children}
          <ThemedToaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
