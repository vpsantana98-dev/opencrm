'use client';

import { Shield, SlidersHorizontal } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { CustomFieldsPanel } from '@/components/contacts/custom-fields-manager';
import { SettingsChip } from './settings-chip';

/**
 * Settings → Custom Fields card. Manages the account-wide custom
 * contact field catalogue (the same panel the Contacts page exposes
 * via a dialog). Writes are admin-gated by the caller and enforced by
 * `custom_fields` RLS.
 */
export function CustomFieldsSettings() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <SlidersHorizontal className="size-4 text-primary" />
          Campos personalizados
          <SettingsChip variant="admin" className="font-medium">
            <Shield />
            Administrador
          </SettingsChip>
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          Campos extras de contato (ex.: CEP, origem do lead). Eles aparecem em
          todos os contatos e na ação de automação “Update Contact Field”.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <CustomFieldsPanel />
      </CardContent>
    </Card>
  );
}
