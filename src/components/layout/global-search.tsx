"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Loader2, MessageSquare, Search, User } from "lucide-react";

import { cn } from "@/lib/utils";

interface SearchHit {
  type: "contact" | "conversation" | "client";
  id: string;
  title: string;
  subtitle?: string;
  href: string;
}

const ICONE = {
  contact: User,
  conversation: MessageSquare,
  client: Building2,
} as const;

const ROTULO_TIPO = {
  contact: "Contato",
  conversation: "Conversa",
  client: "Cliente",
} as const;

/**
 * Busca global do header: contatos, conversas e clientes.
 *
 * Atalho `Ctrl/Cmd + K`. O resultado é uma lista navegável por seta +
 * Enter — quem atende volume não tira a mão do teclado.
 *
 * A busca dispara com debounce de 250ms e a partir de 2 caracteres; a
 * rota `/api/search` corta o resto. Respostas fora de ordem são
 * descartadas por um contador de sequência, senão uma consulta lenta
 * antiga sobrescreveria o resultado da mais recente.
 */
export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [cursor, setCursor] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);

  // Ctrl/Cmd + K foca a busca de qualquer lugar do app.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Fecha ao clicar fora.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setAberto(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    const termo = q.trim();
    if (termo.length < 2) {
      setHits([]);
      setCarregando(false);
      return;
    }
    setCarregando(true);
    const seq = ++seqRef.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(termo)}`, {
          cache: "no-store",
        });
        const body = (await res.json().catch(() => ({}))) as {
          hits?: SearchHit[];
        };
        // Resposta atrasada de uma busca antiga não pode sobrescrever.
        if (seq !== seqRef.current) return;
        setHits(res.ok ? (body.hits ?? []) : []);
        setCursor(0);
      } finally {
        if (seq === seqRef.current) setCarregando(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  const irPara = useCallback(
    (hit: SearchHit) => {
      setAberto(false);
      setQ("");
      setHits([]);
      router.push(hit.href);
    },
    [router],
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setAberto(false);
      inputRef.current?.blur();
      return;
    }
    if (hits.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const alvo = hits[cursor];
      if (alvo) irPara(alvo);
    }
  }

  const mostrarPainel = aberto && q.trim().length >= 2;

  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setAberto(true);
        }}
        onFocus={() => setAberto(true)}
        onKeyDown={onKeyDown}
        placeholder="Buscar contatos, conversas, clientes..."
        aria-label="Busca global"
        className="h-9 w-full rounded-lg border border-border bg-muted/50 pl-9 pr-12 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      />
      {/* Dica do atalho — some assim que o campo tem conteúdo. */}
      {!q && (
        <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:block">
          Ctrl K
        </kbd>
      )}
      {carregando && q.trim().length >= 2 && (
        <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
      )}

      {mostrarPainel && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
          {hits.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              {carregando ? "Buscando..." : "Nada encontrado."}
            </p>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {hits.map((hit, i) => {
                const Icone = ICONE[hit.type];
                return (
                  <li key={`${hit.type}-${hit.id}`}>
                    <button
                      onMouseEnter={() => setCursor(i)}
                      onClick={() => irPara(hit)}
                      className={cn(
                        "flex w-full items-center gap-2.5 px-3 py-2 text-left",
                        i === cursor ? "bg-muted" : "hover:bg-muted/60",
                      )}
                    >
                      <Icone className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-foreground">
                          {hit.title}
                        </span>
                        {hit.subtitle && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {hit.subtitle}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {ROTULO_TIPO[hit.type]}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
