import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/auth/platform-admin";
import { CreateUserForm } from "@/components/admin/create-user-form";

export const metadata: Metadata = {
  title: "Admin | Usuários",
  robots: { index: false, follow: false },
};

// Não-admin (ou deslogado que escapou do middleware) recebe 404,
// não 403 — a existência da área admin não vaza para quem não
// pertence a ela.
export default async function AdminUsuariosPage() {
  try {
    await requirePlatformAdmin();
  } catch {
    notFound();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <CreateUserForm />
    </div>
  );
}
