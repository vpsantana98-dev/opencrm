import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { resolveMustChangePassword } from '@/lib/auth/must-change-password'

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // getUser() transparently refreshes an expired access token, which
  // ROTATES the refresh token and writes the new cookies onto
  // `supabaseResponse` via setAll() above. Any response we return in
  // place of `supabaseResponse` (every redirect / JSON branch below)
  // is a fresh object that does NOT carry those Set-Cookie headers, so
  // the rotated token never reaches the browser. The next request then
  // replays the old, now-consumed refresh token, the refresh fails, and
  // the session wedges — the user gets a broken reload after idling and
  // can only recover by manually clearing cookies (issue #288). Copy the
  // refreshed cookies onto whatever response we hand back to fix that.
  const withRefreshedCookies = <T extends NextResponse>(response: T): T => {
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie)
    })
    return response
  }

  // Senha temporária — usuário criado pelo admin precisa trocar a
  // senha antes de usar qualquer coisa. A flag vive em app_metadata
  // (só service role escreve) e getUser() acima já a trouxe fresca
  // do servidor de auth — nenhuma query extra aqui.
  const mustChange = resolveMustChangePassword(user, request.nextUrl.pathname)
  if (mustChange === 'forbid') {
    return withRefreshedCookies(
      NextResponse.json({ error: 'password_change_required' }, { status: 403 })
    )
  }
  if (mustChange === 'redirect') {
    const url = request.nextUrl.clone()
    url.pathname = '/trocar-senha'
    url.search = ''
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  // Cadastro fechado: /signup não existe mais. Links antigos caem
  // no login; ?invite= sobrevive para o fluxo de convite.
  if (!user && request.nextUrl.pathname === '/signup') {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  // Auth pages - redirect to dashboard if already logged in.
  // Exception: when an invite token is in the query string we
  // send the already-signed-in user to /join/<token> instead so
  // they can accept the invitation in one click. Without this,
  // a forwarded invite link to someone who's already signed in
  // would silently drop them on /dashboard.
  if (user && (
    request.nextUrl.pathname === '/login' ||
    request.nextUrl.pathname === '/signup' ||
    request.nextUrl.pathname === '/forgot-password'
  )) {
    const url = request.nextUrl.clone()
    const inviteToken = request.nextUrl.searchParams.get('invite')
    if (
      inviteToken &&
      (request.nextUrl.pathname === '/login' ||
        request.nextUrl.pathname === '/signup')
    ) {
      url.pathname = `/join/${encodeURIComponent(inviteToken)}`
      url.search = ''
    } else {
      url.pathname = '/dashboard'
      url.search = ''
    }
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  // Protected pages - redirect to login if not authenticated
  const protectedPaths = ['/dashboard', '/inbox', '/contacts', '/pipelines', '/broadcasts', '/automations', '/settings', '/trocar-senha', '/admin', '/tracking-links']
  if (!user && protectedPaths.some(path => request.nextUrl.pathname.startsWith(path))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  // API routes that need auth. Exceptions (no login): webhooks, and the
  // public connect endpoints (*-public) used by the client portal page
  // /conectar/[token], which authenticate by the token in the body/query,
  // not by session.
  if (!user && request.nextUrl.pathname.startsWith('/api/whatsapp/') &&
      !request.nextUrl.pathname.includes('/webhook') &&
      !request.nextUrl.pathname.endsWith('-public')) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
