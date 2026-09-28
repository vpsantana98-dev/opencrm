import Link from "next/link";
import { LayoutDashboard } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AppLogo } from "@/components/brand/app-logo";

// 404 com a identidade do app e caminho de volta, no lugar do 404 cru do
// Next. Heurística de Nielsen: ajudar o usuário a se recuperar.
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <AppLogo className="h-9 w-auto" />
      <div>
        <p className="text-4xl font-bold text-foreground">404</p>
        <h1 className="mt-2 text-lg font-semibold text-foreground">
          Página não encontrada
        </h1>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          O endereço que você abriu não existe ou foi movido.
        </p>
      </div>
      <Button render={<Link href="/dashboard" />}>
        <LayoutDashboard className="size-4" />
        Voltar ao início
      </Button>
    </div>
  );
}
