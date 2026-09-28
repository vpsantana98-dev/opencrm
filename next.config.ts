import type { NextConfig } from "next";

// Build marker 2026-07-30: força um build limpo do app (o Easypanel
// reaproveitou um build em cache e não regravou a NEXT_PUBLIC_SUPABASE_
// ANON_KEY nova; mudar um arquivo do build quebra o cache e re-inlina a
// chave certa). Pode remover depois.

/**
 * Origin of this deploy's Supabase, derived from the same env var the
 * browser client already uses.
 *
 * Why derive instead of hard-coding `*.supabase.co`: a self-hosted
 * Supabase (Easypanel, Coolify, docker-compose) answers on your own
 * domain, which that wildcard never matches. The CSP then rejects the
 * app's calls to its OWN database when CSP is enforced. Reading
 * the origin from NEXT_PUBLIC_SUPABASE_URL covers both hosted and
 * self-hosted with no per-deploy edit.
 *
 * Falls back to the hosted wildcard when the var is missing or
 * unparseable, so a malformed value degrades to the old behaviour
 * instead of emitting a header with `undefined` in it. (A build with
 * the var missing fails later anyway, on the client factories' `!`
 * assertions — which is why CI sets a dummy URL.)
 *
 * Note this is evaluated at BUILD time: Next bakes `headers()` into
 * .next/routes-manifest.json, so `next start` never re-reads the env.
 * The value that matters is the one present when the image is built.
 */
function supabaseCspOrigins(): { origin: string; socket: string } {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (raw) {
    try {
      const { protocol, host } = new URL(raw);
      if (protocol === "https:" || protocol === "http:") {
        return {
          origin: `${protocol}//${host}`,
          socket: `${protocol === "https:" ? "wss:" : "ws:"}//${host}`,
        };
      }
    } catch {
      // Malformed URL — fall through to the hosted wildcard below.
    }
  }
  return { origin: "https://*.supabase.co", socket: "wss://*.supabase.co" };
}

const SUPABASE_CSP = supabaseCspOrigins();

/**
 * Baseline security headers applied to every response.
 *
 * CSP is enforced. Inline scripts/styles remain allowed for the current
 * Next.js and Tailwind runtime, while unlisted origins, framing, unsafe
 * form targets, and unexpected network calls are blocked.
 *
 * The rest of the headers are straight blocks, safe to enforce today:
 *   - HSTS: only meaningful on HTTPS (no-op on http://localhost).
 *   - X-Content-Type-Options / X-Frame-Options / Referrer-Policy:
 *     baseline OWASP hardening, no behavioural cost.
 *   - Permissions-Policy: we don't use camera / microphone / etc, so
 *     deny them. A supply-chain compromise or a forgotten plugin
 *     can't silently opt back in.
 */
const SECURITY_HEADERS = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    // Microphone is allowed for same-origin (`self`) so the inbox
    // composer can record voice notes via MediaRecorder. Everything
    // else stays denied — a compromised dependency can't silently grab
    // the camera / geolocation / etc.
    key: "Permissions-Policy",
    value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js needs 'unsafe-inline' for its inline hydration script
      // and 'unsafe-eval' in dev + some production optimisations.
      // Nonce-based CSP is a later project.
      `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
      // Tailwind + inline style attributes on lots of components.
      "style-src 'self' 'unsafe-inline'",
      // Supabase public-bucket avatars, contact avatars (arbitrary
      // https URLs paste-able from the UI), OG images, data URLs for
      // tiny inline assets.
      "img-src 'self' data: blob: https:",
      // Outbound media previews (blob: from MediaRecorder + file picker)
      // and Supabase public-bucket audio/video the inbox renders.
      `media-src 'self' blob: ${SUPABASE_CSP.origin}`,
      "font-src 'self' data:",
      // Supabase REST + realtime (WSS). All Meta API calls happen
      // server-side, so graph.facebook.com does not belong here.
      `connect-src 'self' ${SUPABASE_CSP.origin} ${SUPABASE_CSP.socket}`,
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
] as const;

const nextConfig: NextConfig = {
  /**
   * Cache-Control policy.
   *
   * Why this exists:
   *   Hostinger's CDN was applying `s-maxage=31536000` (1 year) to
   *   prerendered HTML pages by default. When a new deploy shipped
   *   fresh Turbopack chunk hashes, the edge kept serving year-old
   *   HTML referencing chunk filenames that no longer existed on
   *   disk — result: HTML 200, every /_next/static/*.js and .css
   *   came back 404, the page rendered unstyled. Private/incognito
   *   did nothing because the cache is server-side.
   *
   * Strategy:
   *   - /_next/static/* — leave to Next. Turbopack dev chunks can go
   *     stale if we force immutable caching here; Next already emits
   *     the correct production headers for hashed assets.
   *   - /api/*          — no-store. API responses are per-user and
   *     must never be shared across requests at the edge.
   *   - Everything else — public, brief s-maxage + generous
   *     stale-while-revalidate. The edge serves instantly from cache
   *     for the first 5 min, then returns cached content while
   *     refreshing in the background for up to 24 h. A deploy's
   *     chunk-hash drift self-heals within ~5 min with no user-
   *     visible latency.
   *
   *   Note: dynamic dashboard routes (/inbox, /contacts, /pipelines,
   *   /broadcasts, etc.) are server-rendered per request — Next.js
   *   and Supabase auth already prevent them from being served
   *   from a shared cache. The s-maxage here is a ceiling; Next.js
   *   and auth middleware still set `private` / `no-store` for
   *   per-user responses.
   *
   * Security headers are appended via a separate catch-all rule
   * below — Next.js merges headers from every matching rule, so
   * they apply to every response regardless of which cache rule
   * matched.
   */
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      {
        source: "/:path((?!_next/static|_next/image|api).*)",
        headers: [
          {
            // App shell HTML must always be revalidated — never served
            // stale. The previous `stale-while-revalidate=86400` let the
            // browser keep a day-old page (referencing chunk hashes from
            // the previous deploy), which showed a mix of old + new after
            // every deploy ("page went back to English"). `must-revalidate`
            // with `max-age=0` forces a conditional request each load, so a
            // new deploy is picked up immediately; hashed /_next/static
            // assets keep their own long immutable caching (rule excluded
            // above), so this costs only a cheap 304 on navigation.
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate",
          },
        ],
      },
      {
        // Security headers on every response, including /_next/static
        // assets (nosniff matters there) and /api/* (HSTS + referrer-
        // policy don't hurt).
        source: "/:path*",
        headers: [...SECURITY_HEADERS],
      },
    ];
  },
};

export default nextConfig;
