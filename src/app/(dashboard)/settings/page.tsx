'use client';

import { useEffect, useMemo, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { SettingsRail } from '@/components/settings/settings-rail';
import { SettingsOverview } from '@/components/settings/settings-overview';
import { ProfileForm } from '@/components/settings/profile-form';
import { SecurityPanel } from '@/components/settings/security-panel';
import { AppearancePanel } from '@/components/settings/appearance-panel';
import { WhatsAppConfig } from '@/components/settings/whatsapp-config';
import { EvolutionConnect } from '@/components/settings/evolution-connect';
import { MetaAdsConfig } from '@/components/settings/meta-ads-config';
import { GoogleAdsConfig } from '@/components/settings/google-ads-config';
import { ClickUpConnect } from '@/components/settings/clickup-connect';
import { TemplateManager } from '@/components/settings/template-manager';
import { FieldsAndTagsPanel } from '@/components/settings/fields-and-tags-panel';
import { DealsSettings } from '@/components/settings/deals-settings';
import { MembersTab } from '@/components/settings/members-tab';
import { ApiKeysSettings } from '@/components/settings/api-keys-settings';
import {
  resolveSection,
  type SettingsSection,
} from '@/components/settings/settings-sections';

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { defaultCurrency, accountId, isInternal } = useAuth();
  const { mode } = useTheme();

  // The URL (`?tab=`) is the single source of truth for the active
  // section — deep-linkable, and it keeps the existing links in the
  // app sidebar/header working. Legacy tab values (tags, custom-fields)
  // resolve onto their new home; unknown/empty → the Overview landing.
  const section = resolveSection(searchParams.get('tab'));

  // "Membros" saiu de Configurações e virou a página /team (item de menu
  // próprio): gerir quem atende é trabalho do dia a dia, não configuração.
  // O redirect mantém vivo qualquer link/favorito antigo para
  // `/settings?tab=members` em vez de levar a uma aba que não existe mais.
  useEffect(() => {
    if (section === 'members') router.replace('/team');
  }, [section, router]);

  const go = (next: SettingsSection) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`/settings?${params.toString()}`, { scroll: false });
  };

  // Cheap, fetch-free rail hints. The Overview landing carries the
  // full live status/counts; the rail just surfaces the two that are
  // already in context.
  const hints: Partial<Record<SettingsSection, ReactNode>> = useMemo(
    () => ({
      appearance: mode.charAt(0).toUpperCase() + mode.slice(1),
      deals: defaultCurrency,
    }),
    [mode, defaultCurrency],
  );

  const panel: Record<SettingsSection, ReactNode> = {
    overview: <SettingsOverview onSelect={go} />,
    profile: (
      <div className="flex flex-col gap-6">
        <ProfileForm />
        {isInternal ? <ClickUpConnect /> : null}
      </div>
    ),
    security: <SecurityPanel />,
    appearance: <AppearancePanel />,
    whatsapp: (
      <div className="flex flex-col gap-6">
        {/* key por conta ativa: re-monta ao trocar de cliente, para o
            estado de conexão não vazar visualmente entre clientes. */}
        <EvolutionConnect key={accountId ?? "none"} />
        <WhatsAppConfig />
      </div>
    ),
    'meta-ads': (
      <div className="flex flex-col gap-8">
        <MetaAdsConfig key={`meta-${accountId ?? "none"}`} />
        <div className="border-t border-border" />
        <GoogleAdsConfig key={`google-${accountId ?? "none"}`} />
      </div>
    ),
    templates: <TemplateManager />,
    fields: <FieldsAndTagsPanel />,
    deals: <DealsSettings />,
    members: <MembersTab />,
    api: <ApiKeysSettings />,
  };

  return (
    <div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Configurações
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tudo em um só lugar: sua conta e seu espaço de trabalho. Escolha uma
          seção para gerenciá-la.
        </p>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[236px_minmax(0,1fr)] lg:items-start">
        <SettingsRail active={section} onSelect={go} hints={hints} />
        <div className="min-w-0">{panel[section]}</div>
      </div>
    </div>
  );
}
