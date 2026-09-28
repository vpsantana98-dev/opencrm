"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { PresenceHeartbeat } from "@/components/presence/presence-heartbeat";
import { PageTitleSync } from "@/components/layout/page-title-sync";

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const {
    user,
    loading,
    profileLoading,
    isClientLogin,
    accountId,
    signOut,
  } = useAuth();
  const router = useRouter();
  const [portalAllowed, setPortalAllowed] = useState<boolean | null>(null);

  // Sidebar drawer state — only used on mobile. On lg+ the sidebar is
  // always visible and this stays at `false` (ignored by the component).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (profileLoading || !isClientLogin || !accountId) return;
    fetch("/api/account/client-options", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { options?: { portal_enabled?: boolean } } | null) => {
        setPortalAllowed(body?.options?.portal_enabled === true);
      })
      .catch(() => setPortalAllowed(false));
  }, [accountId, isClientLogin, profileLoading]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  if (isClientLogin && (profileLoading || portalAllowed === null)) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (isClientLogin && portalAllowed === false) {
    return (
      <div className="flex h-screen items-center justify-center bg-background p-6">
        <div className="border-border bg-card max-w-md rounded-xl border p-6 text-center">
          <h1 className="text-foreground text-lg font-semibold">
            Portal desabilitado
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            A agência desabilitou temporariamente o acesso desta conta ao
            portal.
          </p>
          <button
            type="button"
            className="bg-primary text-primary-foreground mt-5 rounded-lg px-4 py-2 text-sm font-medium"
            onClick={() => void signOut()}
          >
            Sair
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Reports this tab's online/away presence once we know a user is
          signed in. Headless — renders nothing. */}
      <PresenceHeartbeat />
      {/* Mantem o titulo da aba em sincronia com a pagina. Headless. */}
      <PageTitleSync />
      <Sidebar open={sidebarOpen} onClose={closeSidebar} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header onOpenSidebar={() => setSidebarOpen(true)} />
        {/* Thinner horizontal padding on mobile so cards have room to breathe. */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DashboardShellInner>{children}</DashboardShellInner>
    </AuthProvider>
  );
}
