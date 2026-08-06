# Sessions / agents UX — package extraction plan

Plan for the lanes that split this work into packages. The branch sits on top of
`origin/feat/mobile-parity-and-consolidation` (#5691).

---

## Goal

The `/apps`, `/overview`, `/agents`, templates and `/sessions` rework currently sits in
`web/oss`. Extract it so the **decisions** live in packages and the apps only compose, with
the UI layer antd-free so `web/mobile` can adopt it after its release.

The test to hold everything to: **changing a rule** — e.g. "automations replaces the set
rather than adding to it" — **must be one edit in a package that every surface inherits.**
Today that rule lives in `SessionsPage`, and mobile re-derives its own.

## Layering

```
@agenta/shared → @agenta/ui → @agenta/entities → @agenta/sessions → @agenta/sessions-ui
                                                      headless          antd-free
```

`@agenta/entities/session` keeps what it owns: zod schema, `listOptions`, the query itself.
`@agenta/sessions` is new and owns **orchestration**. That boundary is what reconciles this
with the earlier "no new package for entity state" decision.

---

## Lane 1 — `@agenta/ui` primitives + surfaces

Two parts. The second is a move; **the first is new work** and was the surprise from the
lane-0 audit.

### 1a. Missing primitives — RESOLVED: nothing to build

The lane-0 audit predated the rebase onto `feat/mobile-parity-and-consolidation`, which
brought the full shadcn/Radix set into `@agenta/ui/src/components/ui/` (exported via the
`./ui` subpath). `Tooltip`, `DropdownMenu`, and `Switch` all exist, all Radix, antd
mentioned only in skin comments. `EnhancedButton` is antd-free at **runtime** — a facade
over `ui/button` (Radix Slot + cva) and the Radix `ui/tooltip` — so `Button` does not
join the lane either.

`Typography` is not needed — semantic HTML + tokens.

Remaining 1a work is zero; lanes 3–4 import from `@agenta/ui/ui`.

### 1b. Surfaces (move)

`oss/src/components/PanelSection/` → `@agenta/ui`: `PanelSurface`, `PanelScroll`,
`PanelSection`, `PANEL_ACTION_CLASS`. Already antd-free. Drop the THROWAWAY marker — four
pages depend on it.

The `RichChatInput` composer fill (`colorFillTertiary`) was already carried across by the
rebase (`RichChatInput.tsx` uses `bg-[var(--ag-colorFillTertiary)]`) — nothing to do.

**Gotchas to preserve in the move:**
- Sticky headers need an **opaque** background, never a fill token — rows scroll through rgba.
- A scroll container with `padding-top` cannot host a `top-0` sticky child; the sticky element
  supplies its own top spacing. This is documented in the code and must survive extraction.

---

## Lane 2 — `@agenta/sessions` (headless)

**Rule: zero UI imports.** No React components, no antd, no `@agenta/ui`. Hooks and atoms only.
Enforce with an eslint `no-restricted-imports` rule in the package.

### What moves in

From `oss/src/components/pages/sessions/`:

- `state/filters.ts` — the filter atoms **and their semantics**:
  - `sessionShowTriggeredAtom` = **mode** (automations *replace* the set → `origin: "trigger"`)
  - `sessionShowArchivedAtom` = **include** (widens the set)
  - status: `all` / `live` / `waiting`
- `state/pins.ts` — per-project pin storage, `toggleSessionPinAtom`. The module doc already
  notes it's the port for a future server-side implementation; keep that.
- `state/useSessionList.ts` — the infinite query, cursor handling, the `waitingSessionIds`
  pushdown, `excludeOrigin` semantics.
- `assets/sessionRowTitle.ts` (+ its 5 tests), `sessionRowStatus.ts`, `sessionPreview.ts`,
  `sessionTrigger.ts` (`sessionTriggerName`, `sessionTriggerKind`, `isAutomationSession`).

### What gets built here (currently inline in pages)

- **Grouping rules** — pinned vs recent; when a group header is warranted (only when a pinned
  group exists); the label (`Recent` vs `Automation runs` by mode).
- **A row view-model** — a row should reach the UI with nothing left to decide: resolved title,
  status, preview text, agent id/label, relative time, `isAutomation`, `isPinned`.
- **A list hook** that returns groups + paging state, so a page renders and does not derive.

### Public API sketch

```ts
useSessionsList({ agentId?, scope? }) => {
  groups: {key: "pinned" | "recent"; label?: string; rows: SessionRowVm[]}[]
  paging: {hasNext: boolean; isLoadingNext: boolean; loadNext(): void}
  isPending, isError, refetch
}
useSessionFilters() => {status, agentId, search, mode, includeArchived, set*}
useSessionPins()   => {isPinned(id), toggle(id)}
```

**Do not** move: the rail markup, the antd controls, anything that renders.

---

## Lane 3 — `@agenta/sessions-ui` (antd-free)

Depends on lanes 1 + 2. Eslint bans `antd`.

Components: `SessionRow`, `SessionListCard`, the filter **controls** (status list, mode switch,
archived switch, search input), group header, pager, list empty/error/skeleton states.

### Two rules that make this genuinely reusable

1. **Slots for anything not yet portable.** The agent picker stays antd (`EntityPicker` is out
   of the migration's scope), so the filter controls take `agentPicker?: ReactNode` and the app
   injects it. Mobile later injects a sheet. No exceptions to the antd ban, no blocked lane.
2. **Shells stay per-surface.** A 280px rail and a mobile filter sheet are two shells over one
   set of controls. The package exports controls; each app owns its shell. This is why the rail
   markup stays in lane 8.

Affordance note: the kebab and pin are hover-revealed on web. Touch has no hover, so these must
be props/slots rather than baked in, or mobile inherits a dead control.

---

## Lane 4 — `@agenta/entity-ui` agent surfaces

`AgentCard` (both variants), `NewAgentButton`, `NextTriggers`, `UsageSummary`. Same antd ban and
slot technique. `AgentCard`'s avatar colour hashes the **workflow id**, not the name — two agents
share the name "New agent" constantly, and hashing the name gave them the same avatar.

---

## Lanes 5–9 — the apps

`oss/home-overview` → `oss/agents-page` → `oss/templates` (OSS **and** EE routes — a page needs
both files or it 404s in EE) → `oss/sessions-page` → `oss/seed-attachments`.

Gate for each: **no logic in the page.** If a page derives a title, decides a group, or encodes a
filter rule, it belongs in lane 2.

Off the line, against main: `api/session-trigger-stamp`, `entities/trigger-helpers`.

---

## Per-lane verification

- `git diff --name-only <base>..<lane>` contains exactly that lane's files
- `pnpm lint-fix` clean; `pnpm --filter @agenta/oss exec tsc --noEmit` shows no new errors
  (gate on the error-signature diff, not the count — it fluctuates with cache)
- Package lanes: `pnpm turbo run build --filter=@agenta/<pkg>` and their unit tests
- Lanes 1, 3, 4: grep the package for `from "antd"` → must be empty

## Out of scope here

Migrating `mobile/src/features/sessions/` (which today duplicates list logic in
`useSessionListHead` / `useSessionListScrollRestore`) onto these packages. That is its own stack,
**after** mobile's release. It is also the lane that proves the extraction was real — without it
we ship a package and a duplicate side by side.

## Open decisions — RESOLVED

1. **Yes, `EnhancedButton` is antd-free at runtime** (facade over Radix `ui/button` +
   `ui/tooltip`; local antd-compatible prop types, no antd import). Lane 1a is empty — see
   above.
2. **New `@agenta/sessions` package.** The consolidation branch itself created
   `@agenta/chat` as a headless orchestration package, which settles the precedent: the
   earlier "no new package" ruling was about *entity state*, and schema/`listOptions`/query
   stay in `@agenta/entities/session`. Orchestration (filters, grouping, row view-model,
   pins) mirrors `@agenta/chat`'s shape.
3. **`@agenta/entity-ui` under a new `./agent` subpath.** The package already exports
   per-module subpaths (`./variant`, `./workflow`, …), so mobile can import
   `@agenta/entity-ui/agent` without touching the antd modules. The antd ban is enforced by
   eslint on that directory. A separate package would add a workspace unit for four
   components with no distinct dependency profile.
