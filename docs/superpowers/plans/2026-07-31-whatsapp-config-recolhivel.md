# Seção "Conexão do WhatsApp" Recolhível — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar a seção "Conexão do WhatsApp" (API Meta) das configurações em um recolhível fechado por padrão, com selo de status no cabeçalho.

**Architecture:** Recolhível local dentro do próprio `whatsapp-config.tsx`: `useState(false)` + botão-cabeçalho com `aria-expanded`/`aria-controls` e ChevronDown rotacionado. NÃO usar o `Accordion` de `@/components/ui/accordion` para o shell externo — o conteúdo já contém um `Accordion` (passos 1-4 do rail de instruções) e aninhar cascatearia os estilos do `AccordionContent` externo para dentro do rail.

**Tech Stack:** Next.js App Router, React client component, Tailwind, lucide-react.

**Spec:** `docs/superpowers/specs/2026-07-31-whatsapp-config-recolhivel-design.md`

## Global Constraints

- Branch: `feat/whatsapp-config-recolhivel` (base `origin/main`).
- Copy de UI em PT-BR, sem travessão (—) em strings visíveis.
- Selo: verde "Conectado" quando `connectionStatus === 'connected'`; vermelho "Não conectado" caso contrário (`disconnected` E `unknown`); spinner pequeno enquanto `loading`.
- Fechado por padrão em TODA visita — sem persistência (nada de localStorage).
- O fetch da config permanece no mount — NÃO adiar para a abertura.
- Nenhuma mudança em `settings/page.tsx`, `evolution-connect.tsx`, banco ou APIs.
- Baseline de testes desta máquina: exatamente 5 falhas pré-existentes (`src/lib/currency.test.ts` ×3 locale, `src/lib/dashboard/date-utils.test.ts` ×2 timezone) — tratá-las como verde; qualquer falha além delas é problema real.
- Commits: conventional commits PT-BR terminando com linha em branco e `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Recolhível no `whatsapp-config.tsx`

Sem teste unitário (JSX puro; o repo não tem infra de render-test). Portões: typecheck, suíte no baseline, build e greps.

**Files:**
- Modify: `src/components/settings/whatsapp-config.tsx` (estrutura atual: loading early-return nas linhas ~372-384; render principal ~388-856 com `<section>` → `SettingsPanelHead` → grid `lg:grid-cols-[1fr_380px]` contendo coluna do formulário + rail de instruções)

**Interfaces:**
- Consumes: estados já existentes no componente — `loading: boolean`, `connectionStatus: 'connected' | 'disconnected' | 'unknown'` (linha ~53).
- Produces: nada consumido por outras tasks (task única).

- [ ] **Step 1: Ajustar imports**

No bloco de imports do lucide (linhas 5-16), adicionar `ChevronDown`:

```tsx
import {
  Eye,
  EyeOff,
  Copy,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  Zap,
  AlertTriangle,
  RotateCcw,
  ChevronDown,
} from 'lucide-react';
```

Adicionar o util de classes (junto aos imports de `@/`):

```tsx
import { cn } from '@/lib/utils';
```

REMOVER a linha `import { SettingsPanelHead } from './settings-panel-head';` (deixa de ser usado neste arquivo). NÃO mexer no import do `Accordion` — o rail de instruções continua usando.

- [ ] **Step 2: Adicionar o estado do recolhível**

Junto aos outros `useState` (após a linha do `loadedAccountIdRef`, ~62):

```tsx
  // Recolhível da seção: a API da Meta é o caminho secundário de
  // conexão (o principal é o QR Code/Evolution logo acima), então a
  // seção abre fechada em toda visita. Sem persistência de propósito.
  const [expanded, setExpanded] = useState(false);
```

- [ ] **Step 3: Substituir o early-return de loading e o cabeçalho**

3a. APAGAR o bloco inteiro do early-return de loading (linhas ~372-384):

```tsx
  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead ... />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </section>
    );
  }
```

3b. No render principal, substituir o `<SettingsPanelHead ... />` (linhas ~390-393) pelo botão-cabeçalho:

```tsx
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls="whatsapp-config-panel"
        className="group flex w-full items-start justify-between gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        <div className="min-w-0">
          <span className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              Conexão do WhatsApp
            </h2>
            {loading ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : connectionStatus === 'connected' ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400">
                <CheckCircle2 className="size-3" />
                Conectado
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-xs text-red-400">
                <XCircle className="size-3" />
                Não conectado
              </span>
            )}
          </span>
          <p className="mt-1 max-w-[62ch] text-sm text-muted-foreground">
            Conecte sua API do WhatsApp Business da Meta. Credenciais,
            webhook e as etapas de configuração ficam todos aqui.
          </p>
        </div>
        <ChevronDown
          className={cn(
            'mt-1 size-5 shrink-0 text-muted-foreground transition-transform duration-200',
            expanded && 'rotate-180',
          )}
        />
      </button>
```

- [ ] **Step 4: Envolver o conteúdo no painel condicional**

4a. Logo após o `</button>`, abrir o painel condicional e mover o grid existente para dentro (o grid `<div className="grid gap-6 lg:grid-cols-[1fr_380px]">` da linha ~394 até seu fechamento na linha ~853 fica INTACTO por dentro — só muda a indentação se o formatter quiser):

```tsx
      {expanded && (
        <div id="whatsapp-config-panel" className="mt-5">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
              {/* ...todo o conteúdo existente do grid, sem alterações... */}
            </div>
          )}
        </div>
      )}
```

4b. Conferir o fechamento: `</section>` continua sendo o último elemento antes do `);`.

Nota: `loading` continua vindo do fetch no mount (useEffect existente) — NÃO condicionar o fetch ao `expanded`. O spinner do selo (Step 3b) cobre o estado fechado; este spinner interno cobre "abriu antes de carregar".

- [ ] **Step 5: Greps de verificação**

Run (Git Bash):
- `grep -n "SettingsPanelHead" src/components/settings/whatsapp-config.tsx` → 0 ocorrências (exit 1).
- `grep -n "localStorage" src/components/settings/whatsapp-config.tsx` → 0 ocorrências.
- `grep -c "Accordion" src/components/settings/whatsapp-config.tsx` → mesmas ocorrências de antes (import + rail; nenhuma nova).

- [ ] **Step 6: Typecheck + suíte + build**

Run: `npx tsc --noEmit` → limpo.
Run: `npm test` → 740+ passed, exatamente as 5 falhas do baseline.
Run: `npm run build` → sucesso.

- [ ] **Step 7: Commit**

```bash
git add src/components/settings/whatsapp-config.tsx
git commit -m "feat(settings): secao Conexao do WhatsApp recolhivel fechada por padrao"
```

(com a linha em branco + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` no fim da mensagem.)

---

### Verificação manual (humano, após a task)

Com `npm run dev`, em `/settings?section=whatsapp`:

1. Card de QR Code normal; seção Meta aparece só como cabeçalho com seta para baixo e selo (ou spinner enquanto carrega).
2. Clique expande (status, credenciais, webhook, rail); segundo clique recolhe; seta gira.
3. Tab até o cabeçalho + Enter/Espaço alterna; leitor de tela vê `aria-expanded`.
4. F5 → volta fechado.
5. Selo verde quando a Meta está conectada; vermelho caso contrário.
