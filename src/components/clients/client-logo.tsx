"use client";

import { cn } from "@/lib/utils";

interface ClientLogoProps {
  name: string;
  logoUrl?: string | null;
  /** Aresta do quadrado, em px. Padrão 32. */
  size?: number;
  className?: string;
}

/**
 * Logo do cliente, com a inicial do nome como reserva.
 *
 * Existe como componente porque a mesma marca aparece em quatro lugares
 * (cards de Clientes, seletor do header, assistente, rodapé da sidebar).
 * Repetir a lógica em cada um garantiria que eles divergissem — um com
 * fallback, outro com imagem quebrada, outro com raio diferente.
 *
 * A inicial fica SEMPRE por baixo e a imagem por cima: se a URL morrer,
 * basta esconder a imagem que a inicial reaparece. Num ternário ela não
 * voltaria, porque só existiria no outro ramo.
 */
export function ClientLogo({
  name,
  logoUrl,
  size = 32,
  className,
}: ClientLogoProps) {
  const inicial = name.trim().charAt(0).toUpperCase() || "?";

  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary/10 font-semibold text-primary",
        className,
      )}
      style={{
        width: size,
        height: size,
        // A inicial acompanha o tamanho da caixa em vez de usar degraus
        // fixos de tipografia: o mesmo componente serve de 24px a 64px.
        fontSize: Math.max(11, Math.round(size * 0.4)),
      }}
      // Decorativo: o nome do cliente sempre aparece escrito ao lado.
      // Anunciar a inicial de novo só faria o leitor de tela repetir.
      aria-hidden
    >
      <span>{inicial}</span>
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      ) : null}
    </div>
  );
}
