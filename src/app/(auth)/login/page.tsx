"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { AppLogo, AppSymbol } from "@/components/brand/app-logo";

// `useSearchParams` opts the component out of static prerendering
// unless it sits under a Suspense boundary. We split the form into
// a child component so the outer page can prerender the chrome
// (background, painel da marca) while the form hydrates with the
// query string on the client.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const searchParams = useSearchParams();
  // Forwarded from `/join/<token>` when the visitor already has an
  // account. After a successful sign-in we send them to the join
  // page to accept rather than to /dashboard.
  const inviteToken = searchParams.get("invite");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    if (inviteToken) {
      router.push(`/join/${encodeURIComponent(inviteToken)}`);
    } else {
      router.push("/dashboard");
    }
  };

  return (
    // Duas colunas no desktop, uma no celular. O painel da direita é
    // decorativo — por isso ele some primeiro quando falta espaço, e o
    // formulário (a única parte funcional) fica com a tela inteira.
    <div className="grid min-h-screen grid-cols-1 bg-background lg:grid-cols-2">
      {/* ---------- Coluna do formulário ---------- */}
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <AppLogo className="h-8 w-auto text-foreground" />

          <h1 className="mt-8 font-heading text-2xl font-semibold tracking-tight text-foreground">
            {inviteToken ? "Entre para aceitar" : "Bem-vindo de volta"}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {inviteToken
              ? "Entre e levaremos você até o convite."
              : "Entre na sua conta para acessar o painel."}
          </p>

          <form onSubmit={handleLogin} className="mt-8 flex flex-col gap-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                // Ajuda o gerenciador de senhas do navegador a preencher
                // e a salvar — sem isto ele frequentemente ignora o form.
                autoComplete="email"
                placeholder="voce@exemplo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Senha</Label>
                <Link
                  href="/forgot-password"
                  className="text-sm text-primary transition-colors hover:text-primary/80"
                >
                  Esqueci minha senha
                </Link>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Digite sua senha"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  title={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showPassword ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
            </div>

            <Button type="submit" disabled={loading} className="mt-2 h-11 w-full">
              {loading ? <Spinner data-icon="inline-start" /> : null}
              {loading ? "Entrando…" : "Entrar"}
            </Button>
          </form>

          {/* Sem "Criar conta" aqui: o cadastro público foi fechado
              (não existe rota /signup). Um link para lugar nenhum é
              pior do que a ausência dele. Quem entra vem por convite. */}
          <p className="mt-8 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5 shrink-0" />
            Acesso restrito — o cadastro é feito por convite.
          </p>
        </div>
      </div>

      {/* ---------- Painel da marca ---------- */}
      {/* Puramente decorativo, então sai do fluxo de leitores de tela:
          quem navega por teclado ou leitor pula direto para o form. */}
      <div
        aria-hidden
        className="relative hidden overflow-hidden border-l border-border bg-card lg:flex lg:items-center lg:justify-center"
      >
        {/* Brilho da cor da marca. `pointer-events-none` para o halo
            nunca roubar clique de nada que venha por cima. */}
        <div
          className="pointer-events-none absolute -right-24 -top-24 size-[28rem] rounded-full opacity-25 blur-3xl"
          style={{
            background:
              "radial-gradient(circle, var(--primary) 0%, transparent 70%)",
          }}
        />
        <div
          className="pointer-events-none absolute -bottom-32 -left-20 size-[26rem] rounded-full opacity-20 blur-3xl"
          style={{
            background:
              "radial-gradient(circle, var(--primary) 0%, transparent 70%)",
          }}
        />

        <div className="relative flex max-w-md flex-col items-center px-12 text-center">
          <AppSymbol className="h-16 w-auto text-foreground" />
          <h2 className="mt-8 font-heading text-2xl font-semibold leading-snug tracking-tight text-foreground">
            Todo lead do WhatsApp, rastreado até a campanha que o trouxe.
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Conecte o WhatsApp, acompanhe cada conversa no funil e envie as
            conversões de volta para a Meta — com dado de venda, não só de
            clique.
          </p>
        </div>
      </div>
    </div>
  );
}
