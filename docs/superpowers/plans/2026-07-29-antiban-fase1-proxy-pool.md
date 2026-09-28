# Anti-ban Fase 1: pool de proxies e webhook autenticado

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer cada instância Evolution conectar por um IP de proxy móvel dedicado em vez do IP de datacenter da VPS, com verificação contínua de vazamento, e fechar o webhook da Evolution que hoje está aberto.

**Architecture:** Uma tabela global `proxies` guarda o pool (credenciais cifradas com a mesma AES-256-GCM dos tokens da Meta), com RLS fail-closed. A lógica de seleção fica numa função pura testável (`selectProxy`), separada da camada de dados. O `createInstance()` da Evolution passa a criar a instância sem QR, aplicar o proxy, e só então pedir o QR, porque o handshake de pareamento é o que registra a origem da sessão no WhatsApp. Um cron verifica o IP de saída de cada proxy e derruba do pool quem falhar.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Supabase (Postgres + RLS), Vitest, `undici` (para fetch através de proxy).

## Global Constraints

- Idioma do produto: **Português do Brasil** em toda string visível ao usuário.
- **Sem travessões (`—`) em prosa visível ao usuário.** Use dois-pontos, vírgula ou parênteses.
- Branch de trabalho: `feat/multi-tenant`. As migrations continuam a partir da **039**.
- Esta versão do Next.js tem breaking changes; consulte `node_modules/next/dist/docs/` antes de mexer em roteamento ou cache (ver `AGENTS.md`).
- Migrations são **idempotentes** e aplicadas manualmente por `psql`, cada arquivo em transação única (`-1`). Postgres não tem `CREATE POLICY IF NOT EXISTS`: use `DROP POLICY IF EXISTS` antes de cada `CREATE POLICY`.
- Segredos nunca voltam ao cliente, nem mascarados. Senha de proxy só existe no servidor.
- Testes rodam com `npm run test` (Vitest, ambiente `node`). `ENCRYPTION_KEY` já vem populada pelo `vitest.config.ts` com 64 zeros.
- Spec de referência: `docs/superpowers/specs/2026-07-29-antiban-evolution-design.md`.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/040_proxies.sql` | Tabela `proxies`, `evolution_instances.proxy_id`, RLS fail-closed |
| `src/lib/whatsapp/proxy-select.ts` | **Puro.** `selectProxy`, `extractDdd`, `dddToUf`. Zero I/O |
| `src/lib/whatsapp/proxy-select.test.ts` | Testes do seletor |
| `src/lib/whatsapp/proxy-pool.ts` | Camada de dados: `assignProxy`, `releaseProxy`, `loadProxyConfig` |
| `src/lib/whatsapp/proxy-check.ts` | `checkProxyExitIp` via `undici.ProxyAgent` |
| `src/lib/whatsapp/evolution-api.ts` | **Modificar.** `setProxy`, `createInstance` reordenado |
| `src/app/api/proxies/route.ts` | Listar e criar proxy (owner) |
| `src/app/api/proxies/[id]/route.ts` | Editar e remover proxy (owner) |
| `src/app/api/proxies/health/route.ts` | Cron: verifica IP de saída, marca degraded/disabled |
| `src/app/api/whatsapp/evolution/connect/route.ts` | **Modificar.** Atribui proxy antes do QR |
| `src/app/api/whatsapp/evolution/connect-public/route.ts` | **Modificar.** Idem |
| `src/app/api/whatsapp/evolution/webhook/[secret]/route.ts` | **Mover.** Webhook autenticado por segredo no caminho |

A separação `proxy-select.ts` (puro) de `proxy-pool.ts` (I/O) é deliberada: toda a regra de risco fica testável sem banco, seguindo o padrão que o projeto já usa em `phone-utils.ts`.

---

## Task 1: Confirmar o contrato da Evolution

Nada nas tasks seguintes deve ser escrito sobre suposição. A Evolution v2 mudou o shape do proxy entre versões, e precisamos saber se `/instance/create` com `qrcode: false` realmente adia o início do socket.

**Files:**
- Modify: `docs/superpowers/specs/2026-07-29-antiban-evolution-design.md` (anexar seção "Contrato verificado")

**Interfaces:**
- Consumes: nada
- Produces: os valores confirmados que as Tasks 4 e 5 usam (shape do body de `/proxy/set`, comportamento de `qrcode: false`, versão da Evolution)

- [ ] **Step 1: Obter as credenciais da Evolution**

No Easypanel, projeto `opencrm-supabase`, serviço `app`, aba Ambiente: copiar `EVOLUTION_API_URL` e `EVOLUTION_API_KEY`. Exportar no shell local:

```bash
export EVO_URL="<valor de EVOLUTION_API_URL>"
export EVO_KEY="<valor de EVOLUTION_API_KEY>"
```

- [ ] **Step 2: Confirmar a versão**

```bash
curl -s "$EVO_URL/" -H "apikey: $EVO_KEY"
```

Anotar o campo `version` da resposta.

- [ ] **Step 3: Descobrir o shape aceito por /proxy/set**

Criar uma instância descartável e tentar os dois shapes conhecidos:

```bash
curl -s -X POST "$EVO_URL/instance/create" -H "apikey: $EVO_KEY" \
  -H "Content-Type: application/json" \
  -d '{"instanceName":"probe-proxy","integration":"WHATSAPP-BAILEYS","qrcode":false}'

# Shape A: aninhado
curl -s -X POST "$EVO_URL/proxy/set/probe-proxy" -H "apikey: $EVO_KEY" \
  -H "Content-Type: application/json" \
  -d '{"enabled":true,"proxy":{"host":"1.2.3.4","port":"8080","protocol":"http","username":"u","password":"p"}}'

# Shape B: plano
curl -s -X POST "$EVO_URL/proxy/set/probe-proxy" -H "apikey: $EVO_KEY" \
  -H "Content-Type: application/json" \
  -d '{"enabled":true,"host":"1.2.3.4","port":"8080","protocol":"http","username":"u","password":"p"}'

curl -s "$EVO_URL/proxy/find/probe-proxy" -H "apikey: $EVO_KEY"
```

Anotar qual shape o `find` devolve corretamente. Reparar se `port` é string ou número.

- [ ] **Step 4: Confirmar que qrcode:false adia o socket**

```bash
curl -s "$EVO_URL/instance/connectionState/probe-proxy" -H "apikey: $EVO_KEY"
```

Esperado: `close` ou equivalente, **não** `connecting`. Se vier `connecting`, o socket subiu na criação e a Task 5 precisa de outra ordem (criar, deletar, recriar já com proxy). Anotar o resultado.

- [ ] **Step 5: Limpar a instância de teste**

```bash
curl -s -X DELETE "$EVO_URL/instance/delete/probe-proxy" -H "apikey: $EVO_KEY"
```

- [ ] **Step 6: Registrar as descobertas na spec e commitar**

Anexar ao fim de `docs/superpowers/specs/2026-07-29-antiban-evolution-design.md`:

```markdown
## 12. Contrato verificado da Evolution (Task 1 da fase 1)

