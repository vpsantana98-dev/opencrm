"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Info, Loader2, Target, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  pixel_id: string;
  test_event_code: string;
  action_source: string;
  lead_enabled: boolean;
  purchase_stage_id: string;
  purchase_currency: string;
  enabled: boolean;
  hasToken: boolean;
}

const EMPTY: ConfigState = {
  pixel_id: "",
  test_event_code: "",
  action_source: "business_messaging",
  lead_enabled: true,
  purchase_stage_id: "",
  purchase_currency: "BRL",
  enabled: true,
  hasToken: false,
};

// Moedas ISO-4217 aceitas (evita texto livre inválido tipo "R$"/"REAL").
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

export function MetaAdsConfig() {
  const [cfg, setCfg] = useState<ConfigState>(EMPTY);
  const [savedCfg, setSavedCfg] = useState<ConfigState>(EMPTY);
  const [token, setToken] = useState(""); // write-only
  const [stages, setStages] = useState<StageOption[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    { ok: boolean; msg: string } | null
  >(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/account/meta-ads", { cache: "no-store" });
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

  // Há edição pendente (config mudou ou um token novo foi digitado)? O
  // teste roda sobre a config SALVA, então testar com pendências engana.
  const isDirty =
    token.trim().length > 0 || JSON.stringify(cfg) !== JSON.stringify(savedCfg);

  useEffect(() => {
    void load();
  }, [load]);

  // Aviso ao fechar/recarregar a aba com edição pendente (não perder o
  // que foi digitado). A troca de aba/cliente dentro do app ainda re-monta
  // o componente; guardar isso é maior e ficou pra outra rodada.
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
      const res = await fetch("/api/account/meta-ads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...cfg, capi_token: token || undefined }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(body.error ?? "Não foi possível salvar");
        return;
      }
      toast.success("Configuração salva");
      setToken("");
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/account/meta-ads/test", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (body.ok) {
        setTestResult({
          ok: true,
          msg: "A Meta aceitou o evento de teste. Confira em Test Events no Gerenciador de Eventos.",
        });
      } else {
        setTestResult({
          ok: false,
          msg: body.error ?? "A Meta recusou o evento.",
        });
      }
      await load();
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="h-5 w-52 animate-pulse rounded bg-muted" />
        <div className="h-3 w-full max-w-md animate-pulse rounded bg-muted/60" />
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
        <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Target className="size-5 text-primary" />
          Rastreamento Meta Ads
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Envia eventos de conversão para a Meta quando um lead novo escreve e
          quando um negócio é ganho, para os anúncios otimizarem com venda de
          verdade — não só com clique. A atribuição forte, ligada ao clique no
          anúncio, só vem pelo número oficial da Meta; pela Evolution o evento
          conta, mas a atribuição é mais fraca.
        </p>
      </div>

      {/* Chave-mestra em destaque, no TOPO. Antes era o ÚLTIMO item da
          segunda caixa cinza — quem desligasse sem querer não achava
          mais, e quem preenchesse tudo certo não entendia por que nada
          saía. Ela governa os demais campos, então vem antes deles. */}
      <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            Rastreamento ativo
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {cfg.enabled
              ? "Eventos deste cliente estão sendo enviados para a Meta."
              : "Pausado. Nenhum evento sai, mesmo com tudo preenchido."}
          </p>
        </div>
        <Toggle
          label="Rastreamento ativo"
          checked={cfg.enabled}
          onChange={(v) => setCfg({ ...cfg, enabled: v })}
        />
      </div>

      {/* 1 — CONEXÃO: o que faz a integração existir. */}
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
        <div className="border-b border-border pb-3">
          <p className="text-sm font-semibold text-foreground">
            1. Conexão com a Meta
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Os dois campos abaixo são obrigatórios. Sem eles, nenhum evento sai.
          </p>
        </div>
        <Field
          label="Pixel do Meta Ads (Dataset ID)"
          hint="Gerenciador de Eventos → sua fonte de dados → ID."
        >
          <Input
            value={cfg.pixel_id}
            onChange={(e) => setCfg({ ...cfg, pixel_id: e.target.value })}
            placeholder="ex.: 508702072176852"
            inputMode="numeric"
          />
        </Field>

        <Field
          label="Token da API de Conversão"
          hint={
            cfg.hasToken
              ? "Já configurado. Deixe em branco para manter; digite um novo para trocar."
              : "Gerenciador de Eventos → Configurações → API de Conversão → gerar token."
          }
        >
          <Input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={cfg.hasToken ? "•••••••• (mantém o atual)" : "cole o token"}
          />
        </Field>

      </div>

      {/* 2 — O QUE DISPARAR: regra de negócio, separada da credencial. */}
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
        <div className="border-b border-border pb-3">
          <p className="text-sm font-semibold text-foreground">
            2. Quais eventos disparar
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Quando o CRM avisa a Meta que algo aconteceu.
          </p>
        </div>

        <Toggle
          label="Lead — quando um contato novo escreve"
          desc="Dispara na primeira mensagem de quem ainda não estava no CRM."
          checked={cfg.lead_enabled}
          onChange={(v) => setCfg({ ...cfg, lead_enabled: v })}
        />

        <Field
          label="Purchase — quando um negócio chega nesta etapa"
          hint="Ao arrastar um negócio para a etapa escolhida, o evento sai com o valor do negócio."
        >
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

        {/* A moeda só importa se houver etapa de compra escolhida. Sem
            ela o campo era uma pergunta sem consequência. */}
        {cfg.purchase_stage_id ? (
          <Field label="Moeda do valor enviado">
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
        ) : null}
      </div>

      {/* 3 — AVANÇADO: tem padrão certo, e quem não sabe não deve mexer. */}
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
        <div className="border-b border-border pb-3">
          <p className="text-sm font-semibold text-foreground">3. Avançado</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Já vem no padrão recomendado. Só mexa se souber o motivo.
          </p>
        </div>

        {/* Isto era uma linha de dica embaixo do campo. Virou aviso:
            escolher "Pixel Web" aqui é o erro que faz a Meta receber os
            eventos e não ligá-los ao anúncio que trouxe a pessoa. */}
        <Alert>
          <Info />
          <AlertTitle>Use o Pixel de Mensagens</AlertTitle>
          <AlertDescription>
            É o otimizado para leads vindos do Click-to-WhatsApp. O Pixel Web
            existe para site — escolhê-lo aqui faz a Meta receber os eventos sem
            ligá-los ao anúncio de origem.
          </AlertDescription>
        </Alert>

        <Field label="Tipo de evento (action_source)">
          <select
            value={cfg.action_source}
            onChange={(e) => setCfg({ ...cfg, action_source: e.target.value })}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground"
          >
            <option value="business_messaging">Pixel de Mensagens (CTWA)</option>
            <option value="website">Pixel Web</option>
          </select>
        </Field>

        <Field
          label="Código de Teste (Test Events)"
          hint="Opcional. Gerenciador de Eventos → Testar Eventos. Necessário para o botão “Testar integração”."
        >
          <Input
            value={cfg.test_event_code}
            onChange={(e) => setCfg({ ...cfg, test_event_code: e.target.value })}
            placeholder="ex.: TEST12345"
          />
        </Field>
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
          Testar integração
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

      {/* Últimos eventos */}
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-sm font-medium text-foreground">
          Últimos eventos enviados
        </p>
        {events.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Nenhum evento ainda. Eles aparecem aqui quando um lead escrever ou um
            negócio for ganho.
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
        <span className="block text-sm font-medium text-foreground">
          {label}
        </span>
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
