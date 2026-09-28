'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  CircleDashed,
  Code2,
  Copy,
  Loader2,
  Megaphone,
  MessageCircle,
  PartyPopper,
  SlidersHorizontal,
  UserRound,
} from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ClientLogo } from '@/components/clients/client-logo';
import { createClient } from '@/lib/supabase/client';
import {
  ClientSetupDialog,
  type ClientSetupStep,
} from '@/components/clients/client-setup-dialog';
import { EvolutionConnect } from '@/components/settings/evolution-connect';
import { GoogleAdsConfig } from '@/components/settings/google-ads-config';
import { MetaBusinessConfig } from '@/components/clients/meta-business-config';
import { AgencyPixelConfig } from '@/components/clients/agency-pixel-config';
import { ClientOptionsConfig } from '@/components/clients/client-options-config';

export interface ClientSetupTarget {
  account_id: string;
  account_name: string;
  whatsapp_connected: boolean;
  /** Logo já salva do cliente, para o assistente abrir mostrando-a. */
  logo_url?: string | null;
  /** Perfil operacional (migration 059), para reabrir preenchido. */
  segment?: string | null;
  whatsapp_owner?: 'agencia' | 'cliente' | null;
  ad_platforms?: string[] | null;
  conversation_scope?: 'todas' | 'sem_grupos' | null;
}

/**
 * Sugestões de ramo.
 *
 * São só sugestões, num `datalist`: o campo aceita qualquer texto. Uma
 * lista fechada sempre falta justo o ramo do cliente novo, e aí a
 * pessoa escolhe "Outro" e o dado morre.
 */
const SEGMENTOS_SUGERIDOS = [
  'Odontologia',
  'Estética e beleza',
  'Saúde e bem-estar',
  'Imobiliária',
  'Advocacia',
  'Educação e cursos',
  'Alimentação',
  'Varejo',
  'Serviços automotivos',
  'Academia e esportes',
  'Pet',
  'Construção e reforma',
];

interface SetupSummary {
  whatsapp: boolean;
  whatsappPhone: string | null;
  metaAds: boolean;
  googleAds: boolean;
  agencyPixel: boolean;
}

const STEPS: ClientSetupStep[] = [
  {
    id: 1,
    label: 'Dados do cliente',
    description: 'Identifique a conta que será gerenciada pela agência.',
    icon: UserRound,
  },
  {
    id: 2,
    label: 'Conectar WhatsApp',
    description: 'Conecte por QR Code ou envie um link ao responsável.',
    icon: MessageCircle,
  },
  {
    id: 3,
    label: 'Meta Ads',
    description: 'Escolha a conta de anúncio, páginas e Pixel da Meta.',
    icon: Megaphone,
  },
  {
    id: 4,
    label: 'Pixel Global',
    description: 'Instale a atribuição da agência e configure o Google Ads.',
    icon: Code2,
  },
  {
    id: 5,
    label: 'Finalizar',
    description: 'Confira o que está pronto antes de começar a operar.',
    icon: PartyPopper,
  },
  {
    id: 6,
    label: 'Opcionais',
    description: 'Mensagem, webhooks, tipo de pixel e portal do cliente.',
    icon: SlidersHorizontal,
    optional: true,
  },
];

