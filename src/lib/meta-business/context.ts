import { ForbiddenError, type AccountContext } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/auth/admin-client';

export interface AgencyContext {
  agencyAccountId: string;
  agencyOwnerId: string;
}

/** Resolve a conta principal da agencia para dono ou operador interno. */
export async function getAgencyContext(
  ctx: AccountContext
): Promise<AgencyContext> {
  const admin = supabaseAdmin();
  const { data: profile } = await admin
    .from('profiles')
    .select('account_id, agency_owner_id, is_internal')
    .eq('user_id', ctx.userId)
    .maybeSingle();

  if (!profile?.is_internal) {
    throw new ForbiddenError('Recurso exclusivo do time interno da agência');
  }

  const ownerId = (profile.agency_owner_id as string | null) ?? ctx.userId;
  if (!profile.agency_owner_id) {
    return {
      agencyAccountId: profile.account_id as string,
      agencyOwnerId: ownerId,
    };
  }

  const { data: ownerProfile } = await admin
    .from('profiles')
    .select('account_id')
    .eq('user_id', ownerId)
    .maybeSingle();
  if (!ownerProfile?.account_id) {
    throw new ForbiddenError('Conta principal da agência não encontrada');
  }

  return {
    agencyAccountId: ownerProfile.account_id as string,
    agencyOwnerId: ownerId,
  };
}
