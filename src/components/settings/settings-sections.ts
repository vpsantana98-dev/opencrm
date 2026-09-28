import {
  Coins,
  FileText,
  KeyRound,
  LayoutGrid,
  Palette,
  PlugZap,
  Shield,
  Tags,
  Target,
  User,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';

/**
 * Settings information architecture for the redesigned page.
 *
 * The flat tab strip became a grouped left rail with a new Overview
 * landing. The URL query param stays `?tab=` (deep-linkable, and it
 * keeps the existing links in sidebar.tsx / header.tsx working) — we
 * just map the old values onto the new sections.
 */
export const SETTINGS_SECTIONS = [
  'overview',
  'profile',
  'security',
  'appearance',
  'whatsapp',
  'meta-ads',
  'templates',
  'fields',
  'deals',
  'members',
  'api',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const DEFAULT_SECTION: SettingsSection = 'overview';

/** Rail grouping. `adminOnly` items are hidden for non-admins. */
export interface SectionMeta {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
  group: 'top' | 'account' | 'workspace';
  /**
   * Some seção que saiu de Configurações mas cujo `?tab=` continua sendo
   * reconhecido, para o redirect achar o destino novo em vez de cair no
   * fallback silencioso da Visão geral. Fica fora do rail, não do enum.
   */
  hidden?: boolean;
}

export const SECTION_META: Record<SettingsSection, SectionMeta> = {
  overview: { id: 'overview', label: 'Visão geral', icon: LayoutGrid, group: 'top' },
  profile: { id: 'profile', label: 'Seu perfil', icon: User, group: 'account' },
  security: { id: 'security', label: 'Login e segurança', icon: Shield, group: 'account' },
  appearance: { id: 'appearance', label: 'Aparência', icon: Palette, group: 'account' },
  whatsapp: { id: 'whatsapp', label: 'WhatsApp', icon: PlugZap, group: 'workspace' },
  'meta-ads': { id: 'meta-ads', label: 'Rastreamento', icon: Target, group: 'workspace' },
  templates: { id: 'templates', label: 'Modelos', icon: FileText, group: 'workspace' },
  fields: { id: 'fields', label: 'Campos e tags', icon: Tags, group: 'workspace' },
  deals: { id: 'deals', label: 'Negócios e moeda', icon: Coins, group: 'workspace' },
  // Virou a página /team (item próprio no menu). Continua no enum só para
  // `resolveSection` reconhecer o link antigo e redirecionar.
  members: { id: 'members', label: 'Membros da equipe', icon: UsersRound, group: 'workspace', hidden: true },
  api: { id: 'api', label: 'Chaves de API', icon: KeyRound, group: 'workspace' },
};

export const RAIL_GROUPS: { label: string | null; group: SectionMeta['group'] }[] = [
  { label: null, group: 'top' },
  { label: 'Conta', group: 'account' },
  { label: 'Espaço de trabalho', group: 'workspace' },
];

function isSection(value: string | null): value is SettingsSection {
  return !!value && (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

/**
 * Resolve a raw `?tab=` value to a section. Legacy tabs from the old
 * flat layout collapse onto their new home (Tags + Custom fields → the
 * merged "Fields & tags" section). Anything unknown falls back to the
 * Overview landing.
 */
export function resolveSection(raw: string | null): SettingsSection {
  if (raw === 'tags' || raw === 'custom-fields') return 'fields';
  if (isSection(raw)) return raw;
  return DEFAULT_SECTION;
}
