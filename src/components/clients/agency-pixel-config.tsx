'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Code2,
  Copy,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface PixelOptions {
  pixel_site_url: string;
  pixel_last_seen_at: string | null;
  pixel_verified_at: string | null;
}

export function AgencyPixelConfig({ accountId }: { accountId: string }) {
  const [options, setOptions] = useState<PixelOptions>({
    pixel_site_url: '',
    pixel_last_seen_at: null,
    pixel_verified_at: null,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [copied, setCopied] = useState(false);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const snippet = `<script src="${origin}/pixel.js" data-client-id="${accountId}" async></script>`;

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/account/client-options', {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const body = (await res.json()) as { options: PixelOptions };
      setOptions(body.options);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveSite() {
    setSaving(true);
    try {
      const res = await fetch('/api/account/client-options', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...options, pixel_enabled: true }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(body.error ?? 'Não foi possível salvar o site');
        return false;
      }
      toast.success('Site salvo');
      return true;
    } finally {
      setSaving(false);
    }
  }

  async function verify() {
    if (!(await saveSite())) return;
    setVerifying(true);
    try {
      const res = await fetch('/api/account/pixel/verify', { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as {
        verified?: boolean;
        error?: string;
      };
      if (body.verified) {
        toast.success('Pixel Global encontrado no site');
        await load();
      } else {
        toast.error(body.error ?? 'Pixel ainda não encontrado');
      }
    } finally {
      setVerifying(false);
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2_000);
  }

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 py-10 text-sm">
        <Loader2 className="size-4 animate-spin" /> Carregando Pixel Global
      </div>
    );
  }

  const verified = Boolean(options.pixel_verified_at);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="text-foreground flex items-center gap-2 font-semibold">
          <Code2 className="text-primary size-5" /> Instalar Pixel Global
        </h3>
        <p className="text-muted-foreground mt-1 text-sm">
          Instale no site do cliente para guardar GCLID, FBCLID e parâmetros UTM
          antes da conversa começar.
        </p>
      </div>

      <Tabs defaultValue="html">
        <TabsList className="w-full">
          <TabsTrigger value="html" className="flex-1">
            HTML direto
          </TabsTrigger>
          <TabsTrigger value="gtm" className="flex-1">
            Google Tag Manager
          </TabsTrigger>
        </TabsList>
        <TabsContent value="html" className="mt-3">
          <Instruction>
            Cole o código abaixo antes do fechamento de `&lt;/head&gt;` e
            publique o site.
          </Instruction>
        </TabsContent>
        <TabsContent value="gtm" className="mt-3">
          <Instruction>
            Crie uma tag HTML personalizada, cole o código e dispare em todas as
            páginas.
          </Instruction>
        </TabsContent>
      </Tabs>

      <div className="border-border bg-card flex items-center gap-3 rounded-xl border p-3">
        <code className="text-foreground min-w-0 flex-1 overflow-x-auto text-xs">
          {snippet}
        </code>
        <Button variant="outline" onClick={copy}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? 'Copiado' : 'Copiar'}
        </Button>
      </div>

      <div>
        <label
          htmlFor="pixel-site-url"
          className="text-foreground text-sm font-medium"
        >
          URL do site do cliente
        </label>
        <div className="mt-2 flex gap-2">
          <Input
            id="pixel-site-url"
            value={options.pixel_site_url}
            onChange={(event) =>
              setOptions((current) => ({
                ...current,
                pixel_site_url: event.target.value,
              }))
            }
            placeholder="https://cliente.com.br"
          />
          <Button variant="outline" onClick={saveSite} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Salvar
          </Button>
        </div>
      </div>

      <div
        className={`flex items-center gap-3 rounded-xl border p-4 ${
          verified
            ? 'border-emerald-500/40 bg-emerald-500/10'
            : 'border-border bg-card'
        }`}
      >
        {verified ? (
          <CheckCircle2 className="size-5 text-emerald-500" />
        ) : (
          <RefreshCw className="text-muted-foreground size-5" />
        )}
        <div className="flex-1">
          <p className="text-foreground text-sm font-medium">
            {verified ? 'Instalação verificada' : 'Verificação pendente'}
          </p>
          <p className="text-muted-foreground text-xs">
            {options.pixel_last_seen_at
              ? `Último sinal recebido em ${new Date(options.pixel_last_seen_at).toLocaleString('pt-BR')}`
              : 'Ainda não recebemos uma visita deste site.'}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={verify}
          disabled={verifying || !options.pixel_site_url.trim()}
        >
          {verifying ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Verificar instalação
        </Button>
      </div>
    </div>
  );
}

function Instruction({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-muted/40 text-muted-foreground rounded-lg p-4 text-sm">
      {children}
    </div>
  );
}
