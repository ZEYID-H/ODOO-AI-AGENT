# AG5A — Full UI Redesign of the AI Assistant Interface

**Status: implemented, tests green, _NOT visually approved_.** This work lives
on the review branch `ag5a-ui-redesign-review` and has **not** been merged to
`main`. Visual sign-off (breakpoint-by-breakpoint screenshots) is still
outstanding — see [§11 Visual-validation limitation](#11-visual-validation-limitation).

Scope: **AG5A only** — the `apps/web` Next.js chat workspace. No Python,
routing, tool, API-contract, Delivery-Management, or AG4 change (see
[§13](#13-phase-boundaries)).

---

## 1. Installed design skills — discovered and used

| Skill | Status | Influence on the implementation |
|---|---|---|
| **`frontend-design`** (plugin: `claude-plugins-official`) | **Used** | Its directive *"where the brief pins a visual direction, follow it exactly"* meant executing the brief's dark-charcoal + emerald direction rather than inventing a new one. Its *"spend boldness in one place, keep everything else disciplined"* became the core rule: **emerald is used only for the primary action, the active conversation, and positive status** — everything else is neutral charcoal, with hierarchy coming from spacing and type. Its *"critique your own work"* pass surfaced the two defects fixed last: caption contrast below WCAG AA, and long-token horizontal overflow. |
| **`ponytail`** (active working mode) | **Used** | Reused the existing Tailwind v4 `@theme` tokens instead of a parallel system; one UI font (Inter) with its own `tabular-nums` feature instead of a second face; rendered structured results as styled Markdown + responsive tables instead of a speculative KPI-card parser. |
| `dataviz`, `ui-styling`, `ui-ux-pro-max`, `design-system`, `artifact-design` | **Discovered, not used** | Oriented toward charts, generated design systems, or standalone artifacts — not applicable to restyling an existing app whose answers are server-rendered Markdown. |
| `superpowers:*` (TDD, verification-before-completion, requesting-code-review) | **Discovered, principle applied** | Tests were updated to accessible roles/labels and a full regression was run; the skills themselves were not invoked as subagents. |

**Dependencies:** added **`lucide-react`** (the brief's named icon preference;
no icon library previously existed to conflict). **Inter** was added via
`next/font` (self-hosted, no runtime network, no new npm dependency). No other
browser/design dependency was installed.

---

## 2. Original UI problems (verified against the real code before editing)

All 15 audited problems were confirmed in source, not assumed:

1. **Two/three competing vertical scroll areas** — `Sidebar` (`overflow-y-auto`), `main` (`overflow-y-auto`), and a nested `ConversationList` (`max-h-64 overflow-y-auto`).
2. **Wide, non-collapsible sidebar** — fixed `w-72`.
3. **Quick Questions duplicated** — the same `QUICK_ACTIONS` array rendered in both `Sidebar` and `EmptyState`.
4. **Near-identical gray boxes** everywhere (`bg-surface-2 border-line`).
5. **Weak visual hierarchy.**
6. **Inconsistent emoji icons** (📊 🚨 🔧 ⚠️ ↑ ✅ ✏️ 🗑️ 🚚 🚪).
7. **Conversation area not visually prioritized.**
8. **Weak composer** — a single-line `<input type="text">` (no multiline at all).
9. **Unclear send button** — a bare `↑` glyph.
10. **Debug-like connection status** — `Checking API…`, `Backend: CONNECTED`, `Access: ✅ Read-Only`, `Tools available: N`.
11. **Repeated branding** — `📊 Odoo BI Assistant` (sidebar) vs `Odoo Business Intelligence Assistant` (top bar).
12. **Oversized suggestion cards** — 8 bordered cards each with a full-width `Ask →` button.
13. **Prototype feel** rather than a polished product.
14. **Inconsistent spacing/typography/contrast.**
15. **Poor mobile/tablet layout.**

Additionally, a **dishonest claim** was removed: the empty state read
*"Every answer is read live from Odoo — nothing shown here is hardcoded."*
while the app runs on bundled demo data (AG4 blocked).

---

## 3. Design direction

Premium, calm, data-oriented BI assistant. Dark charcoal surfaces, a single
restrained **emerald** accent (`#4edea3`, already in the codebase) spent only
on primary action / active state / positive status. Hierarchy from spacing and
typography, not from boxing everything. The conversation is the visual center;
the assistant's answers read as a document, not as a card. Motion is minimal
and always subject to `prefers-reduced-motion`. Reference points (Linear /
Vercel / Notion / modern ChatGPT) informed quality only — nothing was copied.

---

## 4. Files created, modified, and deleted

### Created — components (`apps/web/components/`)
`AssistantMessage.tsx`, `ChatComposer.tsx`, `ConversationSidebar.tsx`,
`DataSourceStatus.tsx`, `EmptyConversation.tsx`, `ErrorMessage.tsx`,
`LoadingMessage.tsx`, `MarkdownMessage.tsx`, `MessageActions.tsx`,
`MessageList.tsx`, `MobileSidebarDrawer.tsx`, `StarterPrompt.tsx`,
`UserMessage.tsx`, `WorkspaceHeader.tsx`

### Created — libraries (`apps/web/lib/`)
`data-source.ts` (honest connection-state resolver), `starterPrompts.ts`
(6 curated prompts mapped to real tools)

### Created — tests (`apps/web/tests/`)
`ChatComposer.test.tsx`, `EmptyConversation.test.tsx`,
`MobileSidebarDrawer.test.tsx`, `data-source.test.ts`

### Modified
- `app/globals.css` — design tokens (`@theme`), focus ring, scrollbars, Markdown/message typography, drawer keyframes, reduced-motion safety net
- `app/layout.tsx` — Inter via `next/font`, `theme-color`
- `app/page.tsx` — landing honesty fix (false "Odoo Connected" badge → "Demo data") + single brand name; emoji → Lucide `Check`
- `components/ConversationList.tsx` — Lucide icons, removed nested scroll, active-state + a11y retained
- `components/DashboardClient.tsx` — rewired orchestrator (collapse + drawer state, retry path, `<main>` landmark); **all data/persistence behavior preserved**
- `lib/history.ts` — added optional `retryQuery` field to `ChatTurn`
- `tests/DashboardClient.test.tsx`, `tests/display.test.tsx` — selectors retargeted to accessible roles/labels (no coverage weakened)
- `.env.local.example` — documented `NEXT_PUBLIC_DATA_BACKEND=mock`
- `package.json`, `package-lock.json` — `lucide-react`

### Deleted (replaced)
`components/ChatInput.tsx`, `components/EmptyState.tsx`,
`components/QuickActionCard.tsx`, `components/ResponseCard.tsx`,
`components/Sidebar.tsx`, `components/TopBar.tsx`, `lib/quickActions.ts`

---

## 5. Design tokens

Centralized in `app/globals.css` under Tailwind v4 `@theme` (dark shipped by
default; every value is a token so a future light theme is a variable swap).

| Token | Value | Role |
|---|---|---|
| `--color-surface` | `#101415` | Base background |
| `--color-panel` | `#0c1011` | Sidebar panel (depth vs. message area) |
| `--color-surface-2` | `#191d1f` | Elevated surface |
| `--color-surface-3` | `#23282a` | Interactive / hover surface |
| `--color-line` | `#2a2e30` | Separators |
| `--color-line-strong` | `#363c3e` | Emphasis borders / scrollbar thumb |
| `--color-ink` | `#e6e9ea` | Primary text |
| `--color-ink-dim` | `#9aa0a3` | Secondary text |
| `--color-ink-faint` | `#7c8285` | Captions/labels (~4.8:1 on surface — WCAG AA) |
| `--color-accent` | `#4edea3` | Emerald accent (primary action / active / positive) |
| `--color-accent-strong` | `#6bead4` | Accent hover |
| `--color-accent-soft` | `#16241f` | Accent background wash (brand mark) |
| `--color-on-accent` | `#052018` | Text on accent surfaces |
| `--color-success` | `#4edea3` | Positive status (aliases accent by intent) |
| `--color-warn` | `#e2a33d` | Warning / demo-data status |
| `--color-danger` | `#ef5b5b` | Error / unavailable status |
| `--color-focus` | `#4edea3` | Focus ring |
| `--radius-lg` / `--radius-xl` | `0.75rem` / `1rem` | Corner radii |

Typography: **Inter** (single UI face) with `tabular-nums` enabled on tables
and numeric contexts — the "data" personality without a second font.

---

## 6. Responsive behavior

- Page root: `h-dvh overflow-hidden` — the page itself never scrolls.
- **Only two scroll regions**, in separate panes: the sidebar's conversation
  history and the message list. No competing nested scrollbars.
- Conversation column capped at `max-w-[880px]` (composer aligned to match).
- Desktop sidebar: collapsible — expanded `w-72`, collapsed `w-16` (icon rail).
- **< md**: sidebar becomes a modal drawer (hamburger trigger in the header).
- Starter prompts: `grid-cols-1` on mobile, `sm:grid-cols-2` on wider screens.
- Overflow guards: `min-w-0` on flex children; Markdown tables and code blocks
  scroll inside their own `overflow-x-auto` container; `overflow-wrap:break-word`
  on message prose and `break-words` on user bubbles (long customer/product
  names and unbroken tokens cannot force page-level horizontal scroll).
- Composer respects `env(safe-area-inset-bottom)` and is a flex sibling (it
  never overlaps the last message).

**Targeted breakpoints (360×800, 390×844, 768×1024, 1024×768, 1440×900) are
enforced structurally but have not yet been visually inspected — see [§11].**

---

## 7. RTL and accessibility behavior

**RTL:** logical CSS properties throughout (`ps/pe`, `ms/me`, `border-s/e`,
`start/end`, `rounded-ee`), `dir="auto"` on every content surface (messages,
composer, conversation titles) so mixed Arabic/English text lays itself out
correctly inside the LTR shell, and the send icon mirrors under RTL
(`rtl:-scale-x-100`). A full-shell RTL locale switch is **not** included —
there is no i18n/locale system in the project and adding one would be
speculative; the layout is RTL-ready via the above.

**Accessibility:**
- Landmarks: `<aside>` (sidebar) with `<nav aria-label="Conversation history">`, `<header>`, `<main>`.
- All interactive elements are real `<button>`/`<a>` (no clickable `div`s); icon-only buttons have `aria-label`s.
- Visible keyboard focus via a single `:focus-visible` ring token.
- Mobile drawer is a modal dialog: focus moves in and is trapped, **Escape** and backdrop-click close it, background scroll is locked, focus returns to the trigger on close.
- `aria-live` regions announce async status (`DataSourceStatus`, `LoadingMessage`).
- Status is conveyed by **text + icon + shape**, never color alone.
- `prefers-reduced-motion` honored per-component (`motion-reduce:`) and by a global safety net.
- Heading hierarchy: workspace `h1` (conversation title) → empty-state `h2`.
- Textarea, copy, and retry actions all carry accessible names.

---

## 8. Data-source honesty behavior

The workspace never advertises a live Odoo connection it does not have. State
is resolved by the pure function `resolveDataSource(status, backend)` in
`lib/data-source.ts`:

| API health | `NEXT_PUBLIC_DATA_BACKEND` | Shown |
|---|---|---|
| checking | any | **Connecting** |
| offline | any | **Service unavailable** |
| online | `mock` (default) | **Demo data** (amber) |
| online | `odoo` | **Connected to Odoo** (emerald) |

- `"Connected to Odoo"` is **only** possible when an operator has explicitly
  set `NEXT_PUBLIC_DATA_BACKEND=odoo` **and** the API is reachable — mock can
  never masquerade as live (unit-tested in `data-source.test.ts`).
- Default is `mock` (bundled demo data), matching the reality that AG4 is blocked.
- The status exposes no endpoint URLs and no credentials; it reads no secrets.
- One location only (the workspace header). The old `"read live from Odoo"`
  empty-state claim and the landing page's `"Odoo Connected"` badge were removed.

---

## 9. Exact test results

| Suite | Command | Result |
|---|---|---|
| Web unit/integration | `npm test` (`apps/web`) | **293 passed** (26 files) |
| Web production build | `npm run build` | **Compiled successfully; TypeScript passed** |
| Routing regression | `python -m pytest tests/routing -q` | **98 passed** |
| Core + API | `python -m pytest tests/ apps/api/tests -q` | **285 passed, 26 skipped** |
| Live Odoo | (part of `tests/`) | **26 skipped** (opt-in; AG4 blocked) |
| Model-assisted eval | `python scripts/run_agent_evaluation.py --fail-on-mismatch` | **Not run — no `OPENAI_API_KEY` in environment.** Not fabricated. Cannot be affected: AG5A changed zero Python files (`git status` for `src/ apps/api/ tests/` is empty), so the frozen 72/72 baseline stands. |

Frozen-surface proof: `git status --short -- src/ apps/api/ tests/ scripts/`
is empty; tag `v0.3-routing-stable` (`d370c76`) untouched.

---

## 10. Component architecture

`DashboardClient` (orchestrator) → `ConversationSidebar` (+`ConversationList`) /
`MobileSidebarDrawer` for navigation; `WorkspaceHeader` (+`DataSourceStatus`);
`EmptyConversation` (+`StarterPrompt`) or `MessageList`
(`UserMessage` / `AssistantMessage` (+`MarkdownMessage`, `MessageActions`) /
`ErrorMessage` / `LoadingMessage`); `ChatComposer`. No new abstraction layer or
custom UI framework — existing project conventions and Tailwind tokens only.

---

## 11. Visual-validation limitation

**This is the outstanding item blocking visual approval.** No Playwright or
browser-automation skill is installed, and (per instruction) none was added, so
**no screenshots and no breakpoint-by-breakpoint visual inspection were
completed**. Validation to date is:

- the production build (no SSR/type errors),
- 293 jsdom tests (behavior, accessible roles/labels, a11y wiring, overflow guards),
- a running-dev-server smoke check (authenticated `/dashboard` returns 200;
  `/dashboard` unauthenticated → 307 `/login`; brand/honesty markers verified
  in served HTML).

Visual correctness at 360×800 / 390×844 / 768×1024 / 1024×768 / 1440×900, the
mobile drawer animation, RTL rendering, and the loading/error states have **not**
been visually confirmed. AG5A must not be considered visually approved until
that inspection is done.

---

## 12. AG4 status

**AG4 (Live Odoo Data Accuracy Validation) remains `BLOCKED — awaiting live
Odoo access`.** AG5A does not change that: the configured instance is still
unreachable, the data backend is demo/mock, and the UI now states this honestly
rather than claiming a live connection.

## 13. Phase boundaries

- **Not modified:** `src/agent/router.py`, routing prompts, tool schemas, tool
  implementations, the Odoo gateway, business calculations, Python provider
  contracts, API output contracts, the AG4 live-validation harness, and
  Delivery Management. Verified: `git status` for `src/ apps/api/ tests/
  scripts/` is empty.
- **Tag `v0.3-routing-stable` not moved.**
- **AG6, AG7, and AG8 were not started.**
