'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2,
  MessageSquareText,
  Radio,
  Save,
  Share2,
  Users,
  Webhook,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

interface OptionsState {
  default_message: string;
  lead_created_webhook_url: string;
  lead_updated_webhook_url: string;
  webhook_stage_changes_only: boolean;
  portal_enabled: boolean;
  pixel_enabled: boolean;
  pixel_site_url: string;
  action_source: 'business_messaging' | 'website';
}

export function ClientOptionsConfig() {
  const [options, setOptions] = useState<OptionsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/account/client-options', {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const body = (await res.json()) as { options: OptionsState };
      setOptions(body.options);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!options) return;
    setSaving(true);
    try {
      const res = await fetch('/api/account/client-options', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(options),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(body.error ?? 'Não foi possível salvar os opcionais');
        return;
      }
      toast.success('Configurações opcionais salvas');
    } finally {
      setSaving(false);
    }
  }

  if (loading || !options) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 py-10 text-sm">
        <Loader2 className="size-4 animate-spin" /> Carregando opcionais
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-7">
      <Section icon={MessageSquareText} title="Mensagem padrão">
        <Textarea
          value={options.default_message}
          onChange={(event) =>
            setOptions({ ...options, default_message: event.target.value })
          }
          rows={3}
        />
        <p className="text-muted-foreground text-xs">
          Texto inicial usado nos links rastreáveis e nas novas conversas.
        </p>
      </Section>

      <Section icon={Webhook} title="Webhooks de lead">
        <Field label="URL de criação de lead">
          <Input
            value={options.lead_created_webhook_url}
            onChange={(event) =>
              setOptions({
                ...options,
                lead_created_webhook_url: event.target.value,
              })
            }
            placeholder="https://seu-servidor.com/webhook/lead-criado"
          />
        </Field>
        <Field label="URL de atualização de lead">
          <Input
            value={options.lead_updated_webhook_url}
            onChange={(event) =>
              setOptions({
                ...options,
                lead_updated_webhook_url: event.target.value,
              })
            }
            placeholder="https://seu-servidor.com/webhook/lead-atualizado"
          />
        </Field>
        <ToggleRow
          label="Disparar atualizações apenas em mudança de etapa"
          checked={options.webhook_stage_changes_only}
          onCheckedChange={(checked) =>
            setOptions({ ...options, webhook_stage_changes_only: checked })
          }
        />
      </Section>

      <Section icon={Radio} title="Tipo de Pixel Meta">
        <Choice
          selected={options.action_source === 'business_messaging'}
          title="Pixel de Mensagens"
          detail="Usa business_messaging para leads CTWA e website nos demais eventos."
          onClick={() =>
            setOptions({ ...options, action_source: 'business_messaging' })
          }
        />
        <Choice
          selected={options.action_source === 'website'}
          title="Pixel Web"
          detail="Todos os eventos da API de Conversões usam website."
          onClick={() => setOptions({ ...options, action_source: 'website' })}
        />
      </Section>

      <Section icon={Users} title="Portal do Cliente">
        <ToggleRow
          label="Habilitar acesso ao portal"
          description="Autoriza a criação e o uso de logins de cliente para esta conta."
          checked={options.portal_enabled}
          onCheckedChange={(checked) =>
            setOptions({ ...options, portal_enabled: checked })
          }
        />
      </Section>

      <Section icon={Share2} title="Compartilhar WhatsApp entre contas">
        <div className="border-border bg-muted/30 text-muted-foreground rounded-xl border p-3 text-sm">
          Indisponível para conexões Evolution. Este recurso exige um provedor
          que replique a mesma instância com isolamento entre funis.
        </div>
      </Section>

      <div className="border-border border-t pt-4">
        <Button onClick={save} disabled={saving}>
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          Salvar opcionais
        </Button>
      </div>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof MessageSquareText;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-foreground flex items-center gap-2 text-sm font-semibold">
        <Icon className="text-primary size-4" /> {title}
        <span className="rounded-full bg-violet-500 px-2 py-0.5 text-[10px] font-semibold text-white">
          Opcional
        </span>
      </h3>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="text-foreground flex flex-col gap-1.5 text-xs font-medium">
      {label}
      {children}
    </label>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="border-border bg-card flex items-center gap-3 rounded-xl border p-3">
      <div className="flex-1">
        <p className="text-foreground text-sm font-medium">{label}</p>
        {description ? (
          <p className="text-muted-foreground text-xs">{description}</p>
        ) : null}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function Choice({
  selected,
  title,
  detail,
  onClick,
}: {
  selected: boolean;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-start gap-3 rounded-xl border p-3 text-left ${selected ? 'border-primary bg-primary/5' : 'border-border bg-card'}`}
    >
      <span
        className={`mt-0.5 size-4 rounded-full border ${selected ? 'border-primary border-4' : 'border-muted-foreground'}`}
      />
      <span>
        <span className="text-foreground block text-sm font-medium">
          {title}
        </span>
        <span className="text-muted-foreground block text-xs">{detail}</span>
      </span>
    </button>
  );
}
