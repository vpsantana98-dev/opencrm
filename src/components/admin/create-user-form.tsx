"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Loader2, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface CreatedUser {
  email: string;
  temp_password: string;
}

export function CreateUserForm() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [accountName, setAccountName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState<CreatedUser | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fullName,
          email,
          account_name: accountName,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error || "Não foi possível criar o usuário");
        return;
      }
      setCreated(payload as CreatedUser);
    } catch {
      setError("Não foi possível conectar ao servidor");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!created) return;
    await navigator.clipboard.writeText(
      `E-mail: ${created.email}\nSenha temporária: ${created.temp_password}`,
    );
    setCopied(true);
    toast.success("Credenciais copiadas");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReset = () => {
    setCreated(null);
    setFullName("");
    setEmail("");
    setAccountName("");
  };

  // ----- Pós-criação: a senha aparece UMA vez -----
  if (created) {
    return (
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <Check className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-xl text-foreground">
            Usuário criado
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Envie as credenciais ao cliente. A senha temporária não
            poderá ser vista de novo depois que você sair desta tela.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="rounded-lg border border-border bg-muted p-4 font-mono text-sm text-foreground">
            <p>E-mail: {created.email}</p>
            <p>Senha temporária: {created.temp_password}</p>
          </div>
          <Button
            onClick={handleCopy}
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            Copiar credenciais
          </Button>
          <Button
            variant="outline"
            onClick={handleReset}
            className="w-full border-border text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Criar outro usuário
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ----- Formulário -----
  return (
    <Card className="w-full max-w-md border-border bg-card">
      <CardHeader className="items-center text-center">
        <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
          <UserPlus className="h-6 w-6 text-primary" />
        </div>
        <CardTitle className="text-xl text-foreground">
          Criar usuário
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          O cliente recebe uma senha temporária e precisa trocá-la no
          primeiro login.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="fullName" className="text-muted-foreground">
              Nome completo
            </Label>
            <Input
              id="fullName"
              type="text"
              placeholder="João da Silva"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="email" className="text-muted-foreground">
              E-mail
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="cliente@empresa.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="accountName" className="text-muted-foreground">
              Nome da empresa
            </Label>
            <Input
              id="accountName"
              type="text"
              placeholder="Empresa do cliente"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              required
              className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
            />
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="mt-2 h-10 w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Criando…
              </>
            ) : (
              "Criar usuário"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
