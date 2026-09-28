'use client';

import { useCallback, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';

export function CopyLinkButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/t/${code}`
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Não foi possível copiar o link');
    }
  }, [code]);

  return (
    <button
      onClick={handleCopy}
      title="Copiar link completo"
      className="flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors hover:bg-muted"
    >
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
        /t/{code}
      </code>
      {copied ? (
        <Check className="h-3.5 w-3.5 text-primary" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
      )}
    </button>
  );
}
