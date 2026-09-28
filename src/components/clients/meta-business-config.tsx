'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Megaphone,
  Loader2,
  RefreshCw,
  Search,
  Unplug,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface AdAccount {
  id: string;
  account_id: string;
  name: string;
  business?: { id: string; name: string };
}
interface PageAsset {
  id: string;
  name: string;
}
interface PixelAsset {
  id: string;
  name: string;
}
interface MetaState {
  configured: boolean;
  connected: boolean;
  user?: { name?: string | null };
  adAccounts?: AdAccount[];
  pages?: PageAsset[];
  pixels?: PixelAsset[];
  config?: {
    ad_account_id?: string | null;
    page_ids?: string[] | null;
    pixel_id?: string | null;
  } | null;
  error?: string;
}

export function MetaBusinessConfig() {
  const loadRequestRef = useRef(0);
  const [state, setState] = useState<MetaState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [pageSearch, setPageSearch] = useState('');
  const [adAccountId, setAdAccountId] = useState('');
  const [pageIds, setPageIds] = useState<string[]>([]);
  const [pixelId, setPixelId] = useState('');

  const load = useCallback(async (nextAdAccountId?: string) => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    try {
      const query = nextAdAccountId
        ? `?adAccountId=${encodeURIComponent(nextAdAccountId)}`
        : '';
      const res = await fetch(`/api/account/meta-business${query}`, {
        cache: 'no-store',
      });
      const body = (await res.json().catch(() => ({}))) as MetaState;
      if (!res.ok) {
        toast.error(body.error ?? 'Não foi possível carregar os ativos Meta');
        return;
      }
      if (requestId !== loadRequestRef.current) return;
      setState(body);
      setAdAccountId(nextAdAccountId ?? body.config?.ad_account_id ?? '');
      setPageIds(body.config?.page_ids ?? []);
      setPixelId(body.config?.pixel_id ?? '');
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as {
        type?: string;
        ok?: boolean;
        message?: string;
      };
      if (data.type !== 'fz-meta-oauth') return;
      if (data.ok) {
        toast.success('Conta Meta conectada');
        void load();
      } else {
        toast.error(data.message ?? 'Não foi possível conectar a Meta');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [load]);

  const selectedAccount = state?.adAccounts?.find(
    (item) => item.account_id === adAccountId || item.id === adAccountId
  );
  const filteredAccounts = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    return (state?.adAccounts ?? []).filter((item) =>
      `${item.name} ${item.account_id} ${item.business?.name ?? ''}`
        .toLocaleLowerCase('pt-BR')
        .includes(term)
    );
  }, [search, state?.adAccounts]);
  const filteredPages = useMemo(() => {
    const term = pageSearch.trim().toLocaleLowerCase('pt-BR');
    return (state?.pages ?? []).filter((page) =>
      `${page.name} ${page.id}`.toLocaleLowerCase('pt-BR').includes(term)
    );
  }, [pageSearch, state?.pages]);

  function connect() {
    window.open(
      '/api/account/meta-business/oauth/start',
      'opencrm-meta-oauth',
      'width=620,height=760,noopener=no'
    );
  }

  async function selectAccount(id: string) {
    setAdAccountId(id);
    setPixelId('');
    await load(id);
  }

  async function save() {
    if (!selectedAccount || !pixelId) {
      toast.error('Selecione uma conta de anúncio e um pixel');
      return;
    }
    setBusy(true);
    try {
      const pixel = state?.pixels?.find((item) => item.id === pixelId);
      const res = await fetch('/api/account/meta-business', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          adAccountId: selectedAccount.account_id,
          adAccountName: selectedAccount.name,
          pageIds,
          pixelId,
          pixelName: pixel?.name,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(body.error ?? 'Não foi possível salvar os ativos');
        return;
      }
      toast.success('Ativos da Meta salvos');
      await load(selectedAccount.account_id);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      const res = await fetch('/api/account/meta-business', {
        method: 'DELETE',
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(body.error ?? 'Não foi possível desconectar');
        return;
      }
      toast.success('Conta Meta desconectada da agência');
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (loading && !state) {
    return <LoadingCard label="Carregando integração Meta" />;
  }
  if (!state?.configured) {
    return (
      <Notice>
        Configure `META_APP_ID`, `META_APP_SECRET` e `NEXT_PUBLIC_SITE_URL` no
        EasyPanel para habilitar o login da Meta.
      </Notice>
    );
  }
  if (!state.connected) {
    return (
      <div className="border-border bg-card rounded-xl border p-5">
        <div className="flex items-start gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-blue-500/15 text-blue-400">
            <Megaphone className="size-5" />
          </div>
          <div className="flex-1">
            <p className="text-foreground font-semibold">Conectar Meta Ads</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Entre com o operador principal da agência. A conexão será usada
              para listar as contas, páginas e pixels que ele administra.
            </p>
            <Button className="mt-4" onClick={connect}>
              <Megaphone className="size-4" />
              Conectar conta Meta
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4">
        <CheckCircle2 className="size-5 text-emerald-500" />
        <div className="flex-1">
          <p className="text-foreground text-sm font-semibold">
            Meta conectada
          </p>
          <p className="text-muted-foreground text-xs">
            {state.user?.name || 'Operador principal'}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={disconnect} disabled={busy}>
          <Unplug className="size-4" />
          Desconectar
        </Button>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-foreground text-sm font-semibold">
            Conta de anúncio
          </p>
          <Button variant="outline" size="sm" onClick={() => load(adAccountId)}>
            <RefreshCw className="size-3.5" />
            Sincronizar ativos
          </Button>
        </div>
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar conta"
            className="pl-9"
          />
        </div>
        <div className="mt-2 max-h-52 space-y-2 overflow-y-auto pr-1">
          {filteredAccounts.map((account) => (
            <Choice
              key={account.id}
              selected={
                adAccountId === account.account_id || adAccountId === account.id
              }
              title={account.name}
              detail={`${account.business?.name ?? 'Meta Ads'} • ${account.account_id}`}
              onClick={() => void selectAccount(account.account_id)}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-foreground text-sm font-semibold">
            Páginas do Facebook
          </p>
          <span className="text-muted-foreground text-xs tabular-nums">
            {pageIds.length} selecionada{pageIds.length === 1 ? '' : 's'} de{' '}
            {(state.pages ?? []).length}
          </span>
        </div>
        {(state.pages ?? []).length > 6 ? (
          <div className="relative mb-2">
            <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              value={pageSearch}
              onChange={(event) => setPageSearch(event.target.value)}
              placeholder="Buscar página"
              className="pl-9"
            />
          </div>
        ) : null}
        <div className="grid max-h-56 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {filteredPages.map((page) => (
            <Choice
              key={page.id}
              selected={pageIds.includes(page.id)}
              title={page.name}
              detail={page.id}
              onClick={() =>
                setPageIds((current) =>
                  current.includes(page.id)
                    ? current.filter((id) => id !== page.id)
                    : [...current, page.id]
                )
              }
            />
          ))}
        </div>
        {filteredPages.length === 0 ? (
          <p className="text-muted-foreground py-4 text-center text-sm">
            Nenhuma página encontrada.
          </p>
        ) : null}
      </div>

      <div>
        <p className="text-foreground mb-2 text-sm font-semibold">
          Pixel e API de Conversão
        </p>
        {!adAccountId ? (
          <Notice>Selecione uma conta de anúncio para listar os pixels.</Notice>
        ) : (state.pixels ?? []).length === 0 ? (
          <Notice>Nenhum pixel acessível foi encontrado nessa conta.</Notice>
        ) : (
          <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
            {(state.pixels ?? []).map((pixel) => (
              <Choice
                key={pixel.id}
                selected={pixelId === pixel.id}
                title={pixel.name}
                detail={pixel.id}
                onClick={() => setPixelId(pixel.id)}
              />
            ))}
          </div>
        )}
      </div>

      <Button onClick={save} disabled={busy || !adAccountId || !pixelId}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : null}
        Salvar ativos selecionados
      </Button>
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
      className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
        selected
          ? 'border-primary bg-primary/5'
          : 'border-border bg-card hover:border-primary/40'
      }`}
    >
      <span
        className={`size-4 shrink-0 rounded-full border ${
          selected ? 'border-primary border-4' : 'border-muted-foreground'
        }`}
      />
      <span className="min-w-0">
        <span className="text-foreground block truncate text-sm font-medium">
          {title}
        </span>
        <span className="text-muted-foreground block truncate text-xs">
          {detail}
        </span>
      </span>
    </button>
  );
}

function LoadingCard({ label }: { label: string }) {
  return (
    <div className="border-border text-muted-foreground flex items-center gap-2 rounded-xl border p-6 text-sm">
      <Loader2 className="size-4 animate-spin" /> {label}
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-border bg-muted/30 text-muted-foreground rounded-lg border p-3 text-sm">
      {children}
    </div>
  );
}
