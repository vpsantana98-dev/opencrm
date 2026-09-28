"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Unplug } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Conexão do ClickUp POR USUÁRIO (modo Ag�ncia). Cada membro cola a chave
 * pessoal dele; validamos e guardamos cifrada. Só aparece pro time
 * interno (o pai gateia por isInternal, e a API recusa quem não é).
 */
export function ClickUpConnect() {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/account/clickup", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { connected?: boolean };
      setConnected(!!body.connected);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function connect() {
    const key = apiKey.trim();
    if (!key || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/account/clickup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: key }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        connected?: boolean;
        username?: string;
        error?: string;
      };
      if (!res.ok || !body.connected) {
        toast.error(body.error ?? "Não foi possível conectar");
        return;
      }
      toast.success(
        body.username ? `ClickUp conectado (${body.username})` : "ClickUp conectado",
      );
      setApiKey("");
      setConnected(true);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/account/clickup", { method: "DELETE" });
      if (!res.ok) {
        toast.error("Não foi possível desconectar");
        return;
      }
      setConnected(false);
      setConfirming(false);
      toast.success("ClickUp desconectado");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground">ClickUp (modo Ag�ncia)</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Conecte o SEU ClickUp pra ver e trabalhar os cards dos clientes dentro
        do chat. A chave é pessoal e fica cifrada.
      </p>

      {loading ? (
        <div className="mt-4 flex items-center text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
        </div>
      ) : connected ? (
        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm text-emerald-400">
            <CheckCircle2 className="size-4" />
            ClickUp conectado
          </span>
          {confirming ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                Desconectar? Vai precisar recolar a chave.
              </span>
              <Button variant="outline" size="sm" onClick={disconnect} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                Confirmar
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirming(false)}
                disabled={busy}
              >
                Cancelar
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirming(true)}
              disabled={busy}
            >
              <Unplug className="size-4" />
              Desconectar
            </Button>
          )}
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="cole sua API key do ClickUp"
            onKeyDown={(e) => {
              if (e.key === "Enter") void connect();
            }}
          />
          <p className="text-xs text-muted-foreground">
            ClickUp → Settings → Apps → API Token (pessoal).
          </p>
          <Button onClick={connect} disabled={busy || !apiKey.trim()} className="self-start">
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Conectar
          </Button>
        </div>
      )}
    </div>
  );
}
