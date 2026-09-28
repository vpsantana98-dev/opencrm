import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy, shared service-role client para operações de auth admin
// (criar usuário, limpar app_metadata). Mirrors o padrão de
// src/lib/automations/admin-client.ts.
let _adminClient: SupabaseClient | null = null

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}
