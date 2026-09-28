"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ImagePlus, Loader2, Send, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  ANEXOS_MAX,
  ANEXO_MAX_BYTES,
  FEEDBACK_KINDS,
  MENSAGEM_MAX,
  MENSAGEM_MIN,
  mimeAceito,
  type FeedbackKind,
} from "@/lib/feedback/format";

const ROTULO: Record<FeedbackKind, string> = {
  problema: "Problema",
  ideia: "Ideia",
  outro: "Outro",
};

interface Anexo {
  nome: string;
  dataUrl: string;
}

/**
 * Coleta o ambiente sem perguntar nada a quem está relatando.
 *
 * É o que separa um chamado investigável de um "não funciona": sem
 * navegador, tela e rota, a primeira resposta de quem for atender vai
 * ser um pedido dessas informações — e a pessoa que reportou já saiu.
 */
function coletarContexto(rota: string) {
  if (typeof window === "undefined") return { rota };
  const ua = navigator.userAgent;

  // Nome + versão a partir do user agent. Ordem importa: Edge e Opera
  // também trazem "Chrome" na string, então precisam ser testados antes.
  const navegador =
    /Edg\/([\d.]+)/.exec(ua)?.[0] ??
    /OPR\/([\d.]+)/.exec(ua)?.[0] ??
    /Firefox\/([\d.]+)/.exec(ua)?.[0] ??
    /Chrome\/([\d.]+)/.exec(ua)?.[0] ??
    /Version\/([\d.]+).*Safari/.exec(ua)?.[0] ??
    ua.slice(0, 80);

  const sistema =
    /Windows NT [\d.]+/.exec(ua)?.[0] ??
    /Mac OS X [\d_]+/.exec(ua)?.[0] ??
    /Android [\d.]+/.exec(ua)?.[0] ??
    /(iPhone|iPad); CPU OS [\d_]+/.exec(ua)?.[0] ??
    /Linux/.exec(ua)?.[0] ??
    "?";

  return {
    rota,
    navegador,
    sistema,
    tela: `${window.screen.width}x${window.screen.height} @${window.devicePixelRatio}x`,
    tema: document.documentElement.dataset.mode ?? null,
    // Último segmento da rota quando parece id — é o "qual registro"
    // que transforma "a tela quebrou" em "esta conversa quebrou".
    recursoId:
      rota
        .split("?")[0]
        .split("/")
        .filter(Boolean)
        .find((s) => /^[0-9a-f]{8}-[0-9a-f]{4}/.test(s) || /^\d{6,}$/.test(s)) ??
      null,
  };
}

