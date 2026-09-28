"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface StageOption {
  id: string;
  label: string;
}
interface EventRow {
  id: string;
  event_name: string;
  status: string;
  error: string | null;
  created_at: string;
}
interface ConfigState {
  customer_id: string;
  login_customer_id: string;
  conversion_action_lead: string;
  conversion_action_purchase: string;
  purchase_currency: string;
  lead_enabled: boolean;
  purchase_stage_id: string;
  enabled: boolean;
  hasDeveloperToken: boolean;
  hasOAuth: boolean;
}

const EMPTY: ConfigState = {
  customer_id: "",
  login_customer_id: "",
  conversion_action_lead: "",
  conversion_action_purchase: "",
  purchase_currency: "BRL",
  lead_enabled: true,
  purchase_stage_id: "",
  enabled: true,
  hasDeveloperToken: false,
  hasOAuth: false,
};

// Moedas ISO-4217 aceitas (evita texto livre inválido).
const CURRENCIES = [
  "BRL",
  "USD",
  "EUR",
  "GBP",
  "ARS",
  "CLP",
  "COP",
  "MXN",
  "PYG",
  "UYU",
];

export function GoogleAdsConfig() {
  const [cfg, setCfg] = useState<ConfigState>(EMPTY);
  const [savedCfg, setSavedCfg] = useState<ConfigState>(EMPTY);
  // Segredos write-only (só enviados quando digitados).
  const [devToken, setDevToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [stages, setStages] = useState<StageOption[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/account/google-ads", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as {
        config: ConfigState;
        stages: StageOption[];
        events: EventRow[];
      };
      setCfg(body.config);
      setSavedCfg(body.config);
      setStages(body.stages ?? []);
      setEvents(body.events ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Edição pendente? O teste roda sobre a config SALVA, então testar com
  // segredos/campos não salvos engana.
  const isDirty =
    devToken.trim().length > 0 ||
    clientId.trim().length > 0 ||
    clientSecret.trim().length > 0 ||
    refreshToken.trim().length > 0 ||
    JSON.stringify(cfg) !== JSON.stringify(savedCfg);

  // Aviso ao fechar/recarregar a aba com edição pendente.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/account/google-ads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...cfg,
          developer_token: devToken || undefined,
          oauth_client_id: clientId || undefined,
          oauth_client_secret: clientSecret || undefined,
          oauth_refresh_token: refreshToken || undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(body.error ?? "Não foi possível salvar");
        return;
      }
      toast.success("Configuração salva");
      setDevToken("");
      setClientId("");
      setClientSecret("");
      setRefreshToken("");
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/account/google-ads/test", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      setTestResult(
        body.ok
          ? { ok: true, msg: "Credenciais válidas: o Google respondeu com as contas acessíveis." }
          : { ok: false, msg: body.error ?? "Falha ao validar credenciais." },
      );
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="h-5 w-52 animate-pulse rounded bg-muted" />
        <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <div className="h-3 w-40 animate-pulse rounded bg-muted/60" />
              <div className="h-9 w-full animate-pulse rounded-lg bg-muted/60" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          Rastreamento Google Ads
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Envia conversões (Lead / Purchase) pra Google Ads via API, casando o
          lead pelo telefone (Enhanced Conversions). Precisa de acesso à API do
          Google Ads (developer token + OAuth).
        </p>
      </div>

      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
        <Field label="ID da conta (Customer ID)" hint="Só dígitos, sem traços.">
          <Input
            value={cfg.customer_id}
            onChange={(e) => setCfg({ ...cfg, customer_id: e.target.value })}
            placeholder="1234567890"
          />
        </Field>
        <Field
          label="Login Customer ID (MCC)"
          hint="Opcional. Só se a conta fica sob uma conta gerente."
        >
          <Input
            value={cfg.login_customer_id}
            onChange={(e) =>
              setCfg({ ...cfg, login_customer_id: e.target.value })
            }
            placeholder="opcional"
          />
        </Field>
        <Field
          label="Developer Token"
          hint={cfg.hasDeveloperToken ? "Já configurado. Deixe em branco para manter." : "Do Google Ads API Center."}
        >
          <Input
            type="password"
            value={devToken}
            onChange={(e) => setDevToken(e.target.value)}
            placeholder={cfg.hasDeveloperToken ? "•••••••• (mantém)" : "cole o token"}
          />
        </Field>
      </div>

      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
        <p className="text-sm font-medium text-foreground">OAuth (Google Cloud)</p>
        <Field label="Client ID" hint={cfg.hasOAuth ? "Já configurado." : undefined}>
          <Input
            type="password"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder={cfg.hasOAuth ? "•••••••• (mantém)" : "OAuth client id"}
          />
        </Field>
        <Field label="Client Secret">
          <Input
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder={cfg.hasOAuth ? "•••••••• (mantém)" : "OAuth client secret"}
          />
        </Field>
        <Field label="Refresh Token">
          <Input
            type="password"
            value={refreshToken}
            onChange={(e) => setRefreshToken(e.target.value)}
            placeholder={cfg.hasOAuth ? "•••••••• (mantém)" : "OAuth refresh token"}
          />
        </Field>
      </div>

      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
        <Field
          label="Ação de conversão — Lead"
          hint="Resource name, ex.: customers/123/conversionActions/456"
        >
          <Input
            value={cfg.conversion_action_lead}
            onChange={(e) =>
              setCfg({ ...cfg, conversion_action_lead: e.target.value })
            }
            placeholder="customers/.../conversionActions/..."
          />
        </Field>
        <Toggle
          label="Disparar evento de Lead"
          desc="Quando um lead novo escreve pela primeira vez."
          checked={cfg.lead_enabled}
          onChange={(v) => setCfg({ ...cfg, lead_enabled: v })}
        />
        <Field label="Ação de conversão — Purchase">
          <Input
            value={cfg.conversion_action_purchase}
            onChange={(e) =>
              setCfg({ ...cfg, conversion_action_purchase: e.target.value })
            }
            placeholder="customers/.../conversionActions/..."
          />
        </Field>
        <Field label="Estágio que conta como compra">
          <select
            value={cfg.purchase_stage_id}
            onChange={(e) =>
              setCfg({ ...cfg, purchase_stage_id: e.target.value })
            }
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground"
          >
            <option value="">Nenhum (não dispara Purchase)</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Moeda (Purchase)">
          <select
            value={cfg.purchase_currency || "BRL"}
            onChange={(e) =>
              setCfg({ ...cfg, purchase_currency: e.target.value })
            }
            className="max-w-40 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground"
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Toggle
          label="Rastreamento ativo"
          desc="Desligue para pausar os eventos Google deste cliente."
          checked={cfg.enabled}
          onChange={(v) => setCfg({ ...cfg, enabled: v })}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={saving || !isDirty}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          Salvar
        </Button>
        <Button
          variant="outline"
          onClick={test}
          disabled={testing || saving || isDirty}
          title={isDirty ? "Salve as alterações antes de testar" : undefined}
        >
          {testing ? <Loader2 className="size-4 animate-spin" /> : null}
          Testar conexão
        </Button>
        {isDirty ? (
          <span className="text-xs text-amber-400">
            Alterações não salvas — salve antes de testar.
          </span>
        ) : null}
      </div>

      {testResult ? (
        <div
          className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
            testResult.ok
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              : "border-amber-500/40 bg-amber-500/10 text-amber-300"
          }`}
        >
          {testResult.ok ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          ) : (
            <XCircle className="mt-0.5 size-4 shrink-0" />
          )}
          <span>{testResult.msg}</span>
        </div>
      ) : null}

      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-sm font-medium text-foreground">
          Últimos eventos (Google)
        </p>
        {events.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Nenhum evento ainda.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {events.map((ev) => (
              <li
                key={ev.id}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span className="flex items-center gap-2">
                  {ev.status === "sent" ? (
                    <CheckCircle2 className="size-4 text-emerald-500" />
                  ) : (
                    <XCircle className="size-4 text-red-500" />
                  )}
                  <span className="text-foreground">{ev.event_name}</span>
                  {ev.error ? (
                    <span className="text-xs text-muted-foreground">
                      · {ev.error}
                    </span>
                  ) : null}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(ev.created_at).toLocaleString("pt-BR")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-foreground">{label}</label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Toggle({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between gap-3 text-left"
    >
      <span>
        <span className="block text-sm font-medium text-foreground">{label}</span>
        {desc ? (
          <span className="block text-xs text-muted-foreground">{desc}</span>
        ) : null}
      </span>
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? "bg-primary" : "bg-muted"
        }`}
      >
        <span
          className={`absolute top-0.5 size-5 rounded-full bg-white transition-transform ${
            checked ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </span>
    </button>
  );
}