- Versão: <versão>
- `POST /proxy/set/{instance}`: shape <A ou B>, `port` como <string ou número>
- `POST /instance/create` com `qrcode: false`: estado resultante <close ou connecting>
- Data da verificação: <data>
```

```bash
git add docs/superpowers/specs/2026-07-29-antiban-evolution-design.md
git commit -m "docs: registra contrato verificado da Evolution para a fase 1 do anti-ban"
```

---

## Task 2: Migration 040 (tabela `proxies`)

**Files:**
- Create: `supabase/migrations/040_proxies.sql`

**Interfaces:**
- Consumes: nada
- Produces: tabela `proxies` e coluna `evolution_instances.proxy_id`, usadas pelas Tasks 4, 6 e 7

- [ ] **Step 1: Escrever a migration**

Criar `supabase/migrations/040_proxies.sql`:

```sql
-- ============================================================
-- 040_proxies.sql — pool de proxies das instâncias Evolution
--
-- Por que existe:
--   A Evolution (Baileys) conecta a partir da NOSSA VPS, então o IP
--   dela é o IP da sessão do número. Hoje todas as instâncias saem
--   pelo mesmo IP de datacenter, que é o padrão mais fácil de o
--   WhatsApp detectar. Esta tabela guarda o pool de proxies móveis
--   que cada instância usa para sair por um IP próprio.
--
-- Escopo: GLOBAL da agência, não por conta. É o que permite ratear
--   3 a 5 instâncias por IP móvel, que é o modelo de custo escolhido.
--
-- Segurança: RLS fail-closed. Ninguém lê esta tabela pelo browser,
--   nem owner. Todo acesso passa por rota server-side com service
--   role. A senha fica cifrada em AES-256-GCM com ENCRYPTION_KEY,
--   igual aos tokens da Meta.
--
-- Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS proxies (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  label                 TEXT NOT NULL,
  kind                  TEXT NOT NULL DEFAULT 'mobile'
                          CHECK (kind IN ('mobile', 'isp', 'residential')),
  protocol              TEXT NOT NULL DEFAULT 'http'
                          CHECK (protocol IN ('http', 'socks5')),
  host                  TEXT NOT NULL,
  port                  INTEGER NOT NULL CHECK (port > 0 AND port <= 65535),
  username              TEXT,
  password_encrypted    TEXT,
  -- 'BR-SP', 'BR-RJ'. Usado para casar o IP com o DDD do número.
  region                TEXT,
  max_instances         INTEGER NOT NULL DEFAULT 4 CHECK (max_instances > 0),
  status                TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'degraded', 'disabled')),
  consecutive_failures  INTEGER NOT NULL DEFAULT 0,
  last_check_at         TIMESTAMPTZ,
  last_exit_ip          TEXT,
  last_latency_ms       INTEGER,
  -- Endpoint de rotação do provedor (proxy móvel), opcional.
  rotate_url            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE proxies ENABLE ROW LEVEL SECURITY;

-- Fail-closed: nenhuma role de cliente (anon/authenticated) enxerga
-- esta tabela. O service role ignora RLS, que é como as rotas
-- server-side acessam.
DROP POLICY IF EXISTS proxies_no_client_access ON proxies;
CREATE POLICY proxies_no_client_access ON proxies
  FOR ALL USING (false) WITH CHECK (false);

DROP TRIGGER IF EXISTS set_updated_at ON proxies;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON proxies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Vínculo instância -> proxy. ON DELETE SET NULL para que remover um
-- proxy do pool não apague a instância do cliente; ela fica órfã e a
-- rota de saúde sinaliza.
ALTER TABLE evolution_instances
  ADD COLUMN IF NOT EXISTS proxy_id UUID REFERENCES proxies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_evolution_instances_proxy
  ON evolution_instances(proxy_id);
```

- [ ] **Step 2: Aplicar contra o banco**

```bash
# na VPS, com o diretório do compose do opencrm-supabase
PGPASS=$(grep '^POSTGRES_PASSWORD=' <dir>/.env | cut -d= -f2-)
docker exec -i -e PGPASSWORD="$PGPASS" opencrm-supabase_opencrm-supabase-db-1 \
  psql -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -1 \
  -f 040_proxies.sql
```

- [ ] **Step 3: Verificar que a RLS é fail-closed**

```sql
-- Como authenticated, deve retornar 0 linhas mesmo com dados na tabela.
SET ROLE authenticated;
SELECT count(*) FROM proxies;
RESET ROLE;
```

Esperado: `0`, e nenhum erro de permissão (a policy filtra, não bloqueia a tabela).

- [ ] **Step 4: Rodar a migration uma segunda vez**

Repetir o Step 2. Esperado: sucesso, sem erro. Confirma a idempotência.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/040_proxies.sql
git commit -m "feat(db): tabela proxies e vinculo com evolution_instances (040)"
```

---

## Task 3: Seletor de proxy (função pura)

Toda a regra de escolha fica aqui, sem I/O, para ser testável como `phone-utils.ts`.

**Files:**
- Create: `src/lib/whatsapp/proxy-select.ts`
- Test: `src/lib/whatsapp/proxy-select.test.ts`

**Interfaces:**
- Consumes: nada
- Produces:
  - `type ProxyStatus = 'active' | 'degraded' | 'disabled'`
  - `interface ProxyCandidate { id: string; region: string | null; maxInstances: number; currentInstances: number; status: ProxyStatus }`
  - `extractDdd(sanitizedPhone: string): string | null`
  - `dddToUf(ddd: string): string | null`
  - `selectProxy(candidates: ProxyCandidate[], opts?: { phone?: string | null }): ProxyCandidate | null`

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/lib/whatsapp/proxy-select.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  dddToUf,
  extractDdd,
  selectProxy,
  type ProxyCandidate,
} from "./proxy-select";

function candidate(over: Partial<ProxyCandidate> = {}): ProxyCandidate {
  return {
    id: "p1",
    region: null,
    maxInstances: 4,
    currentInstances: 0,
    status: "active",
    ...over,
  };
}

describe("extractDdd", () => {
  it("extrai o DDD de um celular brasileiro em E.164 sem o +", () => {
    expect(extractDdd("5511987654321")).toBe("11");
    expect(extractDdd("5571988887777")).toBe("71");
  });

  it("retorna null para número que não é do Brasil", () => {
    expect(extractDdd("14155551212")).toBeNull();
    expect(extractDdd("37063949836")).toBeNull();
  });

  it("retorna null para entrada curta demais ou vazia", () => {
    expect(extractDdd("55")).toBeNull();
    expect(extractDdd("")).toBeNull();
  });
});

describe("dddToUf", () => {
  it("mapeia DDDs conhecidos para a UF", () => {
    expect(dddToUf("11")).toBe("SP");
    expect(dddToUf("21")).toBe("RJ");
    expect(dddToUf("31")).toBe("MG");
    expect(dddToUf("71")).toBe("BA");
    expect(dddToUf("85")).toBe("CE");
  });

  it("retorna null para DDD inexistente", () => {
    expect(dddToUf("00")).toBeNull();
    expect(dddToUf("23")).toBeNull();
  });
});

