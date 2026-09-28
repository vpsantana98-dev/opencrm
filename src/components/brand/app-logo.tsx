import type { SVGProps } from "react";

const BRAND_COLOR = "#3b82f6"; // Tailwind blue-500

/** Símbolo OpenCRM */
export function AppSymbol({
  color = BRAND_COLOR,
  ...props
}: SVGProps<SVGSVGElement> & { color?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="OpenCRM"
      {...props}
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

/** Logo completa OpenCRM */
export function AppLogo({
  symbolColor = BRAND_COLOR,
  ...props
}: SVGProps<SVGSVGElement> & { symbolColor?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 120 24"
      fill="none"
      role="img"
      aria-label="OpenCRM"
      {...props}
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" stroke={symbolColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <text x="28" y="17" fill="currentColor" fontSize="16" fontWeight="bold" fontFamily="sans-serif">OpenCRM</text>
    </svg>
  );
}
