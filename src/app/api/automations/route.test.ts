import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Fase 4, Passo 4.1 / 4.7: teste de regressão do isolamento de tenancy.
//
// Antes deste ponto, POST /api/automations resolvia `account_id` lendo
// `profiles.account_id` direto pelo cliente RLS do usuário — e a policy
// `profiles_update` (017_account_sharing.sql) não restringia coluna, então
// o próprio usuário podia trocar esse valor pelo UUID de outra conta antes
// de criar a automação. Como o INSERT usa o cliente service role (ignora
// RLS), isso era escrita cross-tenant completa.
//
// Este arquivo trava que a rota resolve a conta por `getCurrentAccount()`
// (que revalida contra account_members, fail-closed) e que nada vindo do
// corpo da requisição — nem um `account_id` adulterado — é respeitado.
// ---------------------------------------------------------------------------

const insertCalls: Array<Record<string, unknown>> = []

function makeAdminMock() {
  return {
    from: vi.fn((table: string) => {
      if (table === 'automations') {
        return {
          insert: vi.fn((payload: Record<string, unknown>) => {
            insertCalls.push(payload)
            return {
              select: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: { id: 'automation-1', ...payload },
                  error: null,
                })),
              })),
            }
          }),
        }
      }
      throw new Error(`unexpected table in test: ${table}`)
    }),
  }
}

let adminMock = makeAdminMock()

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: vi.fn(() => adminMock),
}))

let requireRoleImpl: () => Promise<{
  userId: string
  accountId: string
}> = async () => ({ userId: 'user-legit', accountId: 'acct-legit' })

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>()
  return {
    ...actual,
    requireRole: vi.fn(() => requireRoleImpl()),
  }
})

const { requireRole } = await import('@/lib/auth/account')
const { POST } = await import('./route')

function postAutomation(body: Record<string, unknown>) {
  const request = new Request('https://app.example.com/api/automations', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return POST(request)
}

describe('POST /api/automations: isolamento de tenancy', () => {
  beforeEach(() => {
    insertCalls.length = 0
    adminMock = makeAdminMock()
    requireRoleImpl = async () => ({ userId: 'user-legit', accountId: 'acct-legit' })
  })

  afterEach(() => {
    vi.mocked(requireRole).mockClear()
  })

  it('cria a automação na conta resolvida por getCurrentAccount(), não em qualquer valor do body', async () => {
    const res = await postAutomation({
      name: 'Boas-vindas',
      trigger_type: 'keyword_match',
      trigger_config: { keywords: ['oi'] },
      // Tentativa de adulteração: mesmo mandando um account_id no body,
      // a rota nunca lê esse campo — só usa o que getCurrentAccount()
      // devolveu.
      account_id: 'acct-attacker',
    })

    expect(res.status).toBe(201)
    expect(requireRole).toHaveBeenCalledWith('agent')
    expect(insertCalls).toHaveLength(1)
    expect(insertCalls[0].account_id).toBe('acct-legit')
    expect(insertCalls[0].account_id).not.toBe('acct-attacker')
    expect(insertCalls[0].user_id).toBe('user-legit')
  })

  it('mesmo com profiles.account_id adulterado (simulado por getCurrentAccount devolvendo a conta real), o INSERT segue a conta revalidada', async () => {
    // getCurrentAccount() já revalida active_account_id contra
    // account_members (fail-closed) — aqui simulamos o caso em que o
    // perfil do usuário aponta para outra conta, mas a resolução fail-
    // closed devolve a conta legítima mesmo assim.
    requireRoleImpl = async () => ({ userId: 'user-legit', accountId: 'acct-legit' })

    await postAutomation({
      name: 'Automação',
      trigger_type: 'keyword_match',
      trigger_config: {},
    })

    expect(insertCalls[0].account_id).toBe('acct-legit')
  })

  it('propaga o erro de getCurrentAccount() (ex.: sessão inválida) sem tentar o INSERT', async () => {
    const { ForbiddenError } = await import('@/lib/auth/account')
    requireRoleImpl = async () => {
      throw new ForbiddenError('Profile is not linked to an account')
    }

    const res = await postAutomation({
      name: 'Automação',
      trigger_type: 'keyword_match',
      trigger_config: {},
    })

    expect(res.status).toBe(403)
    expect(insertCalls).toHaveLength(0)
  })
})
