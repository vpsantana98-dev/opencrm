'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Copy, Link2, Loader2, Plus, QrCode, RefreshCw } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  EvolutionNumbers,
  type NumeroWhatsapp,
} from '@/components/settings/evolution-numbers';

/**
 * Os números de WhatsApp do cliente ativo, via Evolution.
 *
 * Deixou de ser "o número do cliente" para ser uma LISTA: uma agência
 * atende o mesmo cliente por Vendas e Suporte, e antes o segundo número
 * simplesmente sobrescrevia o primeiro.
 *
 * A tela tem dois estados bem diferentes de propósito:
 *
 *  - nenhum número ainda → o fluxo de primeira conexão (mandar o link
 *    para o responsável, ou ver o QR aqui). É o que o assistente de
 *    novo cliente usa, e continua idêntico ao que era;
 *  - já tem número → a lista, com o padrão marcado, e um botão para
 *    adicionar outro.
 */
export function EvolutionConnect({
  onConnected,
  preferir = 'link',
}: {
  /** Dispara UMA vez quando a conexão é detectada (borda de subida).
   *  Usado pelo wizard de novo cliente pra avançar automaticamente. */
  onConnected?: (phone: string | null) => void;
  /**
   * Qual caminho vem primeiro na primeira conexão.
   *
   * O assistente pergunta quem tem o celular. Com o aparelho na mão, o
   * QR é o caminho curto e o link é desvio; sem ele, o contrário. Os
   * dois continuam disponíveis — o que muda é qual aparece primeiro,
   * porque oferecer os dois com o mesmo peso faz a pessoa errar.
   */
  preferir?: 'link' | 'qr';
} = {}) {
  const [numeros, setNumeros] = useState<NumeroWhatsapp[]>([]);
  const [qr, setQr] = useState<string | null>(null);
  /** De qual número é o QR aberto. */
  const [qrPara, setQrPara] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncingWebhook, setSyncingWebhook] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const [checked, setChecked] = useState(false);
  // Erro persistente do último clique em conectar (ex.: pool de proxies
  // vazio). Fica inline no card, com o botão disponível para tentar de
  // novo — um toast some rápido demais para um erro que pede ação.
  const [connectError, setConnectError] = useState<string | null>(null);

  // Link público de conexão. Na maior parte dos casos quem escaneia é o
  // responsável do cliente, não quem está olhando este painel, então o
  // caminho normal é copiar o link e mandar para ele. Ver o QR aqui
  // continua existindo para quando as duas pontas estão na mesma sala.
  const { accountId } = useAuth();
  const [connectLink, setConnectLink] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);

  const notifiedRef = useRef(false);
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;
  const qrTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const webhookSyncedRef = useRef(false);
  // Lido dentro do timer de renovação do QR, que não deve rodar depois
  // que o número pareou. Ref porque o timer é criado uma vez e não
  // enxergaria o estado novo.
  const qrParaRef = useRef<string | null>(null);
  qrParaRef.current = qrPara;
  const conectadosRef = useRef<Set<string>>(new Set());

  const algumConectado = numeros.some((n) => n.connected);

  const repairWebhook = useCallback(async (showSuccess = true) => {
    if (webhookSyncedRef.current) return;
    webhookSyncedRef.current = true;
    setSyncingWebhook(true);
    setSyncError(null);
    try {
      const res = await fetch('/api/whatsapp/evolution/repair', {
        method: 'POST',
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        webhookSyncedRef.current = false;
        setSyncError(body.error ?? 'Não foi possível ativar a sincronização');
        return;
      }
      if (showSuccess) toast.success('Sincronização de mensagens ativada');
    } catch {
      webhookSyncedRef.current = false;
      setSyncError('Não foi possível ativar a sincronização');
    } finally {
      setSyncingWebhook(false);
    }
  }, []);

  /**
   * Pede um QR.
   *
   * `alvo` diz de QUAL número: um id reconecta aquele, `"novo"` cria
   * outro, e `null` é o primeiro do cliente. Sem isso o servidor teria
   * que adivinhar — e adivinhar errado derruba a sessão de um número
   * que ninguém pediu para mexer.
   */
  const fetchQr = useCallback(async (alvo: string | 'novo' | null) => {
    setBusy(true);
    setConnectError(null);
    try {
      const res = await fetch('/api/whatsapp/evolution/connect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          alvo === 'novo'
            ? { novo: true }
            : alvo
              ? { instanceId: alvo }
              : {}
        ),
      });
      const body = (await res.json().catch(() => ({}))) as {
        qr?: string;
        instanceId?: string;
        error?: string;
      };
      // Qualquer falha mostra a mensagem REAL do servidor (ex.:
      // "Nenhum proxy ativo cadastrado..."). Antes, todo 503 virava o
      // banner de "Evolution não configurada" e escondia a causa — o
      // caso de env ausente já é coberto pelo polling de /status, que
      // seta `configured` de forma autoritativa.
      if (!res.ok || !body.qr) {
        setConnectError(body.error ?? 'Não foi possível gerar o QR');
        return;
      }
      setQr(body.qr);
      setQrPara(body.instanceId ?? null);
      // Atualiza o QR sozinho enquanto não parear (o QR expira ~40s).
      if (qrTimer.current) clearTimeout(qrTimer.current);
      qrTimer.current = setTimeout(() => {
        const aindaEsperando = qrParaRef.current;
        if (aindaEsperando && !conectadosRef.current.has(aindaEsperando)) {
          void fetchQr(aindaEsperando);
        }
      }, 30_000);
    } finally {
      setBusy(false);
    }
  }, []);

  const buscarStatus = useCallback(async () => {
    const res = await fetch('/api/whatsapp/evolution/status', {
      cache: 'no-store',
    });
    const body = (await res.json().catch(() => ({}))) as {
      configured?: boolean;
      connected?: boolean;
      phone?: string | null;
      instances?: NumeroWhatsapp[];
    };
    return body;
  }, []);

  // Polling de status. Também roda antes de qualquer clique, para já
  // mostrar os números que existem quando a tela abre.
  useEffect(() => {
    let stop = false;
    const check = async () => {
      try {
        const body = await buscarStatus();
        if (stop) return;
        if (body.configured === false) setConfigured(false);

        const lista = body.instances ?? [];
        // Reflete a conta ATIVA nos dois sentidos — não pode ser
        // "grudento": ao trocar de cliente, um que não conectou tem que
        // voltar a mostrar o fluxo de primeira conexão.
        setNumeros(lista);
        conectadosRef.current = new Set(
          lista.filter((n) => n.connected).map((n) => n.id)
        );

        // Fecha o QR quando o número DELE parear. Comparar por id
        // importa: com vários números, "algum conectado" ficaria
        // verdadeiro por causa de outro número e o QR sumiria sem
        // ninguém ter escaneado nada.
        if (qrParaRef.current && conectadosRef.current.has(qrParaRef.current)) {
          setQr(null);
          setQrPara(null);
        }

        if (lista.some((n) => n.connected)) {
          void repairWebhook(false);
          // Borda de subida: avisa o pai uma única vez.
          if (!notifiedRef.current) {
            notifiedRef.current = true;
            onConnectedRef.current?.(body.phone ?? null);
          }
        } else {
          webhookSyncedRef.current = false;
          notifiedRef.current = false;
        }
      } finally {
        if (!stop) setChecked(true);
      }
    };
    void check();
    const id = setInterval(() => {
      if (!stop) void check();
    }, 3_000);
    return () => {
      stop = true;
      clearInterval(id);
      if (qrTimer.current) clearTimeout(qrTimer.current);
    };
  }, [buscarStatus, repairWebhook]);

  /** Depois de mexer num número, não espera o próximo tick de 3s. */
  const recarregar = useCallback(async () => {
    const body = await buscarStatus();
    setNumeros(body.instances ?? []);
  }, [buscarStatus]);

  // Gera (ou regenera) o link público e já copia. Regenerar invalida o
  // anterior, que é o comportamento desejado: link antigo circulando por
  // WhatsApp não deve continuar valendo depois que a agência emite outro.
  async function gerarLink(paraNovo: boolean) {
    if (!accountId || linkBusy) return;
    setLinkBusy(true);
    try {
      const res = await fetch(
        `/api/account/workspaces/${accountId}/connect-link`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // Com vários números o servidor RECUSA gerar sem alvo, para
          // não entregar um QR que derrubaria a sessão errada. Daqui o
          // link sempre é para um número novo.
          body: JSON.stringify(paraNovo ? { novo: true } : {}),
        }
      );
      const body = (await res.json().catch(() => ({}))) as {
        link?: string;
        error?: string;
      };
      if (!res.ok || !body.link) {
        toast.error(body.error ?? 'Não foi possível gerar o link');
        return;
      }
      setConnectLink(body.link);
      await navigator.clipboard.writeText(body.link).catch(() => {});
      toast.success('Link copiado. Envie para o responsável pelo número.');
      void recarregar();
    } catch {
      toast.error('Não foi possível gerar o link');
    } finally {
      setLinkBusy(false);
    }
  }

  if (!configured) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-300">
        A Evolution ainda não está configurada no servidor. Defina{' '}
        <code>EVOLUTION_API_URL</code> e <code>EVOLUTION_API_KEY</code> nas
        variáveis do app e faça o deploy.
      </div>
    );
  }

  const painelQr = qr ? (
    <div className="flex flex-col items-center gap-3">
      <div className="rounded-xl bg-white p-3">
        {/* QR vem como data:image/png;base64 do servidor */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={qr}
          alt="QR Code para conectar o WhatsApp"
          className="size-56"
          style={{ imageRendering: 'pixelated' }}
        />
      </div>
      <ol className="text-muted-foreground w-full max-w-sm list-decimal pl-5 text-xs">
        <li>Abra o WhatsApp no celular do responsável.</li>
        <li>Toque em Aparelhos conectados, depois Conectar aparelho.</li>
        <li>Escaneie este código. A tela avisa quando conectar.</li>
      </ol>
      <p className="text-muted-foreground flex items-center gap-2 text-xs">
        <Loader2 className="size-3.5 animate-spin" />
        Aguardando a conexão automaticamente
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void fetchQr(qrPara ?? null)}
          disabled={busy}
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Atualizar QR Code
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setQr(null);
            setQrPara(null);
          }}
        >
          Fechar
        </Button>
      </div>
    </div>
  ) : null;

  // ---- já tem número: a lista manda ----------------------------
  if (numeros.length > 0) {
    return (
      <div className="space-y-4">
        <div>
          <p className="text-foreground text-sm font-medium">
            Números de WhatsApp
          </p>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {numeros.length === 1
              ? 'Um número conectado a este cliente.'
              : `${numeros.length} números. As respostas saem pelo mesmo número em que a conversa entrou.`}
          </p>
        </div>

        <div className="border-border rounded-lg border p-3">
          <EvolutionNumbers
            numeros={numeros}
            conectandoId={qrPara}
            onReconectar={(id) => void fetchQr(id)}
            onMudou={() => void recarregar()}
          />
        </div>

        {algumConectado ? (
          <div className="flex items-center gap-2 text-xs">
            {syncingWebhook ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : syncError ? (
              <>
                <span className="text-amber-300">{syncError}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void repairWebhook(true)}
                  disabled={syncingWebhook}
                >
                  <RefreshCw className="size-4" />
                  Tentar novamente
                </Button>
              </>
            ) : (
              <span className="text-muted-foreground">
                Mensagens do celular sincronizadas com o CRM.
              </span>
            )}
          </div>
        ) : null}

        {connectError && (
          <div
            role="alert"
            className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300"
          >
            {connectError}
          </div>
        )}

        {painelQr ?? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchQr('novo')}
              disabled={busy}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Adicionar outro número
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void gerarLink(true)}
              disabled={linkBusy || !accountId}
            >
              {linkBusy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Link2 className="size-4" />
              )}
              Gerar link para outro número
            </Button>
          </div>
        )}

        {connectLink && !qr ? (
          <div className="flex gap-2">
            <Input
              readOnly
              value={connectLink}
              onFocus={(e) => e.currentTarget.select()}
              className="font-mono text-xs"
            />
            <Button
              variant="outline"
              size="icon"
              className="shrink-0"
              aria-label="Copiar link"
              onClick={() => {
                void navigator.clipboard.writeText(connectLink);
                toast.success('Link copiado.');
              }}
            >
              <Copy className="size-4" />
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  // ---- primeiro número do cliente ------------------------------
  const blocoLink = (
    <div
      className={
        preferir === 'link' ? 'border-border border-b pb-4' : 'pt-1'
      }
    >
      <div className="flex items-start gap-2.5">
        <Link2 className="text-primary mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-foreground text-sm font-medium">
            Enviar o link para o responsável
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Ele abre a página de conexão sem precisar de login. Gerar um link
            novo invalida o anterior.
          </p>

          {connectLink ? (
            <div className="mt-3 flex gap-2">
              <Input
                readOnly
                value={connectLink}
                onFocus={(e) => e.currentTarget.select()}
                className="font-mono text-xs"
              />
              <Button
                variant="outline"
                size="icon"
                className="shrink-0"
                aria-label="Copiar link"
                onClick={() => {
                  void navigator.clipboard.writeText(connectLink);
                  toast.success('Link copiado.');
                }}
              >
                <Copy className="size-4" />
              </Button>
            </div>
          ) : (
            <Button
              variant={preferir === 'link' ? 'outline' : 'ghost'}
              size="sm"
              className="mt-3"
              onClick={() => void gerarLink(false)}
              disabled={linkBusy || !accountId}
            >
              {linkBusy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Link2 className="size-4" />
              )}
              Gerar link de conexão
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  const blocoQr =
    painelQr ??
    (preferir === 'qr' ? (
      <Button onClick={() => void fetchQr(null)} disabled={busy || !checked}>
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <QrCode className="size-4" />
        )}
        Ver QR Code agora
      </Button>
    ) : (
      <Button
        variant="outline"
        onClick={() => void fetchQr(null)}
        disabled={busy || !checked}
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <QrCode className="size-4" />
        )}
        Ver QR Code aqui
      </Button>
    ));

  return (
    <div className="space-y-4">
      <p className="text-foreground text-sm font-medium">
        {preferir === 'qr'
          ? 'Conectar por QR Code'
          : 'Conectar o WhatsApp deste cliente'}
      </p>
      <p className="text-muted-foreground mt-1 text-sm">
        {preferir === 'qr'
          ? 'Escaneie com o celular que está com você. O código atualiza sozinho.'
          : 'Mande o link para quem está com o celular. Se preferir, o QR também fica aqui.'}
      </p>

      {connectError && (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300"
        >
          {connectError}
        </div>
      )}

      {/* A ordem vem da resposta do assistente: quem tem o celular na
          mão vê o QR primeiro; quem não tem vê o link. */}
      {preferir === 'qr' ? (
        <>
          {blocoQr}
          <div className="border-border border-t pt-4">{blocoLink}</div>
        </>
      ) : (
        <>
          {blocoLink}
          {blocoQr}
        </>
      )}
    </div>
  );
}