describe("selectProxy", () => {
  it("retorna null quando não há candidato", () => {
    expect(selectProxy([])).toBeNull();
  });

  it("ignora proxy que não está active", () => {
    const pool = [
      candidate({ id: "degradado", status: "degraded" }),
      candidate({ id: "desligado", status: "disabled" }),
    ];
    expect(selectProxy(pool)).toBeNull();
  });

  it("ignora proxy que já está na capacidade máxima", () => {
    const pool = [candidate({ id: "cheio", maxInstances: 4, currentInstances: 4 })];
    expect(selectProxy(pool)).toBeNull();
  });

  it("escolhe o menos carregado quando não há preferência de região", () => {
    const pool = [
      candidate({ id: "carregado", currentInstances: 3 }),
      candidate({ id: "vazio", currentInstances: 0 }),
      candidate({ id: "meio", currentInstances: 2 }),
    ];
    expect(selectProxy(pool)?.id).toBe("vazio");
  });

  it("prefere o proxy da região do DDD mesmo que esteja mais carregado", () => {
    const pool = [
      candidate({ id: "sp", region: "BR-SP", currentInstances: 3 }),
      candidate({ id: "rj", region: "BR-RJ", currentInstances: 0 }),
    ];
    expect(selectProxy(pool, { phone: "5511987654321" })?.id).toBe("sp");
  });

  it("entre proxies da região certa, escolhe o menos carregado", () => {
    const pool = [
      candidate({ id: "sp-cheio", region: "BR-SP", currentInstances: 3 }),
      candidate({ id: "sp-vazio", region: "BR-SP", currentInstances: 1 }),
    ];
    expect(selectProxy(pool, { phone: "5511987654321" })?.id).toBe("sp-vazio");
  });

  it("cai para o menos carregado quando a região do DDD não tem vaga", () => {
    const pool = [
      candidate({ id: "sp", region: "BR-SP", maxInstances: 2, currentInstances: 2 }),
      candidate({ id: "rj", region: "BR-RJ", currentInstances: 1 }),
    ];
    expect(selectProxy(pool, { phone: "5511987654321" })?.id).toBe("rj");
  });

  it("ignora a preferência de região para número não brasileiro", () => {
    const pool = [
      candidate({ id: "sp", region: "BR-SP", currentInstances: 3 }),
      candidate({ id: "generico", region: null, currentInstances: 0 }),
    ];
    expect(selectProxy(pool, { phone: "14155551212" })?.id).toBe("generico");
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
npm run test -- src/lib/whatsapp/proxy-select.test.ts
```

Esperado: FAIL, com erro de módulo não encontrado (`./proxy-select`).

- [ ] **Step 3: Implementar**

Criar `src/lib/whatsapp/proxy-select.ts`:

```ts
/**
 * Seleção de proxy para uma instância Evolution.
 *
 * Função pura, sem I/O: recebe os candidatos já carregados e devolve
 * o escolhido. A camada de dados vive em `proxy-pool.ts`.
 *
 * Regra, nesta ordem:
 *   1. Proxy `active` com vaga e região casando com o DDD do número.
 *   2. Proxy `active` com vaga, menos carregado.
 *   3. null.
 *
 * O null é significativo: o chamador DEVE falhar em vez de conectar
 * sem proxy. Conectar pelo IP da VPS contamina os outros números que
 * saem por lá.
 */

export type ProxyStatus = "active" | "degraded" | "disabled";

export interface ProxyCandidate {
  id: string;
  /** 'BR-SP', 'BR-RJ'. Null quando o proxy não tem geo definida. */
  region: string | null;
  maxInstances: number;
  currentInstances: number;
  status: ProxyStatus;
}

/**
 * DDD para UF. Cobre os 67 DDDs em uso no Brasil.
 */
const DDD_TO_UF: Record<string, string> = {
  11: "SP", 12: "SP", 13: "SP", 14: "SP", 15: "SP", 16: "SP", 17: "SP",
  18: "SP", 19: "SP",
  21: "RJ", 22: "RJ", 24: "RJ",
  27: "ES", 28: "ES",
  31: "MG", 32: "MG", 33: "MG", 34: "MG", 35: "MG", 37: "MG", 38: "MG",
  41: "PR", 42: "PR", 43: "PR", 44: "PR", 45: "PR", 46: "PR",
  47: "SC", 48: "SC", 49: "SC",
  51: "RS", 53: "RS", 54: "RS", 55: "RS",
  61: "DF",
  62: "GO", 64: "GO",
  63: "TO",
  65: "MT", 66: "MT",
  67: "MS",
  68: "AC",
  69: "RO",
  71: "BA", 73: "BA", 74: "BA", 75: "BA", 77: "BA",
  79: "SE",
  81: "PE", 87: "PE",
  82: "AL",
  83: "PB",
  84: "RN",
  85: "CE", 88: "CE",
  86: "PI", 89: "PI",
  91: "PA", 93: "PA", 94: "PA",
  92: "AM", 97: "AM",
  95: "RR",
  96: "AP",
  98: "MA", 99: "MA",
};

/**
 * Extrai o DDD de um telefone brasileiro já sanitizado (só dígitos,
 * com DDI). Retorna null se não for do Brasil ou for curto demais.
 *
 * O menor celular brasileiro em E.164 tem 12 dígitos (55 + DDD de 2 +
 * 8 do assinante, forma legada sem o 9).
 */
export function extractDdd(sanitizedPhone: string): string | null {
  if (!sanitizedPhone.startsWith("55")) return null;
  if (sanitizedPhone.length < 12) return null;
  return sanitizedPhone.slice(2, 4);
}

export function dddToUf(ddd: string): string | null {
  return DDD_TO_UF[ddd] ?? null;
}

function hasCapacity(p: ProxyCandidate): boolean {
  return p.status === "active" && p.currentInstances < p.maxInstances;
}

function leastLoaded(pool: ProxyCandidate[]): ProxyCandidate | null {
  if (pool.length === 0) return null;
  return pool.reduce((best, p) =>
    p.currentInstances < best.currentInstances ? p : best,
  );
}

export function selectProxy(
  candidates: ProxyCandidate[],
  opts: { phone?: string | null } = {},
): ProxyCandidate | null {
  const available = candidates.filter(hasCapacity);
  if (available.length === 0) return null;

  const ddd = opts.phone ? extractDdd(opts.phone) : null;
  const uf = ddd ? dddToUf(ddd) : null;

  if (uf) {
    const sameRegion = available.filter((p) => p.region === `BR-${uf}`);
    const picked = leastLoaded(sameRegion);
    if (picked) return picked;
  }

  return leastLoaded(available);
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
npm run test -- src/lib/whatsapp/proxy-select.test.ts
```

Esperado: PASS, 14 testes.

- [ ] **Step 5: Rodar typecheck e lint**

```bash
npm run typecheck && npm run lint
```

Esperado: sem erro.

- [ ] **Step 6: Commit**

```bash
git add src/lib/whatsapp/proxy-select.ts src/lib/whatsapp/proxy-select.test.ts
git commit -m "feat(proxy): seletor puro de proxy com preferencia por DDD"
```

---

## Task 4: Camada de dados do pool

**Files:**
- Create: `src/lib/whatsapp/proxy-pool.ts`

**Interfaces:**
- Consumes: `selectProxy`, `ProxyCandidate` (Task 3); `decrypt` de `@/lib/whatsapp/encryption`
- Produces:
  - `interface EvolutionProxyConfig { host: string; port: number; protocol: 'http' | 'socks5'; username: string; password: string }`
  - `class ProxyPoolError extends Error` com `code: string` e `status: number`
  - `assignProxy(db: SupabaseClient, accountId: string, phone?: string | null): Promise<{ proxyId: string; config: EvolutionProxyConfig }>`
  - `releaseProxy(db: SupabaseClient, accountId: string): Promise<void>`
  - `loadProxyConfig(db: SupabaseClient, proxyId: string): Promise<EvolutionProxyConfig>`
  - `const PROXY_SAFE_COLUMNS: string` (colunas de `proxies` seguras para sair do servidor; a Task 6 importa)

- [ ] **Step 1: Implementar**

Criar `src/lib/whatsapp/proxy-pool.ts`:

```ts
/**
 * Camada de dados do pool de proxies.
 *
 * Carrega os candidatos, delega a escolha para `selectProxy` (puro),
 * grava o vínculo e devolve a config decifrada para a Evolution.
 *
 * SERVER-ONLY. Usa o cliente com service role, porque `proxies` tem
 * RLS fail-closed: nenhuma role de cliente enxerga a tabela.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { decrypt } from "@/lib/whatsapp/encryption";
import { selectProxy, type ProxyCandidate } from "@/lib/whatsapp/proxy-select";

export interface EvolutionProxyConfig {
  host: string;
  port: number;
  protocol: "http" | "socks5";
  username: string;
  password: string;
}

/**
 * Colunas de `proxies` seguras para sair do servidor.
 *
 * `password_encrypted` fica de fora de propósito: a senha nunca volta
 * ao cliente, nem mascarada. Vive aqui, e não em cada rota, para que
 * adicionar uma coluna sensível no futuro não exija lembrar de dois
 * lugares.
 */
export const PROXY_SAFE_COLUMNS =
  "id, label, kind, protocol, host, port, username, region, max_instances, status, consecutive_failures, last_check_at, last_exit_ip, last_latency_ms, created_at";

/** Falha tipada com código legível pela rota. */
export class ProxyPoolError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ProxyPoolError";
    this.code = code;
    this.status = status;
  }
}

interface ProxyRow {
  id: string;
  host: string;
  port: number;
  protocol: "http" | "socks5";
  username: string | null;
  password_encrypted: string | null;
  region: string | null;
  max_instances: number;
  status: "active" | "degraded" | "disabled";
}

function toConfig(row: ProxyRow): EvolutionProxyConfig {
  return {
    host: row.host,
    port: row.port,
    protocol: row.protocol,
    username: row.username ?? "",
    password: row.password_encrypted ? decrypt(row.password_encrypted) : "",
  };
}

/**
 * Escolhe um proxy com vaga, grava o vínculo em
 * `evolution_instances.proxy_id` e devolve a config decifrada.
 *
 * Lança ProxyPoolError quando o pool está esgotado. Isso é
 * deliberado: sem proxy livre a instância NÃO deve ser criada. É
 * melhor a agência ver "sem IP disponível" do que um cliente conectar
 * em silêncio pelo IP da VPS.
 */
export async function assignProxy(
  db: SupabaseClient,
  accountId: string,
  phone?: string | null,
): Promise<{ proxyId: string; config: EvolutionProxyConfig }> {
  const { data: rows, error } = await db
    .from("proxies")
    .select(
      "id, host, port, protocol, username, password_encrypted, region, max_instances, status",
    )
    .eq("status", "active");

  if (error) {
    throw new ProxyPoolError(
      "proxy_query_failed",
      `Falha ao consultar o pool de proxies: ${error.message}`,
      500,
    );
  }

  const proxyRows = (rows ?? []) as ProxyRow[];
  if (proxyRows.length === 0) {
    throw new ProxyPoolError(
      "proxy_pool_empty",
      "Nenhum proxy ativo cadastrado. Cadastre um proxy antes de conectar um WhatsApp.",
      503,
    );
  }

  // Carga atual por proxy, contando as instâncias já vinculadas.
  const { data: usage, error: usageError } = await db
    .from("evolution_instances")
    .select("proxy_id")
    .not("proxy_id", "is", null);

  if (usageError) {
    throw new ProxyPoolError(
      "proxy_query_failed",
      `Falha ao contar o uso dos proxies: ${usageError.message}`,
      500,
    );
  }

  const counts = new Map<string, number>();
  for (const row of (usage ?? []) as { proxy_id: string }[]) {
    counts.set(row.proxy_id, (counts.get(row.proxy_id) ?? 0) + 1);
  }

  const candidates: ProxyCandidate[] = proxyRows.map((r) => ({
    id: r.id,
    region: r.region,
    maxInstances: r.max_instances,
    currentInstances: counts.get(r.id) ?? 0,
    status: r.status,
  }));

  const picked = selectProxy(candidates, { phone });
  if (!picked) {
    throw new ProxyPoolError(
      "proxy_pool_exhausted",
      "Todos os proxies estão na capacidade máxima. Adicione mais um IP ao pool antes de conectar este cliente.",
      503,
    );
  }

  const row = proxyRows.find((r) => r.id === picked.id)!;

  const { error: linkError } = await db
    .from("evolution_instances")
    .update({ proxy_id: picked.id })
    .eq("account_id", accountId);

  if (linkError) {
    throw new ProxyPoolError(
      "proxy_link_failed",
      `Falha ao vincular o proxy à instância: ${linkError.message}`,
      500,
    );
  }

  return { proxyId: picked.id, config: toConfig(row) };
}

/** Solta a vaga do proxy. Chamado ao excluir o cliente. */
export async function releaseProxy(
  db: SupabaseClient,
  accountId: string,
): Promise<void> {
  const { error } = await db
    .from("evolution_instances")
    .update({ proxy_id: null })
    .eq("account_id", accountId);
  if (error) {
    console.error("[proxy-pool] releaseProxy falhou:", error.message);
  }
}

/** Config decifrada de um proxy específico, para reaplicar. */
export async function loadProxyConfig(
  db: SupabaseClient,
  proxyId: string,
): Promise<EvolutionProxyConfig> {
  const { data, error } = await db
    .from("proxies")
    .select(
      "id, host, port, protocol, username, password_encrypted, region, max_instances, status",
    )
    .eq("id", proxyId)
    .maybeSingle();

  if (error || !data) {
    throw new ProxyPoolError(
      "proxy_not_found",
      "Proxy não encontrado no pool.",
      404,
    );
  }
  return toConfig(data as ProxyRow);
}
```

- [ ] **Step 2: Rodar typecheck**

```bash
npm run typecheck
```

Esperado: sem erro.

- [ ] **Step 3: Commit**

```bash
git add src/lib/whatsapp/proxy-pool.ts
git commit -m "feat(proxy): camada de dados do pool com atribuicao e liberacao"
```

---

## Task 5: Aplicar o proxy antes do QR

O ponto central da fase. Hoje `createInstance` cria a instância e devolve o QR na mesma chamada; o pareamento sai pelo IP da VPS.

**Files:**
- Modify: `src/lib/whatsapp/evolution-api.ts`
- Modify: `src/app/api/whatsapp/evolution/connect/route.ts`
- Modify: `src/app/api/whatsapp/evolution/connect-public/route.ts`

**Interfaces:**
- Consumes: `EvolutionProxyConfig`, `assignProxy`, `ProxyPoolError` (Task 4)
- Produces:
  - `setProxy(instanceName: string, config: EvolutionProxyConfig): Promise<void>`
  - `createInstance(instanceName: string, webhookUrl: string, proxy: EvolutionProxyConfig): Promise<EvolutionQr>` (assinatura mudou: terceiro parâmetro obrigatório)

- [ ] **Step 1: Adicionar `setProxy` e passar o proxy na criação da instância**

Em `src/lib/whatsapp/evolution-api.ts`, importar o tipo no topo:

```ts
import type { EvolutionProxyConfig } from "@/lib/whatsapp/proxy-pool";
```

Adicionar `setProxy` e substituir `createInstance` por:

```ts
/**
 * Aplica o proxy numa instância que JÁ existe.
 *
 * O corpo é plano (não aninhado sob "proxy") e `port` é STRING, conforme
 * o `ProxyDto` da Evolution. Usado só no caminho em que
 * `/instance/create` devolveu 403 ou 409, ou seja, a instância já
 * existia e portanto não passou pelos campos de proxy da criação.
 */
export async function setProxy(
  instanceName: string,
  config: EvolutionProxyConfig,
): Promise<void> {
  const { ok, status } = await call(`/proxy/set/${instanceName}`, {
    method: "POST",
    body: JSON.stringify({
      enabled: true,
      host: config.host,
      port: String(config.port),
      protocol: config.protocol,
      username: config.username,
      password: config.password,
    }),
  });
  if (!ok) {
    throw new Error(`Evolution setProxy falhou (HTTP ${status})`);
  }
}

/**
 * Cria a instância com o proxy JÁ configurado e devolve o QR.
 *
 * O proxy vai nos campos `proxyHost`/`proxyPort`/etc do próprio
 * `/instance/create`, e não numa chamada separada depois. Isso importa:
 * o handshake de pareamento é o que registra a origem da sessão no
 * WhatsApp, então não pode existir NENHUMA janela em que a instância
 * esteja de pé sem proxy. Passar na criação fecha essa janela por
 * construção, em vez de depender da ordem das chamadas.
 *
 * `qrcode: false` na criação porque o QR vem do `/instance/connect`
 * depois. Mesmo que a Evolution suba o socket na criação, ele sobe já
 * com o proxy aplicado.
 *
 * Quando a instância já existe (403 ou 409), a criação não aplica os
 * campos de proxy, então reaplicamos por `setProxy` antes do QR.
 */
export async function createInstance(
  instanceName: string,
  webhookUrl: string,
  proxy: EvolutionProxyConfig,
): Promise<EvolutionQr> {
  const { ok, status } = await call("/instance/create", {
    method: "POST",
    body: JSON.stringify({
      instanceName,
      integration: "WHATSAPP-BAILEYS",
      qrcode: false,
      // Proxy aplicado na criação: ver o comentário acima.
      proxyHost: proxy.host,
      proxyPort: String(proxy.port),
      proxyProtocol: proxy.protocol,
      proxyUsername: proxy.username,
      proxyPassword: proxy.password,
      webhook: {
        url: webhookUrl,
        byEvents: false,
        base64: true,
        // MESSAGES_UPDATE traz o ACK de entrega, que a camada de saúde
        // da fase 4 usa como principal sinal indireto de bloqueio.
        events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE"],
      },
    }),
  });

  if (ok) {
    return connectInstance(instanceName);
  }

  // 403 / 409 = a instância já existe. A criação não aplicou os campos
  // de proxy, então aplicamos agora, ANTES de pedir o QR.
  if (status === 403 || status === 409) {
    await setProxy(instanceName, proxy);
    return connectInstance(instanceName);
  }

  throw new Error(`Evolution create falhou (HTTP ${status})`);
}
```

- [ ] **Step 2: Atualizar a rota autenticada**

Em `src/app/api/whatsapp/evolution/connect/route.ts`, importar:

```ts
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { assignProxy, ProxyPoolError } from "@/lib/whatsapp/proxy-pool";
```

Substituir o trecho entre o `upsert` da instância e o `createInstance` por:

```ts
    // Telefone do cliente, quando já conhecido, para casar a região do
    // proxy com o DDD. Instância nova ainda não tem: segue sem
    // preferência regional.
    const admin = supabaseAdmin();
    const { data: inst } = await admin
      .from("evolution_instances")
      .select("phone")
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    // Falha explícita se o pool estiver esgotado: NÃO conectar sem
    // proxy. Ver proxy-pool.ts.
    const { config: proxyConfig } = await assignProxy(
      admin,
      ctx.accountId,
      (inst?.phone as string | null) ?? null,
    );

    const qr = await createInstance(instanceName, webhookUrl, proxyConfig);
```

E, no `catch`, tratar o erro do pool antes do genérico:

```ts
  } catch (err) {
    if (err instanceof ProxyPoolError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return toErrorResponse(err);
  }
```

- [ ] **Step 3: Atualizar a rota pública**

Em `src/app/api/whatsapp/evolution/connect-public/route.ts`, importar `assignProxy` e `ProxyPoolError` de `@/lib/whatsapp/proxy-pool`, e substituir a chamada do `createInstance` por:

```ts
    const { config: proxyConfig } = await assignProxy(
      admin,
      inst.account_id as string,
      (inst.phone as string | null) ?? null,
    );

    const qr = await createInstance(
      inst.instance_name as string,
      webhookUrl,
      proxyConfig,
    );
```

Incluir `phone` no `select` dessa rota:

```ts
      .select("account_id, instance_name, phone")
```

E tratar o erro do pool no `catch`, antes do genérico:

```ts
  } catch (err) {
    if (err instanceof ProxyPoolError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[connect-public] error:", err);
    return NextResponse.json({ error: "Erro ao gerar o QR" }, { status: 500 });
  }
```

- [ ] **Step 4: Liberar a vaga ao excluir o cliente**

Em `src/app/api/account/workspaces/[id]/route.ts`, no `DELETE`, chamar `releaseProxy` antes de `deleteInstance`:

```ts
import { releaseProxy } from "@/lib/whatsapp/proxy-pool";

// ...antes de deletar a instância na Evolution:
await releaseProxy(admin, accountId);
```

- [ ] **Step 5: Rodar typecheck, lint e a suíte inteira**

```bash
npm run typecheck && npm run lint && npm run test
```

Esperado: sem erro. A mudança de assinatura do `createInstance` faz o typecheck apontar qualquer chamador esquecido; se apontar, corrigir antes de seguir.

- [ ] **Step 6: Commit**

```bash
git add src/lib/whatsapp/evolution-api.ts \
        src/app/api/whatsapp/evolution/connect/route.ts \
        src/app/api/whatsapp/evolution/connect-public/route.ts \
        src/app/api/account/workspaces/\[id\]/route.ts
git commit -m "feat(proxy): aplica proxy antes de gerar o QR e assina MESSAGES_UPDATE"
```

---

## Task 6: Rotas de gestão do pool

**Files:**
- Create: `src/app/api/proxies/route.ts`
- Create: `src/app/api/proxies/[id]/route.ts`

**Interfaces:**
- Consumes: `requireRole`, `toErrorResponse` de `@/lib/auth/account`; `encrypt` de `@/lib/whatsapp/encryption`; `supabaseAdmin` de `@/lib/automations/admin-client`; `PROXY_SAFE_COLUMNS` de `@/lib/whatsapp/proxy-pool` (Task 4)
- Produces: endpoints REST do pool. Nenhum outro módulo depende deles.

- [ ] **Step 1: Criar a rota de listagem e criação**

Criar `src/app/api/proxies/route.ts`:

```ts
import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { encrypt } from "@/lib/whatsapp/encryption";
import { PROXY_SAFE_COLUMNS } from "@/lib/whatsapp/proxy-pool";

// GET /api/proxies — lista o pool com a carga atual de cada proxy.
export async function GET() {
  try {
    await requireRole("owner");
    const admin = supabaseAdmin();

    const { data: proxies, error } = await admin
      .from("proxies")
      .select(PROXY_SAFE_COLUMNS)
      .order("label");
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const { data: usage } = await admin
      .from("evolution_instances")
      .select("proxy_id")
      .not("proxy_id", "is", null);

    const counts = new Map<string, number>();
    for (const row of (usage ?? []) as { proxy_id: string }[]) {
      counts.set(row.proxy_id, (counts.get(row.proxy_id) ?? 0) + 1);
    }

    return NextResponse.json({
      proxies: (proxies ?? []).map((p) => ({
        ...p,
        current_instances: counts.get(p.id as string) ?? 0,
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/proxies — cadastra um proxy no pool.
export async function POST(request: Request) {
  try {
    await requireRole("owner");
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const label = typeof body.label === "string" ? body.label.trim() : "";
    const host = typeof body.host === "string" ? body.host.trim() : "";
    const port = Number(body.port);

    if (!label || !host || !Number.isInteger(port) || port < 1 || port > 65535) {
      return NextResponse.json(
        { error: "Informe rótulo, host e uma porta entre 1 e 65535." },
        { status: 400 },
      );
    }

    const kind = ["mobile", "isp", "residential"].includes(String(body.kind))
      ? String(body.kind)
      : "mobile";
    const protocol = ["http", "socks5"].includes(String(body.protocol))
      ? String(body.protocol)
      : "http";
    const maxInstances = Number.isInteger(Number(body.max_instances))
      ? Math.max(1, Number(body.max_instances))
      : 4;

    // `selectProxy` compara region com `BR-<UF>`. Um operador que digita
    // só "SP" criaria um proxy que nunca casa com DDD nenhum, e a falha
    // seria silenciosa: o pool continua funcionando, só perde a
    // preferência regional. Normaliza aqui e rejeita o que não encaixa.
    let region: string | null = null;
    if (typeof body.region === "string" && body.region.trim().length > 0) {
      const raw = body.region.trim().toUpperCase();
      const uf = raw.startsWith("BR-") ? raw.slice(3) : raw;
      if (!/^[A-Z]{2}$/.test(uf)) {
        return NextResponse.json(
          { error: "Região deve ser a UF em duas letras, por exemplo SP ou BR-SP." },
          { status: 400 },
        );
      }
      region = `BR-${uf}`;
    }

    const password =
      typeof body.password === "string" && body.password.length > 0
        ? encrypt(body.password)
        : null;

    const { data, error } = await supabaseAdmin()
      .from("proxies")
      .insert({
        label,
        kind,
        protocol,
        host,
        port,
        username: typeof body.username === "string" ? body.username : null,
        password_encrypted: password,
        region,
        max_instances: maxInstances,
        rotate_url: typeof body.rotate_url === "string" ? body.rotate_url : null,
      })
      .select(PROXY_SAFE_COLUMNS)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ proxy: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
```

- [ ] **Step 2: Criar a rota de edição e remoção**

Criar `src/app/api/proxies/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { encrypt } from "@/lib/whatsapp/encryption";
import { PROXY_SAFE_COLUMNS } from "@/lib/whatsapp/proxy-pool";

// PATCH /api/proxies/[id] — atualiza campos do proxy.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireRole("owner");
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const patch: Record<string, unknown> = {};
    if (typeof body.label === "string") patch.label = body.label.trim();
    if (typeof body.host === "string") patch.host = body.host.trim();
    if (Number.isInteger(Number(body.port))) patch.port = Number(body.port);
    if (typeof body.username === "string") patch.username = body.username;
    // Mesma normalização do POST: region tem que sair daqui como
    // `BR-<UF>`, senão a preferência regional do selectProxy nunca casa.
    if (typeof body.region === "string") {
      const raw = body.region.trim().toUpperCase();
      if (raw.length === 0) {
        patch.region = null;
      } else {
        const uf = raw.startsWith("BR-") ? raw.slice(3) : raw;
        if (!/^[A-Z]{2}$/.test(uf)) {
          return NextResponse.json(
            { error: "Região deve ser a UF em duas letras, por exemplo SP ou BR-SP." },
            { status: 400 },
          );
        }
        patch.region = `BR-${uf}`;
      }
    }
    if (Number.isInteger(Number(body.max_instances))) {
      patch.max_instances = Math.max(1, Number(body.max_instances));
    }
    if (["active", "degraded", "disabled"].includes(String(body.status))) {
      patch.status = String(body.status);
      // Reativar zera o contador de falhas, senão a próxima checagem
      // derruba o proxy de novo na primeira falha.
      if (body.status === "active") patch.consecutive_failures = 0;
    }
    // Só cifra quando veio senha nova; string vazia não apaga a atual.
    if (typeof body.password === "string" && body.password.length > 0) {
      patch.password_encrypted = encrypt(body.password);
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "Nenhum campo válido para atualizar." },
        { status: 400 },
      );
    }

    const { data, error } = await supabaseAdmin()
      .from("proxies")
      .update(patch)
      .eq("id", id)
      .select(PROXY_SAFE_COLUMNS)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (!data) {
      return NextResponse.json({ error: "Proxy não encontrado" }, { status: 404 });
    }
    return NextResponse.json({ proxy: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// DELETE /api/proxies/[id] — remove do pool.
// Recusa se ainda houver instância vinculada: soltar o vínculo em
// silêncio faria o cliente reconectar sem proxy na próxima vez.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireRole("owner");
    const { id } = await params;
    const admin = supabaseAdmin();

    const { count } = await admin
      .from("evolution_instances")
      .select("account_id", { count: "exact", head: true })
      .eq("proxy_id", id);

    if ((count ?? 0) > 0) {
      return NextResponse.json(
        {
          error: `Este proxy ainda atende ${count} instância(s). Mova esses clientes para outro proxy antes de remover.`,
        },
        { status: 409 },
      );
    }

    const { error } = await admin.from("proxies").delete().eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
```

- [ ] **Step 3: Rodar typecheck, lint e build**

```bash
npm run typecheck && npm run lint && npm run build
```

Esperado: sem erro. O `build` valida a assinatura de `params` como `Promise`, que é a convenção desta versão do Next.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/proxies
git commit -m "feat(proxy): rotas de gestao do pool restritas a owner"
```

---

## Task 7: Verificação de saúde e vazamento de IP

**Files:**
- Modify: `package.json` (adicionar `undici`)
- Create: `src/lib/whatsapp/proxy-check.ts`
- Create: `src/app/api/proxies/health/route.ts`

**Interfaces:**
- Consumes: `loadProxyConfig`, `EvolutionProxyConfig` (Task 4)
- Produces: `checkProxyExitIp(config: EvolutionProxyConfig, timeoutMs?: number): Promise<{ ok: boolean; exitIp: string | null; latencyMs: number; error?: string }>`

- [ ] **Step 1: Adicionar a dependência**

O `fetch` nativo do Node não aceita proxy sem um dispatcher, e `undici` não está resolvível na raiz hoje.

```bash
npm install undici
```

- [ ] **Step 2: Implementar o verificador**

Criar `src/lib/whatsapp/proxy-check.ts`:

```ts
/**
 * Verificação do IP de saída de um proxy.
 *
 * Serve a dois propósitos:
 *   1. Saúde: o proxy responde e em quanto tempo.
 *   2. Vazamento: o IP de saída tem que ser DIFERENTE do IP da VPS.
 *      Se a Evolution fizer fallback para conexão direta quando um
 *      proxy cai, é aqui que descobrimos, em minutos, em vez de
 *      descobrir quando o número for banido.
 */

import { ProxyAgent } from "undici";

import type { EvolutionProxyConfig } from "@/lib/whatsapp/proxy-pool";

/** Serviço de echo de IP. Texto puro, sem JSON para parsear. */
const ECHO_URL = "https://api.ipify.org";

export interface ProxyCheckResult {
  ok: boolean;
  exitIp: string | null;
  latencyMs: number;
  error?: string;
}

export async function checkProxyExitIp(
  config: EvolutionProxyConfig,
  timeoutMs = 10_000,
): Promise<ProxyCheckResult> {
  const auth =
    config.username || config.password
      ? `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@`
      : "";
  const uri = `${config.protocol === "socks5" ? "socks5" : "http"}://${auth}${config.host}:${config.port}`;

  const started = Date.now();
  const agent = new ProxyAgent({ uri });

  try {
    const res = await fetch(ECHO_URL, {
      // @ts-expect-error dispatcher é extensão do undici, ausente no lib.dom
      dispatcher: agent,
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    const latencyMs = Date.now() - started;

    if (!res.ok) {
      return {
        ok: false,
        exitIp: null,
        latencyMs,
        error: `echo respondeu HTTP ${res.status}`,
      };
    }

    const exitIp = (await res.text()).trim();
    return { ok: exitIp.length > 0, exitIp: exitIp || null, latencyMs };
  } catch (err) {
    return {
      ok: false,
      exitIp: null,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await agent.close().catch(() => {});
  }
}
```

- [ ] **Step 3: Criar a rota de cron**

Criar `src/app/api/proxies/health/route.ts`:

```ts
import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { checkProxyExitIp } from "@/lib/whatsapp/proxy-check";
import { loadProxyConfig } from "@/lib/whatsapp/proxy-pool";

/**
 * Checa cada proxy do pool. Protegida por segredo compartilhado no
 * header `x-cron-secret`, mesmo padrão de /api/automations/cron.
 *
 * Escada de degradação:
 *   3 falhas seguidas  -> degraded  (não recebe instância nova)
 *   10 falhas seguidas -> disabled  (sai do pool)
 * Um sucesso zera o contador e reativa.
 *
 * Vazamento: se o IP de saída for igual ao da VPS, o proxy não está
 * sendo aplicado. Marca disabled na hora, independente do contador.
 */
const DEGRADE_AT = 3;
const DISABLE_AT = 10;

export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "cron not configured" }, { status: 503 });
  }
  if (request.headers.get("x-cron-secret") !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const vpsIp = process.env.VPS_PUBLIC_IP ?? "";
  const admin = supabaseAdmin();

  const { data: proxies, error } = await admin
    .from("proxies")
    .select("id, status, consecutive_failures")
    .neq("status", "disabled");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let checked = 0;
  let leaking = 0;

  for (const row of (proxies ?? []) as {
    id: string;
    status: string;
    consecutive_failures: number;
  }[]) {
    let result;
    try {
      const config = await loadProxyConfig(admin, row.id);
      result = await checkProxyExitIp(config);
    } catch (err) {
      result = {
        ok: false,
        exitIp: null,
        latencyMs: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    checked++;

    // Vazamento: o tráfego está saindo pela VPS, não pelo proxy.
    if (result.ok && vpsIp && result.exitIp === vpsIp) {
      leaking++;
      await admin
        .from("proxies")
        .update({
          status: "disabled",
          last_check_at: new Date().toISOString(),
          last_exit_ip: result.exitIp,
          last_latency_ms: result.latencyMs,
        })
        .eq("id", row.id);
      console.error(
        `[proxies/health] VAZAMENTO: proxy ${row.id} saiu pelo IP da VPS (${result.exitIp}). Desativado.`,
      );
      continue;
    }

    if (result.ok) {
      await admin
        .from("proxies")
        .update({
          status: "active",
          consecutive_failures: 0,
          last_check_at: new Date().toISOString(),
          last_exit_ip: result.exitIp,
          last_latency_ms: result.latencyMs,
        })
        .eq("id", row.id);
      continue;
    }

    const failures = row.consecutive_failures + 1;
    const status =
      failures >= DISABLE_AT
        ? "disabled"
        : failures >= DEGRADE_AT
          ? "degraded"
          : row.status;

    await admin
      .from("proxies")
      .update({
        status,
        consecutive_failures: failures,
        last_check_at: new Date().toISOString(),
        last_latency_ms: result.latencyMs,
      })
      .eq("id", row.id);

    console.warn(
      `[proxies/health] proxy ${row.id} falhou (${failures}x): ${result.error ?? "sem detalhe"}`,
    );
  }

  return NextResponse.json({ checked, leaking });
}
```

- [ ] **Step 4: Documentar a variável de ambiente**

Acrescentar ao fim de `.env.local.example`:

```bash
# IP público da VPS. Usado por /api/proxies/health para detectar
# vazamento: se um proxy responder com este IP, o tráfego não está
# passando por ele, e o proxy é desativado na hora.
# VPS_PUBLIC_IP=31.97.249.95
```

- [ ] **Step 5: Rodar typecheck, lint e build**

```bash
npm run typecheck && npm run lint && npm run build
```

Esperado: sem erro.

- [ ] **Step 6: Testar a rota contra um proxy real**

Cadastrar um proxy pelo `POST /api/proxies`, depois:

```bash
curl -s "https://<host-do-app>/api/proxies/health" -H "x-cron-secret: $AUTOMATION_CRON_SECRET"
```

Esperado: `{"checked":1,"leaking":0}`, e a linha do proxy com `last_exit_ip` preenchido e diferente do IP da VPS.

- [ ] **Step 7: Agendar o cron**

No Easypanel, adicionar um agendamento que chame a rota de 15 em 15 minutos com o header `x-cron-secret`. Registrar o agendamento em `docs/infra.md`, na seção da Evolution.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json .env.local.example \
        src/lib/whatsapp/proxy-check.ts src/app/api/proxies/health \
        docs/infra.md
git commit -m "feat(proxy): checagem de saude e deteccao de vazamento de IP"
```

---

## Task 8: Autenticar o webhook da Evolution

Hoje `POST /api/whatsapp/evolution/webhook` não tem autenticação: qualquer um que descubra a URL injeta mensagem falsa em qualquer conta passando o `instance` no body.

O segredo vai no caminho da URL, e não em header, porque funciona em qualquer versão da Evolution.

**Files:**
- Create: `src/app/api/whatsapp/evolution/webhook/[secret]/route.ts`
- Delete: `src/app/api/whatsapp/evolution/webhook/route.ts`
- Modify: `src/lib/whatsapp/evolution-api.ts` (montagem da URL do webhook fica com quem chama, sem mudança de assinatura)
- Modify: `src/app/api/whatsapp/evolution/connect/route.ts`
- Modify: `src/app/api/whatsapp/evolution/connect-public/route.ts`
- Modify: `src/middleware.ts`

**Interfaces:**
- Consumes: nada das tasks anteriores
- Produces: nenhum símbolo novo. Muda o caminho público do webhook.

- [ ] **Step 1: Mover a rota para o segmento com segredo**

```bash
mkdir -p "src/app/api/whatsapp/evolution/webhook/[secret]"
git mv src/app/api/whatsapp/evolution/webhook/route.ts \
       "src/app/api/whatsapp/evolution/webhook/[secret]/route.ts"
```

- [ ] **Step 2: Validar o segredo na rota**

Em `src/app/api/whatsapp/evolution/webhook/[secret]/route.ts`, trocar a assinatura do `POST` e validar antes de qualquer processamento:

```ts
export async function POST(
  request: Request,
  { params }: { params: Promise<{ secret: string }> },
) {
  const expected = process.env.EVOLUTION_WEBHOOK_SECRET;
  if (!expected) {
    console.error("[evolution/webhook] EVOLUTION_WEBHOOK_SECRET não configurada");
    return NextResponse.json({ ok: true });
  }
  const { secret } = await params;
  if (secret !== expected) {
    // 404 em vez de 401: não confirma que o caminho existe para quem
    // está sondando.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    // ...corpo existente, sem alteração
```

Manter o resto do arquivo como está, incluindo o `return NextResponse.json({ ok: true })` em todos os caminhos de erro, para a Evolution não entrar em loop de retry.

- [ ] **Step 3: Atualizar a montagem da URL nas duas rotas de conexão**

Em `src/app/api/whatsapp/evolution/connect/route.ts` e `connect-public/route.ts`, trocar a linha do `webhookUrl` por:

```ts
    const webhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return NextResponse.json(
        { error: "Webhook da Evolution não configurado no servidor" },
        { status: 503 },
      );
    }
    const webhookUrl = `${proto}://${host}/api/whatsapp/evolution/webhook/${webhookSecret}`;
```

- [ ] **Step 4: Confirmar que o middleware libera o caminho novo**

Este passo é verificação, não alteração. A condição em `src/middleware.ts` usa `includes('/webhook')`:

```ts
if (!user && request.nextUrl.pathname.startsWith('/api/whatsapp/') &&
    !request.nextUrl.pathname.includes('/webhook') &&
    !request.nextUrl.pathname.endsWith('-public')) {
```

O caminho novo, `/api/whatsapp/evolution/webhook/<segredo>`, contém `/webhook`, então continua fora da exigência de sessão. Nenhuma edição é necessária.

Confirmar rodando o teste do middleware:

```bash
npm run test -- src/middleware.test.ts
```

Esperado: PASS. Se falhar, a condição foi alterada por outra task e precisa voltar a liberar o prefixo do webhook.

- [ ] **Step 5: Documentar a variável**

Acrescentar ao `.env.local.example`:

```bash
# Segredo do webhook da Evolution. Vai no CAMINHO da URL registrada na
# instância: /api/whatsapp/evolution/webhook/<segredo>. Sem ele a rota
# aceita qualquer POST e um terceiro consegue injetar mensagem falsa em
# qualquer conta. Gere com:
#   openssl rand -hex 32
# EVOLUTION_WEBHOOK_SECRET=
```

- [ ] **Step 6: Gerar o segredo e setar no Easypanel**

```bash
openssl rand -hex 32
```

Colar em `EVOLUTION_WEBHOOK_SECRET` na aba Ambiente do serviço `app`, e reimplantar.

- [ ] **Step 7: Repontar as instâncias existentes**

As instâncias já criadas têm o webhook antigo gravado na Evolution. Para cada uma, reaplicar:

```bash
curl -s -X POST "$EVO_URL/webhook/set/<instance_name>" -H "apikey: $EVO_KEY" \
  -H "Content-Type: application/json" \
  -d '{"webhook":{"enabled":true,"url":"https://<host>/api/whatsapp/evolution/webhook/<segredo>","byEvents":false,"base64":true,"events":["MESSAGES_UPSERT","MESSAGES_UPDATE","CONNECTION_UPDATE"]}}'
```

Confirmar com `curl -s "$EVO_URL/webhook/find/<instance_name>" -H "apikey: $EVO_KEY"`.

- [ ] **Step 8: Verificar que o caminho antigo morreu**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "https://<host>/api/whatsapp/evolution/webhook" \
  -H "Content-Type: application/json" -d '{"instance":"qualquer"}'
```

Esperado: `404`.

E que o novo funciona: enviar uma mensagem real de um celular para o número conectado e confirmar que aparece na inbox.

- [ ] **Step 9: Rodar a suíte inteira e commitar**

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

```bash
git add -A src/app/api/whatsapp/evolution src/middleware.ts .env.local.example
git commit -m "fix(seguranca): autentica o webhook da Evolution por segredo no caminho"
```

---

## Task 9: Fechar a fase

**Files:**
- Modify: `docs/whatsapp-providers.md`
- Modify: `docs/roadmap.md`

**Interfaces:**
- Consumes: tudo das tasks anteriores
- Produces: nada

- [ ] **Step 1: Verificar o critério de aceite da fase**

Com pelo menos uma instância conectada, rodar:

```bash
curl -s "https://<host>/api/proxies/health" -H "x-cron-secret: $AUTOMATION_CRON_SECRET"
```

Critério: `leaking: 0`, e toda linha de `proxies` com `last_exit_ip` preenchido e diferente do IP da VPS.

Confirmar também na Evolution que a instância está com proxy:

```bash
curl -s "$EVO_URL/proxy/find/<instance_name>" -H "apikey: $EVO_KEY"
```

- [ ] **Step 2: Atualizar a documentação**

Em `docs/whatsapp-providers.md`, na seção "Anti-ban e proxy residencial", trocar "Proxy residencial por instância: ainda NÃO configurado" pelo estado real: pool implementado, tabela `proxies`, atribuição automática com preferência por DDD, checagem de saúde de 15 em 15 minutos e detecção de vazamento.

Em `docs/roadmap.md`, marcar o item 3 da seção "WhatsApp Evolution" como concluído e registrar que as fases 2 a 4 do anti-ban seguem pendentes, com link para a spec.

- [ ] **Step 3: Commit**

```bash
git add docs/whatsapp-providers.md docs/roadmap.md
git commit -m "docs: atualiza estado do anti-ban apos a fase 1"
```

---

## Critério de aceite da Fase 1

1. Nenhuma instância consegue ser criada sem proxy: com o pool vazio, `POST /api/whatsapp/evolution/connect` responde 503 com mensagem legível.
2. `POST /proxy/find/{instance}` na Evolution confirma proxy aplicado em toda instância conectada.
3. `GET /api/proxies/health` responde `leaking: 0` e preenche `last_exit_ip` diferente do IP da VPS.
4. `POST` no caminho antigo do webhook responde 404; o caminho com segredo entrega mensagem na inbox.
5. `npm run typecheck && npm run lint && npm run test && npm run build` passa limpo.

## Fora do escopo desta fase

Fila com throttle, jitter, janela horária, spintax, aquecimento, tetos por número, opt-out, semáforo de saúde e freios automáticos. Tudo isso está nas fases 2 a 4 da spec.

Interface visual para gerenciar o pool: as rotas da Task 6 são a API. A tela em Configurações pode entrar junto da fase 2, ou o pool ser operado por `curl` enquanto forem poucos proxies.