export function FeedbackModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [kind, setKind] = useState<FeedbackKind>("problema");
  const [mensagem, setMensagem] = useState("");
  const [anexos, setAnexos] = useState<Anexo[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const adicionarArquivos = useCallback((arquivos: FileList | File[]) => {
    const lista = Array.from(arquivos);
    setAnexos((atuais) => {
      const espaco = ANEXOS_MAX - atuais.length;
      if (espaco <= 0) {
        toast.error(`No máximo ${ANEXOS_MAX} imagens.`);
        return atuais;
      }
      const aceitos: File[] = [];
      for (const f of lista.slice(0, espaco)) {
        if (!mimeAceito(f.type)) {
          toast.error(`"${f.name}" não é uma imagem aceita.`);
          continue;
        }
        if (f.size > ANEXO_MAX_BYTES) {
          toast.error(`"${f.name}" passa de 5 MB.`);
          continue;
        }
        aceitos.push(f);
      }
      // A leitura é assíncrona; cada arquivo entra no estado quando
      // termina, então não dá para devolver tudo pronto daqui.
      for (const f of aceitos) {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = String(reader.result ?? "");
          if (dataUrl) {
            setAnexos((a) =>
              a.length >= ANEXOS_MAX ? a : [...a, { nome: f.name, dataUrl }],
            );
          }
        };
        reader.readAsDataURL(f);
      }
      return atuais;
    });
  }, []);

  // Colar com Ctrl+V. O listener vive só enquanto o modal está aberto —
  // fora dele, capturar `paste` da janela inteira roubaria a colagem de
  // qualquer campo de texto do app.
  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      const arquivos = Array.from(e.clipboardData?.items ?? [])
        .filter((i) => i.kind === "file")
        .map((i) => i.getAsFile())
        .filter((f): f is File => f !== null);
      if (arquivos.length > 0) {
        e.preventDefault();
        adicionarArquivos(arquivos);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [open, adicionarArquivos]);

  async function enviar() {
    const texto = mensagem.trim();
    if (texto.length < MENSAGEM_MIN) {
      toast.error(`Escreva ao menos ${MENSAGEM_MIN} caracteres.`);
      return;
    }
    setEnviando(true);
    try {
      const query = searchParams.toString();
      const rota = query ? `${pathname}?${query}` : pathname;
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          mensagem: texto,
          contexto: coletarContexto(rota),
          anexos,
        }),
      });
      const corpo = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        toast.error(corpo?.error ?? "Não foi possível enviar.");
        return;
      }
      toast.success("Recebemos! Obrigado por avisar.");
      // Limpa só DEPOIS do sucesso: se falhasse, quem escreveu perderia
      // o texto e teria que redigitar tudo.
      setMensagem("");
      setAnexos([]);
      setKind("problema");
      onOpenChange(false);
    } catch {
      toast.error("Não foi possível enviar.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog
      open={open}
      // Trava o fechamento durante o envio: fechar no meio deixaria a
      // pessoa sem saber se o relato foi ou não.
      onOpenChange={(v) => {
        if (enviando) return;
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Enviar feedback</DialogTitle>
          <DialogDescription>
            Achou um erro ou pensou numa melhoria? Escreva aqui — vai direto
            para quem cuida do sistema.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Sobre o que é?
            </span>
            <div className="flex flex-wrap gap-1.5">
              {FEEDBACK_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  aria-pressed={kind === k}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
                    kind === k
                      ? "border-primary/40 bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {ROTULO[k]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="feedback-mensagem"
              className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            >
              Mensagem
            </label>
            <Textarea
              id="feedback-mensagem"
              value={mensagem}
              onChange={(e) => setMensagem(e.target.value.slice(0, MENSAGEM_MAX))}
              placeholder="O que aconteceu, o que você esperava que acontecesse…"
              rows={5}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Enviamos junto o seu nome e a tela em que você está.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Prints (opcional)
            </span>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setArrastando(true);
              }}
              onDragLeave={() => setArrastando(false)}
              onDrop={(e) => {
                e.preventDefault();
                setArrastando(false);
                if (e.dataTransfer.files.length) {
                  adicionarArquivos(e.dataTransfer.files);
                }
              }}
              className={cn(
                "rounded-lg border border-dashed p-4 transition-colors",
                arrastando ? "border-primary bg-primary/5" : "border-border",
              )}
            >
              {anexos.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {anexos.map((a, i) => (
                    <div
                      key={`${a.nome}-${i}`}
                      className="relative size-16 overflow-hidden rounded-md border border-border"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={a.dataUrl}
                        alt={a.nome}
                        className="h-full w-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setAnexos((atual) => atual.filter((_, j) => j !== i))
                        }
                        aria-label={`Remover ${a.nome}`}
                        className="absolute right-0.5 top-0.5 rounded bg-background/80 p-0.5 text-muted-foreground hover:text-foreground"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
                disabled={anexos.length >= ANEXOS_MAX}
              >
                <ImagePlus data-icon="inline-start" />
                Anexar print
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) adicionarArquivos(e.target.files);
                  // Zera para permitir escolher o MESMO arquivo de novo.
                  e.target.value = "";
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Cole com Ctrl+V, arraste para cá ou escolha o arquivo. Até{" "}
              {ANEXOS_MAX}.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={enviar} disabled={enviando}>
            {enviando ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send data-icon="inline-start" />
            )}
            {enviando ? "Enviando…" : "Enviar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
