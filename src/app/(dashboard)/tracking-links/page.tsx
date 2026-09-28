'use client';

// ============================================================
// Links Rastreáveis: links curtos /t/<code> que abrem o WhatsApp com
// mensagem pré-preenchida, contando cliques e conversas geradas
// (atribuídas pela mensagem-assinatura). Padrão da página de
// Disparos: supabase client + RLS, useCan/GatedButton para escrita.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Link2,
  Loader2,
  MessagesSquare,
  MousePointerClick,
  Pencil,
  Percent,
  Plus,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import type { TrackingLink } from '@/types';
import { useCan } from '@/hooks/use-can';
import { MetricCard } from '@/components/dashboard/metric-card';
import { Button } from '@/components/ui/button';
import { GatedButton } from '@/components/ui/gated-button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { LinkFormModal } from '@/components/tracking-links/link-form-modal';
import { CopyLinkButton } from '@/components/tracking-links/copy-link-button';

function rate(conversations: number, clicks: number): string {
  if (!clicks) return '0%';
  return `${((conversations / clicks) * 100).toFixed(1).replace('.', ',')}%`;
}

export default function TrackingLinksPage() {
  const canWrite = useCan('send-messages');
  const [links, setLinks] = useState<TrackingLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TrackingLink | null>(null);
  const [deleting, setDeleting] = useState<TrackingLink | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const fetchLinks = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data, error: fetchError } = await supabase
        .from('tracking_links')
        .select('*')
        .order('created_at', { ascending: false });
      if (fetchError) throw fetchError;
      setLinks(data ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar links');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchLinks();
  }, [fetchLinks]);

  const totals = useMemo(() => {
    const clicks = links.reduce((sum, l) => sum + l.clicks_count, 0);
    const conversations = links.reduce(
      (sum, l) => sum + l.conversations_count,
      0
    );
    return { count: links.length, clicks, conversations };
  }, [links]);

  const handleToggleActive = useCallback(
    async (link: TrackingLink, active: boolean) => {
      // Otimista com rollback: o switch responde na hora.
      setLinks((prev) =>
        prev.map((l) => (l.id === link.id ? { ...l, active } : l))
      );
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from('tracking_links')
        .update({ active })
        .eq('id', link.id);
      if (updateError) {
        setLinks((prev) =>
          prev.map((l) => (l.id === link.id ? { ...l, active: !active } : l))
        );
        // Reativar pode colidir com outro link ativo de mesma mensagem.
        if (updateError.message?.includes('uq_tracking_links_active_message')) {
          toast.error(
            'Já existe um link ativo com esta mensagem. Edite a mensagem antes de reativar.'
          );
        } else {
          toast.error('Não foi possível alterar o status do link');
        }
      }
    },
    []
  );

  const handleDelete = useCallback(async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from('tracking_links')
      .delete()
      .eq('id', deleting.id);
    setDeleteBusy(false);
    if (deleteError) {
      toast.error('Não foi possível excluir o link');
      return;
    }
    setLinks((prev) => prev.filter((l) => l.id !== deleting.id));
    setDeleting(null);
    toast.success('Link excluído');
  }, [deleting]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Links Rastreáveis
          </h1>
          <p className="text-sm text-muted-foreground">
            Identifique a origem exata dos seus contatos no WhatsApp
          </p>
        </div>
        <GatedButton
          canAct={canWrite}
          gateReason="criar links rastreáveis"
          onClick={() => {
            setEditing(null);
            setModalOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          Novo Link
        </GatedButton>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Total de Links"
          value={totals.count.toLocaleString('pt-BR')}
          icon={Link2}
        />
        <MetricCard
          title="Cliques Totais"
          value={totals.clicks.toLocaleString('pt-BR')}
          icon={MousePointerClick}
        />
        <MetricCard
          title="Conversas Geradas"
          value={totals.conversations.toLocaleString('pt-BR')}
          icon={MessagesSquare}
        />
        <MetricCard
          title="Taxa de Conversão"
          value={rate(totals.conversations, totals.clicks)}
          icon={Percent}
        />
      </div>

      <div className="rounded-xl border border-border bg-card">
        <div className="border-b border-border p-5">
          <h2 className="text-lg font-semibold text-foreground">Seus Links</h2>
          <p className="text-sm text-muted-foreground">
            Gerencie e acompanhe o desempenho dos seus links rastreáveis
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 p-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Carregando links...
          </div>
        ) : error ? (
          <div className="p-12 text-center text-sm text-red-400">{error}</div>
        ) : links.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-12 text-center">
            <Link2 className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">
              Nenhum link rastreável criado ainda
            </p>
            <p className="text-sm text-muted-foreground">
              Crie seu primeiro link para começar a rastrear suas conversas
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Link</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead className="text-right">Cliques</TableHead>
                <TableHead className="text-right">Conversas</TableHead>
                <TableHead className="text-right">Taxa</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {links.map((link) => (
                <TableRow key={link.id}>
                  <TableCell className="font-medium">{link.name}</TableCell>
                  <TableCell>
                    <CopyLinkButton code={link.code} />
                  </TableCell>
                  <TableCell>
                    {link.utm_source ? (
                      <Badge variant="secondary">{link.utm_source}</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {link.clicks_count.toLocaleString('pt-BR')}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {link.conversations_count.toLocaleString('pt-BR')}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {rate(link.conversations_count, link.clicks_count)}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={link.active}
                      disabled={!canWrite}
                      onCheckedChange={(checked) =>
                        handleToggleActive(link, checked)
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={!canWrite}
                        title="Editar"
                        onClick={() => {
                          setEditing(link);
                          setModalOpen(true);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={!canWrite}
                        title="Excluir"
                        onClick={() => setDeleting(link)}
                      >
                        <Trash2 className="h-4 w-4 text-red-400" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <LinkFormModal
        open={modalOpen}
        link={editing}
        onOpenChange={setModalOpen}
        onSaved={fetchLinks}
      />

      <Dialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir link rastreável</DialogTitle>
            <DialogDescription>
              Excluir &quot;{deleting?.name}&quot;? Os contatos já atribuídos
              não são apagados, mas a referência de origem deles fica vazia.
              Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={deleteBusy}
              onClick={handleDelete}
            >
              {deleteBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
