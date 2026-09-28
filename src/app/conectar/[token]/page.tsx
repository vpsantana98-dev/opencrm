"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, Loader2, RefreshCw, Smartphone } from "lucide-react";

import { AppLogo } from "@/components/brand/app-logo";

/**
 * Página PÚBLICA de conexão (Portal do Cliente). SEM login: o
 * responsável do cliente abre o link que a agência mandou e escaneia o
 * QR com o WhatsApp dele. O token na URL identifica o cliente; toda a
 * lógica (criar instância, QR, detectar conexão) roda pelos endpoints
 * -public, que validam o token pelo hash.
 *
 * O QR só é gerado quando a pessoa clica. Antes ele nascia junto com a
 * página e se renovava sozinho para sempre, então um link aberto e
 * esquecido numa aba ficava queimando código atrás de código contra a
 * Evolution. Agora o relógio só começa a correr quando alguém está de
 * fato olhando para a tela, com o celular na mão.
 */

/** Vida útil de um QR antes de ser trocado por um novo, em segundos. */
const QR_TTL_SECONDS = 45;

export default function ConnectPage() {
  const params = useParams();
  const token = String(params.token ?? "");

  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState(false);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(QR_TTL_SECONDS);
  const connectedRef = useRef(false);

  const fetchQr = useCallback(async () => {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch("/api/whatsapp/evolution/connect-public", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (res.status === 404) {
        setInvalid(true);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { qr?: string };
      // Qualquer falha (500, timeout, qr ausente) precisa virar estado de
      // erro com "tentar de novo": um return silencioso deixava a tela
      // presa em "Gerando o código..." para sempre.
      if (!res.ok || !body.qr) {
        setError(true);
        return;
      }
      setQr(body.qr);
      setSecondsLeft(QR_TTL_SECONDS);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }, [token]);

  // Cronômetro do QR: conta para trás enquanto há código na tela e pede
  // um novo ao zerar. Fica visível porque um QR que some sem aviso passa
  // a impressão de que a tela travou.
  useEffect(() => {
    if (!qr || connected) return;
    const id = setInterval(() => {
      setSecondsLeft((s) => {
        if (s > 1) return s - 1;
        if (!connectedRef.current) void fetchQr();
        return QR_TTL_SECONDS;
      });
    }, 1_000);
    return () => clearInterval(id);
  }, [qr, connected, fetchQr]);

  // Polling do status. Roda desde que a página abre, mesmo antes de
  // gerar QR: se o número já estiver conectado, a pessoa vê a
  // confirmação em vez de um botão que não precisa apertar.
  useEffect(() => {
    let stop = false;
    const check = async () => {
      try {
        const res = await fetch(
          `/api/whatsapp/evolution/status-public?token=${encodeURIComponent(token)}`,
          { cache: "no-store" },
        );
        const body = (await res.json().catch(() => ({}))) as {
          valid?: boolean;
          connected?: boolean;
          account_name?: string | null;
        };
        if (stop) return;
        if (body.valid === false) {
          setInvalid(true);
          return;
        }
        if (body.account_name) setAccountName(body.account_name);
        if (body.connected) {
          connectedRef.current = true;
          setConnected(true);
          setQr(null);
        }
      } catch {
        // Falha de rede no polling não vira erro de tela: a próxima
        // rodada tenta de novo em 3s.
      }
    };
    void check();
    const id = setInterval(() => {
      if (!stop) void check();
    }, 3_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [token]);

  const mmss = `${String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:${String(
    secondsLeft % 60,
  ).padStart(2, "0")}`;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-4">
      <AppLogo className="h-7 w-auto text-foreground" />

      <div className="w-full max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-xl sm:p-8">
        <div className="flex flex-col gap-1 border-b border-border pb-5">
          <h1 className="text-lg font-semibold text-foreground">
            Conexão WhatsApp
          </h1>
          {accountName ? (
            <p className="text-sm text-muted-foreground">
              Conectando para:{" "}
              <span className="font-medium text-primary">{accountName}</span>
            </p>
          ) : null}
        </div>

        {invalid ? (
          <div className="mt-6 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-600 dark:text-amber-300">
            Este link é inválido ou expirou. Peça um novo à agência.
          </div>
        ) : connected ? (
          <div className="mt-6 flex flex-col items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-8 text-center text-emerald-600 dark:text-emerald-300">
            <CheckCircle2 className="size-10" />
            <p className="text-base font-semibold">WhatsApp conectado!</p>
            <p className="text-sm opacity-80">
              Tudo pronto. Pode fechar esta página.
            </p>
          </div>
        ) : qr ? (
          // Duas colunas no desktop (código à esquerda, instruções à
          // direita) e empilhado no celular, que é de onde a pessoa
          // costuma abrir o link que recebeu.
          <div className="mt-6 grid gap-6 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
            <div className="mx-auto rounded-xl bg-white p-3 shadow-sm">
              {/* QR vem como data:image/png;base64 do servidor */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qr}
                alt="QR Code para conectar o WhatsApp"
                className="size-56"
                style={{ imageRendering: "pixelated" }}
              />
            </div>

            <div className="flex flex-col gap-4">
              <div
                className="flex items-baseline gap-2"
                aria-live="off"
                aria-label={`Novo código em ${secondsLeft} segundos`}
              >
                <span className="font-mono text-3xl font-semibold text-foreground tabular-nums">
                  {mmss}
                </span>
                <span className="text-xs text-muted-foreground">
                  até o próximo código
                </span>
              </div>

              <div>
                <p className="text-sm font-medium text-foreground">
                  Escaneie o QR Code
                </p>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                  <li>Abra o WhatsApp no seu celular.</li>
                  <li>
                    Toque em{" "}
                    <span className="font-medium text-foreground">
                      Aparelhos conectados
                    </span>
                    , depois{" "}
                    <span className="font-medium text-foreground">
                      Conectar aparelho
                    </span>
                    .
                  </li>
                  <li>Aponte a câmera para o código ao lado.</li>
                </ol>
              </div>

              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Verificando a conexão automaticamente
              </p>

              <button
                type="button"
                onClick={fetchQr}
                disabled={busy}
                className="inline-flex w-fit items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                Atualizar QR Code
              </button>
            </div>
          </div>
        ) : error ? (
          <div className="mt-6 flex flex-col items-center gap-3 py-8 text-center">
            <Smartphone className="size-9 text-muted-foreground" />
            <p className="text-sm text-foreground">
              Não conseguimos gerar o código agora.
            </p>
            <p className="text-xs text-muted-foreground">
              Verifique a conexão e tente de novo.
            </p>
            <button
              type="button"
              onClick={fetchQr}
              disabled={busy}
              className="mt-1 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Tentar novamente
            </button>
          </div>
        ) : (
          // Estado inicial: nada de QR até a pessoa dizer que está pronta.
          <div className="mt-6 flex flex-col items-center gap-4 py-8 text-center">
            <span className="flex size-16 items-center justify-center rounded-2xl bg-primary-soft text-primary">
              <Smartphone className="size-8" />
            </span>
            <div>
              <p className="text-base font-semibold text-foreground">
                Conectar WhatsApp
              </p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Clique no botão abaixo para gerar o QR Code. Tenha o celular do
                número de atendimento em mãos: o código vale por poucos
                segundos.
              </p>
            </div>
            <button
              type="button"
              onClick={fetchQr}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Smartphone className="size-4" />
              )}
              Gerar QR Code
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
