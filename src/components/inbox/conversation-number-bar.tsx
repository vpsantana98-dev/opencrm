'use client';

import { useEffect, useState } from 'react';
import { Smartphone } from 'lucide-react';

interface NumeroResumo {
  id: string;
  label: string | null;
  phone: string | null;
  isDefault: boolean;
}

interface Props {
  /** Por qual número esta conversa entrou (`conversations.instance_id`). */
  instanceId: string | null;
  /** Some junto com a conversa. */
  visivel: boolean;
}

/**
 * Por qual número esta conversa entrou — e, portanto, por onde a
 * resposta vai sair.
 *
 * Só aparece quando o cliente tem MAIS DE UM número. Com um número só
 * a informação é redundante e vira ruído em cima do chat; com dois, ela
 * é a diferença entre responder pelo Suporte e responder pelo Vendas
 * sem perceber.
 */
export function ConversationNumberBar({ instanceId, visivel }: Props) {
  const [numeros, setNumeros] = useState<NumeroResumo[]>([]);

  useEffect(() => {
    let parar = false;
    // Uma busca por montagem, sem polling: apelido de número muda em
    // Configurações, não no meio de um atendimento.
    void fetch('/api/whatsapp/evolution/instances', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { instances?: NumeroResumo[] } | null) => {
        if (!parar && body?.instances) setNumeros(body.instances);
      })
      .catch(() => {});
    return () => {
      parar = true;
    };
  }, []);

  if (!visivel || numeros.length < 2) return null;

  const daConversa = instanceId
    ? (numeros.find((n) => n.id === instanceId) ?? null)
    : null;
  const padrao = numeros.find((n) => n.isDefault) ?? null;

  // Conversa sem número é a que existia antes deste recurso, ou aquela
  // cujo número foi removido. Dizer o que VAI ACONTECER é mais útil do
  // que dizer que o dado falta: a resposta sai pelo padrão.
  const texto = daConversa
    ? `Conversa do número ${daConversa.label ?? daConversa.phone ?? 'sem nome'}`
    : padrao
      ? `Sem número definido — a resposta sai por ${padrao.label ?? padrao.phone ?? 'o número padrão'}`
      : 'Sem número definido';

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-[#191528] bg-[#080711] px-4 py-1.5">
      <Smartphone className="size-3.5 shrink-0 text-violet-400" aria-hidden />
      <span className="text-muted-foreground truncate text-xs">{texto}</span>
    </div>
  );
}
