'use client';

// ============================================================
// Modal criar/editar de Link Rastreável.
//
// Número WhatsApp: select com os números conectados da conta ativa
// (evolution_instances.phone; a config Meta não guarda número
// discável). Sem número no banco, cai num campo manual com validação
// E.164. A Mensagem Padrão é obrigatória: é a assinatura que atribui
// o lead ao link (índice único por conta entre links ativos).
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { generateLinkCode } from '@/lib/tracking-links/code';
import { isValidE164, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';
import { isUniqueViolation } from '@/lib/contacts/dedupe';
import type { TrackingLink } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface LinkFormModalProps {
  open: boolean;
  /** null = criar; preenchido = editar. */
  link: TrackingLink | null;
  onOpenChange: (open: boolean) => void;
  /** Chamado após salvar com sucesso (a página refaz o fetch). */
  onSaved: () => void;
}

interface FormState {
  name: string;
  phone: string;
  message: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_term: string;
  utm_content: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  phone: '',
  message: '',
  utm_source: '',
  utm_medium: '',
  utm_campaign: '',
  utm_term: '',
  utm_content: '',
};

/** Tentativas de regenerar o código em colisão (índice UNIQUE). */
const CODE_RETRIES = 3;

export function LinkFormModal({
  open,
  link,
  onOpenChange,
  onSaved,
}: LinkFormModalProps) {
  const { accountId } = useAuth();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [numbers, setNumbers] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // (Re)inicializa ao abrir: form do link em edição ou vazio, e busca
  // os números conectados da conta ativa.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm(
      link
        ? {
            name: link.name,
            phone: link.phone,
            message: link.message,
            utm_source: link.utm_source ?? '',
            utm_medium: link.utm_medium ?? '',
            utm_campaign: link.utm_campaign ?? '',
            utm_term: link.utm_term ?? '',
            utm_content: link.utm_content ?? '',
          }
        : EMPTY_FORM
    );

    const supabase = createClient();
    supabase
      .from('evolution_instances')
      .select('phone, status')
      .then(({ data }) => {
        const phones = (data ?? [])
          .filter((row) => row.status === 'connected' && row.phone)
          .map((row) => String(row.phone));
        setNumbers(phones);
      });
    if (!link) {
      fetch('/api/account/client-options', { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((body: { options?: { default_message?: string } } | null) => {
          const defaultMessage = body?.options?.default_message?.trim();
          if (!defaultMessage) return;
          setForm((current) =>
            current.message ? current : { ...current, message: defaultMessage },
          );
        })
        .catch(() => {});
    }
  }, [open, link]);

  const set = useCallback(
    (field: keyof FormState) => (value: string) =>
      setForm((prev) => ({ ...prev, [field]: value })),
    []
  );

  const handleSave = useCallback(async () => {
    const name = form.name.trim();
    const message = form.message.trim();
    const phoneDigits = sanitizePhoneForMeta(form.phone);
    const phone = `+${phoneDigits}`;

    if (!name || !message || !form.phone) {
      toast.error('Preencha nome, número e mensagem padrão');
      return;
    }
    if (!isValidE164(phone)) {
      toast.error('Número inválido: use o formato com DDI, ex. +5531999998888');
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const utmFields = {
      utm_source: form.utm_source.trim() || null,
      utm_medium: form.utm_medium.trim() || null,
      utm_campaign: form.utm_campaign.trim() || null,
      utm_term: form.utm_term.trim() || null,
      utm_content: form.utm_content.trim() || null,
    };

    try {
      if (link) {
        const { error } = await supabase
          .from('tracking_links')
          .update({ name, phone, message, ...utmFields })
          .eq('id', link.id);
        if (error) throw error;
      } else {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.user || !accountId) {
          toast.error('Sessão expirada: recarregue a página');
          return;
        }
        // Colisão de código é rara (62^8), mas o índice UNIQUE pode
        // rejeitar: regenera e tenta de novo até CODE_RETRIES vezes.
        let lastError: unknown = null;
        for (let attempt = 0; attempt < CODE_RETRIES; attempt++) {
          const { error } = await supabase.from('tracking_links').insert({
            account_id: accountId,
            user_id: session.user.id,
            name,
            code: generateLinkCode(),
            phone,
            message,
            ...utmFields,
            active: true,
          });
          lastError = error;
          if (!error) break;
          // Mensagem duplicada não é colisão de código: não re-tentar.
          if (error.message?.includes('uq_tracking_links_active_message')) {
            throw error;
          }
          if (!isUniqueViolation(error)) throw error;
        }
        if (lastError) throw lastError;
      }

      toast.success(link ? 'Link atualizado' : 'Link criado');
      onOpenChange(false);
      onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('uq_tracking_links_active_message')) {
        toast.error(
          'Já existe um link ativo com esta mensagem. Use uma mensagem única por link.'
        );
      } else {
        toast.error('Não foi possível salvar o link');
      }
    } finally {
      setSaving(false);
    }
  }, [form, link, accountId, onOpenChange, onSaved]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* sm:max-w-* (com prefixo) para vencer o sm:max-w-sm da base do
          DialogContent; sem o prefixo o modal fica com 384px no desktop. */}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {link ? 'Editar Link Rastreável' : 'Criar Link Rastreável'}
          </DialogTitle>
          <DialogDescription>
            Crie um link para identificar a origem das conversas no WhatsApp
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="tl-name">Nome do Link *</Label>
              <Input
                id="tl-name"
                placeholder="Ex: Campanha Instagram Janeiro"
                value={form.name}
                onChange={(e) => set('name')(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Número WhatsApp *</Label>
              {numbers.length > 0 ? (
                <Select
                  value={form.phone}
                  onValueChange={(v) => v && set('phone')(v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o número" />
                  </SelectTrigger>
                  <SelectContent>
                    {/* Edição de link cujo número não está mais entre os
                        conectados: mantém o valor atual como opção extra
                        para não sumir do select. */}
                    {(form.phone && !numbers.includes(form.phone)
                      ? [form.phone, ...numbers]
                      : numbers
                    ).map((n) => (
                      <SelectItem key={n} value={n}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  placeholder="+5531999998888"
                  value={form.phone}
                  onChange={(e) => set('phone')(e.target.value)}
                />
              )}
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Parâmetros UTM</Label>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label
                  htmlFor="tl-utm-source"
                  className="text-xs text-muted-foreground"
                >
                  Source
                </Label>
                <Input
                  id="tl-utm-source"
                  placeholder="instagram"
                  value={form.utm_source}
                  onChange={(e) => set('utm_source')(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label
                  htmlFor="tl-utm-medium"
                  className="text-xs text-muted-foreground"
                >
                  Medium
                </Label>
                <Input
                  id="tl-utm-medium"
                  placeholder="social"
                  value={form.utm_medium}
                  onChange={(e) => set('utm_medium')(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label
                  htmlFor="tl-utm-campaign"
                  className="text-xs text-muted-foreground"
                >
                  Campaign
                </Label>
                <Input
                  id="tl-utm-campaign"
                  placeholder="promo_janeiro"
                  value={form.utm_campaign}
                  onChange={(e) => set('utm_campaign')(e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label
                  htmlFor="tl-utm-term"
                  className="text-xs text-muted-foreground"
                >
                  Term
                </Label>
                <Input
                  id="tl-utm-term"
                  placeholder="palavra_chave"
                  value={form.utm_term}
                  onChange={(e) => set('utm_term')(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label
                  htmlFor="tl-utm-content"
                  className="text-xs text-muted-foreground"
                >
                  Content
                </Label>
                <Input
                  id="tl-utm-content"
                  placeholder="banner_topo"
                  value={form.utm_content}
                  onChange={(e) => set('utm_content')(e.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Usados como padrão quando a URL do clique não trouxer UTMs (a
              LP repassa os da campanha automaticamente).
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="tl-message">Mensagem Padrão *</Label>
            <Textarea
              id="tl-message"
              rows={4}
              placeholder="Olá! Vi seu anúncio e gostaria de saber mais..."
              value={form.message}
              onChange={(e) => set('message')(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Obrigatória. Usada como assinatura para atribuição precisa do
              lead ao link.
            </p>
            <p className="text-xs text-muted-foreground">
              Esta mensagem será preenchida automaticamente ao abrir o
              WhatsApp
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={saving} onClick={handleSave}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {link ? 'Salvar' : 'Criar Link'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
