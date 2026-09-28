'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Check,
  Loader2,
  MoreVertical,
  Pencil,
  QrCode,
  Star,
  Trash2,
  Unplug,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** Um número, como o /status devolve. */
export interface NumeroWhatsapp {
  id: string;
  label: string | null;
  phone: string | null;
  status: string;
  connected: boolean;
  isDefault: boolean;
}

interface Props {
  numeros: NumeroWhatsapp[];
  /** Id do número cujo QR está aberto, para destacar a linha. */
  conectandoId: string | null;
  /** Pede o QR deste número (reconectar). */
  onReconectar: (id: string) => void;
  /** Alguma coisa mudou no servidor — refaz a busca. */
  onMudou: () => void;
}

/**
 * Como esse número aparece na lista.
 *
 * Preferimos o apelido, porque é o que a equipe realmente usa para
 * pensar ("mandei pelo Suporte"). Sem apelido vai o telefone. E enquanto
 * ele não conectou não temos nem um nem outro — o telefone só é
 * conhecido depois do pareamento —, então cai em "Número sem nome" em
 * vez de mostrar o UUID interno, que não diz nada a ninguém.
 */
function nomeDoNumero(n: NumeroWhatsapp): string {
  if (n.label) return n.label;
  if (n.phone) return n.phone;
  return 'Número sem nome';
}

const ROTULO_STATUS: Record<string, string> = {
  connected: 'No ar',
  connecting: 'Conectando',
  disconnected: 'Fora do ar',
  created: 'Nunca conectado',
};

export function EvolutionNumbers({
  numeros,
  conectandoId,
  onReconectar,
  onMudou,
}: Props) {
  const [renomeando, setRenomeando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aRemover, setARemover] = useState<NumeroWhatsapp | null>(null);
  const [removendo, setRemovendo] = useState(false);

  async function salvarApelido(id: string) {
    setOcupado(id);
    try {
      const res = await fetch(`/api/whatsapp/evolution/instances/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: rascunho }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? 'Não foi possível salvar o apelido');
        return;
      }
      setRenomeando(null);
      onMudou();
    } finally {
      setOcupado(null);
    }
  }

  async function tornarPadrao(id: string) {
    setOcupado(id);
    try {
      const res = await fetch(`/api/whatsapp/evolution/instances/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isDefault: true }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? 'Não foi possível definir o padrão');
        return;
      }
      toast.success('Número padrão alterado');
      onMudou();
    } finally {
      setOcupado(null);
    }
  }

  async function desconectar(id: string) {
    setOcupado(id);
    try {
      const res = await fetch('/api/whatsapp/evolution/disconnect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instanceId: id }),
      });
      if (!res.ok) {
        toast.error('Não foi possível desconectar');
        return;
      }
      toast.success('Número desconectado');
      onMudou();
    } finally {
      setOcupado(null);
    }
  }

  async function remover() {
    if (!aRemover) return;
    setRemovendo(true);
    try {
      const res = await fetch(
        `/api/whatsapp/evolution/instances/${aRemover.id}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? 'Não foi possível remover o número');
        return;
      }
      toast.success('Número removido');
      setARemover(null);
      onMudou();
    } finally {
      setRemovendo(false);
    }
  }

  return (
    <>
      <ul className="divide-border divide-y">
        {numeros.map((n) => {
          const editando = renomeando === n.id;
          return (
            <li
              key={n.id}
              className="flex min-w-0 items-center gap-3 py-3 first:pt-0"
            >
              <span
                className={
                  'size-2 shrink-0 rounded-full ' +
                  (n.connected
                    ? 'bg-emerald-500'
                    : n.status === 'connecting'
                      ? 'bg-amber-500'
                      : 'bg-muted-foreground/40')
                }
                aria-hidden
              />

              <div className="min-w-0 flex-1">
                {editando ? (
                  <div className="flex gap-2">
                    <Input
                      autoFocus
                      value={rascunho}
                      maxLength={40}
                      placeholder="Vendas, Suporte..."
                      onChange={(e) => setRascunho(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void salvarApelido(n.id);
                        if (e.key === 'Escape') setRenomeando(null);
                      }}
                      className="h-8 text-sm"
                    />
                    <Button
                      size="sm"
                      onClick={() => void salvarApelido(n.id)}
                      disabled={ocupado === n.id}
                    >
                      {ocupado === n.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Check className="size-4" />
                      )}
                      Salvar
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="text-foreground truncate text-sm font-medium">
                        {nomeDoNumero(n)}
                      </span>
                      {n.isDefault ? (
                        // O padrão precisa ficar visível na lista: é por
                        // ele que saem as conversas iniciadas pelo CRM, e
                        // sem essa marca ninguém sabe qual é.
                        <Badge variant="outline" className="shrink-0">
                          <Star data-icon="inline-start" />
                          Padrão
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {ROTULO_STATUS[n.status] ?? n.status}
                      {n.label && n.phone ? ` · ${n.phone}` : ''}
                    </p>
                  </>
                )}
              </div>

              {conectandoId === n.id ? (
                <span className="text-muted-foreground flex shrink-0 items-center gap-1.5 text-xs">
                  <Loader2 className="size-3.5 animate-spin" />
                  Aguardando leitura
                </span>
              ) : null}

              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      aria-label={`Ações do número ${nomeDoNumero(n)}`}
                    />
                  }
                >
                  <MoreVertical className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => {
                      setRascunho(n.label ?? '');
                      setRenomeando(n.id);
                    }}
                  >
                    <Pencil className="size-4" />
                    Renomear
                  </DropdownMenuItem>
                  {!n.isDefault ? (
                    <DropdownMenuItem onClick={() => void tornarPadrao(n.id)}>
                      <Star className="size-4" />
                      Tornar padrão
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem onClick={() => onReconectar(n.id)}>
                    <QrCode className="size-4" />
                    {n.connected ? 'Reconectar (novo QR)' : 'Conectar'}
                  </DropdownMenuItem>
                  {n.connected ? (
                    <DropdownMenuItem onClick={() => void desconectar(n.id)}>
                      <Unplug className="size-4" />
                      Desconectar
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => setARemover(n)}
                    className="text-destructive"
                  >
                    <Trash2 className="size-4" />
                    Remover número
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          );
        })}
      </ul>

      <AlertDialog
        open={aRemover !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setARemover(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remover {aRemover ? nomeDoNumero(aRemover) : 'este número'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              A sessão deste número é encerrada e ele sai do CRM. O aparelho
              precisa escanear um QR novo para voltar.
              <br />
              <br />
              {/* Dito explicitamente porque é a primeira pergunta de quem
                  vai clicar — e a resposta é tranquilizadora. */}
              <strong>As conversas continuam aqui.</strong> O histórico não é
              apagado; as respostas dessas conversas passam a sair pelo número
              padrão.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removendo}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={remover}
              disabled={removendo}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removendo ? <Loader2 className="size-4 animate-spin" /> : null}
              Remover número
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