export function NewClientWizard({
  open,
  onOpenChange,
  onDone,
  client,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
  client?: ClientSetupTarget | null;
}) {
  const router = useRouter();
  const { refreshProfile } = useAuth();
  const editing = Boolean(client);

  const [step, setStep] = useState(1);
  const [name, setName] = useState(client?.account_name ?? '');
  // Logo: o arquivo fica em memória até a conta ser salva. Subir antes
  // deixaria imagem órfã no storage se a pessoa desistir no meio.
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(
    client?.logo_url ?? null,
  );
  const [enviandoLogo, setEnviandoLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState<string | null>(client?.account_id ?? null);
  const [createdName, setCreatedName] = useState(client?.account_name ?? '');
  const [activated, setActivated] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [unlockedStep, setUnlockedStep] = useState(client ? STEPS.length : 1);
  const [waConnected, setWaConnected] = useState(
    client?.whatsapp_connected ?? false
  );
  // Perfil operacional: quatro respostas que a agência já tem na cabeça
  // no cadastro e que moldam o resto do assistente.
  const [segment, setSegment] = useState(client?.segment ?? '');
  const [whatsappOwner, setWhatsappOwner] = useState<'agencia' | 'cliente'>(
    client?.whatsapp_owner ?? 'cliente'
  );
  // Meta como padrão só no cadastro NOVO. Na edição vale o que está
  // gravado, inclusive vazio: `[]` é tanto "não anuncia em lugar nenhum"
  // quanto "cliente antigo, nunca perguntado", e marcar Meta sozinho
  // faria um "salvar" descuidado inventar uma resposta que o usuário
  // nunca deu.
  const [adPlatforms, setAdPlatforms] = useState<string[]>(
    client ? (client.ad_platforms ?? []) : ['meta']
  );
  const [conversationScope, setConversationScope] = useState<
    'todas' | 'sem_grupos'
  >(client?.conversation_scope ?? 'todas');

  const anunciaMeta = adPlatforms.includes('meta');
  const anunciaGoogle = adPlatforms.includes('google');

  const [summary, setSummary] = useState<SetupSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  const ensureActive = useCallback(
    async (accountId: string) => {
      setSwitching(true);
      try {
        const res = await fetch('/api/account/active', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ accountId }),
        });
        if (!res.ok) {
          toast.error('Não foi possível abrir este cliente para configurar');
          return false;
        }
        await refreshProfile();
        setActivated(true);
        return true;
      } catch {
        toast.error('Não foi possível abrir este cliente para configurar');
        return false;
      } finally {
        setSwitching(false);
      }
    },
    [refreshProfile]
  );

  useEffect(() => {
    if (!open || !client?.account_id) return;
    void ensureActive(client.account_id);
  }, [client?.account_id, ensureActive, open]);

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const [whatsappRes, metaRes, googleRes, optionsRes] = await Promise.all([
        fetch('/api/whatsapp/evolution/status', { cache: 'no-store' }),
        fetch('/api/account/meta-ads', { cache: 'no-store' }),
        fetch('/api/account/google-ads', { cache: 'no-store' }),
        fetch('/api/account/client-options', { cache: 'no-store' }),
      ]);
      const whatsapp = (await whatsappRes.json().catch(() => ({}))) as {
        connected?: boolean;
        phone?: string | null;
      };
      const meta = (await metaRes.json().catch(() => ({}))) as {
        config?: { pixel_id?: string; hasToken?: boolean };
      };
      const google = (await googleRes.json().catch(() => ({}))) as {
        config?: {
          customer_id?: string;
          hasDeveloperToken?: boolean;
          hasOAuth?: boolean;
        };
      };
      const options = (await optionsRes.json().catch(() => ({}))) as {
        options?: { pixel_verified_at?: string | null };
      };

      setSummary({
        whatsapp: Boolean(whatsappRes.ok && whatsapp.connected),
        whatsappPhone: whatsapp.phone ?? null,
        metaAds: Boolean(
          metaRes.ok && meta.config?.pixel_id && meta.config.hasToken
        ),
        googleAds: Boolean(
          googleRes.ok &&
          google.config?.customer_id &&
          google.config.hasDeveloperToken &&
          google.config.hasOAuth
        ),
        agencyPixel: Boolean(
          optionsRes.ok && options.options?.pixel_verified_at
        ),
      });
    } catch {
      toast.error('Não foi possível conferir todas as integrações');
      setSummary({
        whatsapp: waConnected,
        whatsappPhone: null,
        metaAds: false,
        googleAds: false,
        agencyPixel: false,
      });
    } finally {
      setSummaryLoading(false);
    }
  }, [waConnected]);

  useEffect(() => {
    if (step !== 5 || !activated) return;
    void loadSummary();
  }, [activated, loadSummary, step]);

  function reset() {
    setStep(1);
    setName(client?.account_name ?? '');
    setCreating(false);
    setNewId(client?.account_id ?? null);
    setCreatedName(client?.account_name ?? '');
    setActivated(false);
    setSwitching(false);
    setUnlockedStep(client ? STEPS.length : 1);
    setWaConnected(client?.whatsapp_connected ?? false);
    setSummary(null);
    setSummaryLoading(false);
    setCopiedId(false);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  }

  async function saveAccountAndNext() {
    const nextName = name.trim();
    if (!nextName || creating) return;
    setCreating(true);
    try {
      let accountId = newId;

      if (accountId) {
        if (nextName !== createdName) {
          const res = await fetch(`/api/account/workspaces/${accountId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: nextName }),
          });
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          if (!res.ok) {
            toast.error(body.error ?? 'Não foi possível salvar o nome');
            return;
          }
          setCreatedName(nextName);
          onDone();
        }
      } else {
        const res = await fetch('/api/account/workspaces', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: nextName }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          id?: string;
          error?: string;
        };
        if (!res.ok || !body.id) {
          toast.error(body.error ?? 'Não foi possível criar o cliente');
          return;
        }
        accountId = body.id;
        setNewId(body.id);
        setCreatedName(nextName);
        onDone();
      }

      // Perfil operacional, num PATCH próprio.
      //
      // Separado do nome porque ele já tem a regra de "só salva se
      // mudou", e porque estes quatro precisam ir mesmo quando o nome
      // não mudou — é a única passagem pelo passo 1 em que eles são
      // respondidos. Falha aqui não derruba o passo: a conta existe e o
      // resto do assistente funciona sem eles.
      if (accountId) {
        try {
          const res = await fetch(`/api/account/workspaces/${accountId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              segment,
              whatsapp_owner: whatsappOwner,
              ad_platforms: adPlatforms,
              conversation_scope: conversationScope,
            }),
          });
          if (!res.ok) throw new Error('perfil');
        } catch {
          toast.error(
            'O cliente foi salvo, mas o perfil (ramo, plataformas) não. Dá para ajustar depois em Configurações.'
          );
        }
      }

      // A logo sobe DEPOIS de existir a conta: o caminho no storage é
      // por conta, e sem o id não há onde guardar. Falha aqui não
      // derruba o passo — a conta já está criada, e logo é opcional.
      if (accountId && logoFile) {
        setEnviandoLogo(true);
        try {
          const supabase = createClient();
          const ext = logoFile.name.split('.').pop()?.toLowerCase() || 'png';
          const path = `account-${accountId}/logo-${Date.now()}.${ext}`;
          const { error: upErr } = await supabase.storage
            .from('avatars')
            .upload(path, logoFile, {
              cacheControl: '3600',
              upsert: true,
              contentType: logoFile.type,
            });
          if (upErr) throw new Error(upErr.message);
          const {
            data: { publicUrl },
          } = supabase.storage.from('avatars').getPublicUrl(path);
          const res = await fetch(`/api/account/workspaces/${accountId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ logo_url: publicUrl }),
          });
          if (!res.ok) throw new Error('não foi possível salvar a logo');
          setLogoFile(null);
          setLogoPreview(publicUrl);
          onDone();
        } catch (err) {
          toast.error(
            `Cliente salvo, mas a logo falhou: ${
              err instanceof Error ? err.message : 'erro'
            }`,
          );
        } finally {
          setEnviandoLogo(false);
        }
      }

      const active = activated || (await ensureActive(accountId));
      if (!active) return;
      setUnlockedStep(STEPS.length);
      setStep(2);
    } finally {
      setCreating(false);
    }
  }

  function goToStep(nextStep: number) {
    if (nextStep < 1 || nextStep > unlockedStep) return;
    if (nextStep > 1 && (!newId || !activated)) return;
    setStep(nextStep);
  }

  async function copyAccountId() {
    if (!newId) return;
    try {
      await navigator.clipboard.writeText(newId);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2_000);
    } catch {
      toast.error('Não foi possível copiar o ID');
    }
  }

  async function enterClient() {
    if (!newId) return;
    const active = activated || (await ensureActive(newId));
    if (!active) return;
    handleOpenChange(false);
    router.push('/dashboard');
  }

  const footer =
    step === 1 ? (
      <>
        <Button
          variant="outline"
          onClick={() => handleOpenChange(false)}
          disabled={creating || switching}
        >
          Cancelar
        </Button>
        <Button
          onClick={saveAccountAndNext}
          disabled={creating || switching || !name.trim()}
        >
          {creating || switching ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ArrowRight className="size-4" />
          )}
          {newId ? 'Salvar e continuar' : 'Criar e continuar'}
        </Button>
      </>
    ) : step < 5 ? (
      <>
        <Button variant="outline" onClick={() => goToStep(step - 1)}>
          <ArrowLeft className="size-4" />
          Voltar
        </Button>
        <Button onClick={() => goToStep(step + 1)}>
          Continuar
          <ArrowRight className="size-4" />
        </Button>
      </>
    ) : step === 5 ? (
      <>
        <Button variant="outline" onClick={() => goToStep(6)}>
          <SlidersHorizontal className="size-4" />
          Opcionais
        </Button>
        <Button variant="outline" onClick={() => handleOpenChange(false)}>
          Voltar à lista
        </Button>
        <Button onClick={enterClient} disabled={switching}>
          {switching ? <Loader2 className="size-4 animate-spin" /> : null}
          Entrar no cliente
          <ArrowRight className="size-4" />
        </Button>
      </>
    ) : (
      <>
        <Button variant="outline" onClick={() => goToStep(5)}>
          <ArrowLeft className="size-4" />
          Voltar ao fluxo
        </Button>
        <Button onClick={() => goToStep(5)}>
          Finalizar
          <ArrowRight className="size-4" />
        </Button>
      </>
    );

  return (
    <ClientSetupDialog
      open={open}
      onOpenChange={handleOpenChange}
      accountName={name}
      title={editing ? 'Configurar cliente' : 'Novo cliente'}
      steps={STEPS}
      activeStep={step}
      canNavigate={(nextStep) =>
        nextStep <= unlockedStep &&
        (nextStep === 1 || Boolean(newId && activated))
      }
      onStepChange={goToStep}
      footer={footer}
    >
      {step === 1 ? (
        <div className="max-w-xl">
          <label
            htmlFor="client-account-name"
            className="text-foreground text-sm font-medium"
          >
            Nome do cliente
          </label>
          <Input
            id="client-account-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ex.: Padaria do João"
            autoFocus
            maxLength={120}
            className="mt-2"
            onKeyDown={(event) => {
              if (event.key === 'Enter') void saveAccountAndNext();
            }}
          />
          {/* Logo do cliente. Fica no passo 1, junto do nome, porque é a
              outra metade da identidade — numa lista de dezenas de
              clientes é a logo que faz reconhecer de relance, antes de
              ler. Opcional: sem ela, a inicial do nome resolve. */}
          <div className="mt-5 flex items-center gap-4">
            <ClientLogo name={name || '?'} logoUrl={logoPreview} size={56} />
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="client-logo"
                className="text-foreground text-sm font-medium"
              >
                Logo do cliente{' '}
                <span className="text-muted-foreground font-normal">
                  (opcional)
                </span>
              </label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => logoInputRef.current?.click()}
                  disabled={enviandoLogo}
                >
                  {enviandoLogo ? 'Enviando…' : 'Escolher imagem'}
                </Button>
                {logoPreview ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setLogoPreview(null);
                      setLogoFile(null);
                    }}
                    disabled={enviandoLogo}
                  >
                    Remover
                  </Button>
                ) : null}
              </div>
              <p className="text-muted-foreground text-xs">
                PNG, JPG ou WebP, até 2 MB.
              </p>
            </div>
            <input
              ref={logoInputRef}
              id="client-logo"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => {
                const arquivo = event.target.files?.[0];
                // Limpa o input SEMPRE: sem isso, escolher o mesmo
                // arquivo duas vezes seguidas não dispara o onChange.
                event.target.value = '';
                if (!arquivo) return;
                if (arquivo.size > 2 * 1024 * 1024) {
                  toast.error('A imagem precisa ter no máximo 2 MB.');
                  return;
                }
                setLogoFile(arquivo);
                // Pré-visualização local: mostra na hora, sem esperar o
                // upload, que só acontece ao salvar a conta.
                setLogoPreview(URL.createObjectURL(arquivo));
              }}
            />
          </div>


          {/* Ramo do cliente. Fica junto do nome porque é identidade,
              não configuração — e é o que permite filtrar a lista de
              clientes por setor quando ela passa de vinte. */}
          <div className="mt-5">
            <label
              htmlFor="client-segment"
              className="text-foreground text-sm font-medium"
            >
              Ramo do cliente{' '}
              <span className="text-muted-foreground font-normal">
                (opcional)
              </span>
            </label>
            <Input
              id="client-segment"
              list="segmentos-sugeridos"
              value={segment}
              onChange={(event) => setSegment(event.target.value)}
              placeholder="Ex.: Odontologia"
              maxLength={60}
              className="mt-2"
            />
            {/* `datalist` nativo: sugere sem impedir. */}
            <datalist id="segmentos-sugeridos">
              {SEGMENTOS_SUGERIDOS.map((seg) => (
                <option key={seg} value={seg} />
              ))}
            </datalist>
          </div>

          {/* Três perguntas que mudam o RESTO do assistente. Ficam aqui,
              antes de tudo, porque respondê-las depois significaria
              desfazer configuração já feita. */}
          <div className="border-border mt-6 rounded-lg border p-4">
            <p className="text-foreground text-sm font-medium">
              Como vamos configurar
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              Serve para o assistente não pedir o que este cliente não usa.
            </p>

            <div className="mt-4">
              <p className="text-foreground text-sm font-medium">
                Quem vai conectar o WhatsApp?
              </p>
              <RadioGroup
                value={whatsappOwner}
                onValueChange={(v) =>
                  setWhatsappOwner(v as 'agencia' | 'cliente')
                }
                className="mt-2"
              >
                <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                  <RadioGroupItem value="cliente" className="mt-0.5" />
                  <span>
                    O responsável do cliente
                    <span className="text-muted-foreground block text-xs">
                      Mandamos um link para ele abrir e escanear.
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                  <RadioGroupItem value="agencia" className="mt-0.5" />
                  <span>
                    Eu, com o celular em mãos
                    <span className="text-muted-foreground block text-xs">
                      O QR Code aparece direto na próxima etapa.
                    </span>
                  </span>
                </label>
              </RadioGroup>
            </div>

            <div className="border-border mt-5 border-t pt-4">
              <p className="text-foreground text-sm font-medium">
                Onde este cliente anuncia?
              </p>
              <div className="mt-2 flex flex-col gap-2">
                {[
                  { id: 'meta', nome: 'Meta (Facebook e Instagram)' },
                  { id: 'google', nome: 'Google Ads' },
                ].map((plat) => (
                  <label
                    key={plat.id}
                    className="flex cursor-pointer items-center gap-2.5 text-sm"
                  >
                    <Checkbox
                      checked={adPlatforms.includes(plat.id)}
                      onCheckedChange={(marcado) =>
                        setAdPlatforms((atual) =>
                          marcado
                            ? [...new Set([...atual, plat.id])]
                            : atual.filter((p) => p !== plat.id)
                        )
                      }
                    />
                    {plat.nome}
                  </label>
                ))}
              </div>
              {adPlatforms.length === 0 ? (
                // Nenhuma marcada é uma resposta válida (o cliente pode
                // só usar WhatsApp), mas precisa ficar claro que as
                // etapas de anúncio somem — senão parece defeito.
                <p className="text-muted-foreground mt-2 text-xs">
                  Sem nenhuma marcada, as etapas de anúncio ficam disponíveis
                  mas não são pedidas.
                </p>
              ) : null}
            </div>

            <div className="border-border mt-5 border-t pt-4">
              <p className="text-foreground text-sm font-medium">
                Quais conversas guardar no CRM?
              </p>
              <RadioGroup
                value={conversationScope}
                onValueChange={(v) =>
                  setConversationScope(v as 'todas' | 'sem_grupos')
                }
                className="mt-2"
              >
                <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                  <RadioGroupItem value="todas" className="mt-0.5" />
                  <span>
                    Todas
                    <span className="text-muted-foreground block text-xs">
                      Inclusive grupos.
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                  <RadioGroupItem value="sem_grupos" className="mt-0.5" />
                  <span>
                    Só conversas individuais
                    <span className="text-muted-foreground block text-xs">
                      Mensagens de grupo são descartadas na entrada. Vale para
                      as próximas; nada já salvo é apagado.
                    </span>
                  </span>
                </label>
              </RadioGroup>
            </div>
          </div>

          <div className="border-border bg-muted/30 mt-4 rounded-lg border p-4">
            <p className="text-foreground text-sm font-medium">
              Uma conta separada para cada cliente
            </p>
            <p className="text-muted-foreground mt-1 text-sm leading-6">
              WhatsApp, contatos, conversas, funil e integrações ficam isolados.
              A agência continua administrando tudo pelo Portal de Clientes.
            </p>
          </div>
          {switching ? (
            <p className="text-muted-foreground mt-3 flex items-center gap-2 text-xs">
              <Loader2 className="size-3.5 animate-spin" />
              Preparando a conta para configuração
            </p>
          ) : null}
        </div>
      ) : null}

      {step === 2 && newId ? (
        <div className="flex flex-col gap-4">
          <div className="border-primary/20 bg-primary/5 text-muted-foreground rounded-lg border p-4 text-sm">
            {whatsappOwner === 'agencia'
              ? 'Você disse que está com o celular. Abra o QR abaixo e escaneie — se precisar, o link para enviar continua disponível.'
              : 'Você disse que o celular é do responsável. Gere o link e mande para ele; ele abre sem precisar de login.'}
          </div>
          <EvolutionConnect
            key={`whatsapp-${newId}`}
            preferir={whatsappOwner === 'agencia' ? 'qr' : 'link'}
            onConnected={() => {
              setWaConnected(true);
              toast.success('WhatsApp conectado');
            }}
          />
        </div>
      ) : null}

      {step === 3 && newId ? (
        anunciaMeta ? (
          <MetaBusinessConfig key={`meta-business-${newId}`} />
        ) : (
          // Não some da navegação: a resposta do passo 1 pode mudar, e
          // uma etapa que desaparece faz a pessoa achar que perdeu algo.
          // Fica explicado, com a saída à mão.
          <EtapaNaoUsada
            titulo="Este cliente não anuncia na Meta"
            descricao="Você marcou só outras plataformas no passo 1. Conta de anúncio, páginas e Pixel da Meta não são necessários."
            onConfigurarMesmoAssim={() =>
              setAdPlatforms((atual) => [...new Set([...atual, 'meta'])])
            }
          />
        )
      ) : null}

      {step === 4 ? (
        <div className="flex flex-col gap-10">
          {/* O Pixel Global é da AGÊNCIA, não da plataforma: serve para
              atribuir o lead independente de onde o anúncio rodou.
              Aparece sempre. */}
          <AgencyPixelConfig key={`agency-pixel-${newId}`} accountId={newId!} />
          <div className="border-border border-t pt-8">
            {anunciaGoogle ? (
              <GoogleAdsConfig key={`google-${newId}`} />
            ) : (
              <EtapaNaoUsada
                titulo="Este cliente não anuncia no Google"
                descricao="Você marcou só outras plataformas no passo 1."
                onConfigurarMesmoAssim={() =>
                  setAdPlatforms((atual) => [...new Set([...atual, 'google'])])
                }
              />
            )}
          </div>
        </div>
      ) : null}

      {step === 5 ? (
        <div className="mx-auto flex max-w-2xl flex-col gap-5">
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                <CheckCircle2 className="size-5" />
              </div>
              <div>
                <p className="text-foreground font-semibold">
                  {editing ? 'Configuração revisada' : 'Cliente criado'}
                </p>
                <p className="text-muted-foreground mt-1 text-sm">
                  Você pode voltar a qualquer etapa ou entrar no cliente agora.
                </p>
              </div>
            </div>
          </div>

          {summaryLoading && !summary ? (
            <div className="border-border text-muted-foreground flex items-center justify-center gap-2 rounded-xl border py-10 text-sm">
              <Loader2 className="size-4 animate-spin" />
              Conferindo integrações
            </div>
          ) : (
            <div className="border-border bg-card overflow-hidden rounded-xl border">
              <StatusRow
                ready
                label="Conta do cliente"
                detail={name.trim()}
                action={
                  newId ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={copyAccountId}
                      aria-label="Copiar ID da conta"
                      title={newId}
                    >
                      {copiedId ? (
                        <Check className="size-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                    </Button>
                  ) : null
                }
              />
              <StatusRow
                ready={summary?.whatsapp ?? waConnected}
                label="WhatsApp"
                detail={
                  summary?.whatsapp
                    ? summary.whatsappPhone || 'Conectado'
                    : 'Pode ser conectado depois'
                }
              />
              <StatusRow
                ready={summary?.metaAds ?? false}
                label="Meta Ads"
                detail={
                  summary?.metaAds
                    ? 'Pixel e API de Conversão configurados'
                    : 'Configuração opcional'
                }
              />
              <StatusRow
                ready={summary?.googleAds ?? false}
                label="Google Ads"
                detail={
                  summary?.googleAds
                    ? 'Conta e credenciais configuradas'
                    : 'Configuração opcional'
                }
              />
              <StatusRow
                ready={summary?.agencyPixel ?? false}
                label="Pixel Global"
                detail={
                  summary?.agencyPixel
                    ? 'Instalação verificada no site'
                    : 'Instalação opcional'
                }
              />
            </div>
          )}
        </div>
      ) : null}

      {step === 6 ? <ClientOptionsConfig key={`options-${newId}`} /> : null}
    </ClientSetupDialog>
  );
}

function StatusRow({
  ready,
  label,
  detail,
  action,
}: {
  ready: boolean;
  label: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="border-border flex items-center gap-3 border-b px-4 py-3 last:border-b-0">
      {ready ? (
        <CheckCircle2 className="size-5 shrink-0 text-emerald-500" />
      ) : (
        <CircleDashed className="text-muted-foreground size-5 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-foreground text-sm font-medium">{label}</p>
        <p className="text-muted-foreground truncate text-xs">{detail}</p>
      </div>
      {action}
      <span
        className={
          ready
            ? 'text-xs font-medium text-emerald-500'
            : 'text-muted-foreground text-xs'
        }
      >
        {ready ? 'Pronto' : 'Pendente'}
      </span>
    </div>
  );
}

/**
 * Uma etapa que este cliente não usa.
 *
 * Some do fluxo sem sumir da navegação. Uma etapa que desaparece da
 * barra faz a pessoa achar que perdeu alguma coisa — e a resposta do
 * passo 1 pode ter sido um clique errado, então a saída fica à mão.
 */
function EtapaNaoUsada({
  titulo,
  descricao,
  onConfigurarMesmoAssim,
}: {
  titulo: string;
  descricao: string;
  onConfigurarMesmoAssim: () => void;
}) {
  return (
    <div className="border-border bg-muted/30 mx-auto max-w-xl rounded-lg border p-5 text-center">
      <p className="text-foreground text-sm font-medium">{titulo}</p>
      <p className="text-muted-foreground mt-1 text-sm leading-6">
        {descricao}
      </p>
      <Button
        variant="outline"
        size="sm"
        className="mt-4"
        onClick={onConfigurarMesmoAssim}
      >
        Configurar mesmo assim
      </Button>
    </div>
  );
}
