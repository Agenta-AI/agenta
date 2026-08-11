# Observability → packages, antd-free, mobile parity

> **Status:** plan only — nothing built. Written 2026-08-11 in the `sessions-ux` worktree
> (HEAD was `be2548e35a` when measuring; the worktree has advanced since). Every number
> below was measured from the tree, not estimated — **re-run §9 before starting.**
> **Not yet decided:** the observability session row (WP5) and the `useEvaluatorReference`
> subtree (WP3) — both flagged inline, both need an answer before their WP starts.
> **To execute this plan, start from `KICKOFF.md` in this directory.**
> **WP0–WP3 are done** (empty states deferred within WP3 — see below) (§9 re-verified on `079bc20be4`; all numbers reproduced). Corrections it
> found are folded in below and listed in the table at the end of §9.

**Goal.** Mobile has no observability surface. Close that gap the way sessions was closed
(PR stack #5766–#5776): extract the OSS page into `@agenta/observability` (state) +
`@agenta/observability-ui` (antd-free presentation), rewire OSS/EE onto the extracted
pieces with **zero functional loss**, then compose the mobile surface from the same pieces.

Extraction rule applies throughout: **port from OSS, never hand-roll a second version**
(`feedback_extract_never_duplicate`). Every component below is an OSS component moved onto
plain elements + semantic tokens — not a rewrite. Where no OSS original exists, the plan
says so explicitly rather than inventing one.

**Start here:** WP0 (§3) is small, mechanical, has no open questions, and unblocks
everything above it.

---

## 1. Landscape

### What exists in OSS today

| Area | Path | LOC | Notes |
| --- | --- | --- | --- |
| Page shell | `oss/src/components/pages/observability/index.tsx` | 120 | Tabs (Traces / Sessions), `PageLayout`, `SetupTracingModal`, evaluator-kind gating of the Sessions tab |
| Traces table | `.../components/ObservabilityTable/index.tsx` | 330 | `InfiniteVirtualTableFeatureShell`, url `trace`/`span` params, auto-refresh, row selection, testset drawer |
| Sessions table | `.../components/SessionsTable/**` | 619 | Same shell + `SessionStoreProvider` (isolated-store workaround) + 10 lazy per-session cells |
| Toolbar | `.../components/ObservabilityHeader/index.tsx` | 743 | Search, Filters, Sort, auto-refresh, Root/LLM/All, CSV export w/ adaptive pacing, delete, add-to-testset, add-to-queue, add-all-matching |
| Cells | `.../components/*.tsx` | 247 | Node name, status, cost, duration, usage, timestamp, evaluator metrics, avatar tree |
| Columns + filters | `.../assets/**` | 1846 | `getObservabilityColumns`, `getFilterColumns`, `constants.ts` (770 — **two unrelated exports**, see WP2), and the filter engine (`fieldAdapter`, `operatorRegistry`, `rulesEngine`, `valueCodec`, `referenceUtils`, `attributeKeyOptions` — 567 LOC, **verified zero React imports**) |
| Dashboard | `.../dashboard/*` | 401 | `AnalyticsDashboard`, `CustomAreaChart`, `widgetCard` — rendered by `pages/overview/observability`, **not** by the observability page |
| State | `oss/src/state/newObservability/**` | 2550 | `controls` 408, `queries` 649, `queryHelpers` 423, `selectors/tracing`, `etl/*`, `hooks/{index,useSessions}` |

Routes: `oss/src/pages/w/[workspace_id]/p/[project_id]/observability/index.tsx` →
`ObservabilityTabs`. EE re-exports the OSS page verbatim. **No EE divergence to preserve.**

### What is already packaged

- `@agenta/entities/trace` — api / core schema+types / etl (`exportMatchingTraces`,
  adaptive pacing) / molecule state. `TraceSpanNode` already lives here; OSS's
  `services/tracing/types` is a 13-line extension adding `annotations?`.
- `@agenta/observability` — 384 LOC, **dashboard analytics only** (`AnalyticsRange`,
  `analyticsToDashboard`, `fetchDashboardAnalytics`, `observabilityRangeAtom`,
  `useObservabilityDashboard`). Already a mobile dependency (Home usage strip via
  `@agenta/home-ui/UsageCard`).
- `@agenta/ui/cell-renderers` — `SmartCellContent`, `LastInputMessageCell`,
  `EvaluatorMetricBar`, `JsonCellContent`. Only `CellContentPopover` touches antd.
- `@agenta/ui/components/presentational` — antd-free (`EnhancedButton`, etc.).

### Mobile today

antd-free: Tailwind v4, `radix-ui`, shadcn registry, `lucide-react`, `motion`,
Vercel AI Elements. Already depends on `@agenta/observability`, `@agenta/sessions-ui`,
`@agenta/navigation`, `@agenta/ui`. Nav (`features/nav/useMobileNavItems.tsx`) has Home +
Sessions; **no observability entry**. Routes live at
`mobile/src/pages/w/[workspace_id]/p/[project_id]/…`, features at `src/features/<name>/`
with a `states/` folder (see the `mobile-app-structure` skill).

### The four blockers

**B1 — the virtual table is antd-bound.** `@agenta/ui/table` (`InfiniteVirtualTable`,
13,295 LOC) renders through antd `Table`. Full measurements and the eventual port are in
§8 — the short version is that it is *far* less antd than its size suggests, but its blast
radius (82 consumers) is far wider than observability.

> **Decision:** do not port the table *in this stack*. It stays the desktop shell. What
> crosses the boundary is state and cells — the cells are the single source of formatting,
> the layout around them is each host's. Mobile stacks them vertically instead of gridding
> them. The port is real and eventually mandatory; it is scheduled separately (§8).
>
> Caveat on the analogy: this resembles the sessions split (`SessionsTable` on desktop vs
> `SessionCardList` in `@agenta/sessions-ui`), but sessions had a *designed card* on desktop
> Home to extract. Observability has no card for either tab — see WP5. The reusable part
> here is smaller and honest about it.

**B2 — the filter dialog is 1,996 LOC of antd** (`oss/src/components/Filters/Filters.tsx`,
plus `Sort.tsx` 334). But the *decision logic* is already isolated and pure in
`observability/assets/filters/**` (567 LOC, zero React).

> **Decision:** package the engine, leave the antd dialog on desktop, give mobile a sheet
> built on the same engine (mirrors `SessionFiltersPanel` / `SessionFiltersBar`).

**B3 — state is welded to OSS.** `state/newObservability` imports 15 OSS modules
(annotations transformer + service, `observability_helpers`, `selectedAppIdAtom`,
`getOrgValues`, `projectIdAtom`, `currentWorkflowContextAtom`, `sessionExistsAtom`,
`Filter`/`SortResult` types, `TestsetTraceData`, onboarding atoms). Each needs a
resolution before the atoms can move (§3, WP1 table) — though two of them turn out to need
no work at all once read (§3 WP0).

**B4 — the trace drawer is 5,819 LOC / 21 antd files.** Mobile needs *a* trace detail, not
that drawer.

> **Decision:** phase-gate it. WP1–WP6 ship the list surfaces. Its most reusable piece —
> `TraceTree`'s span row — comes out early in WP5 because it doubles as the mobile trace
> row; the rest (`TraceContent/OverviewTabItem`, `AccordionTreePanel`) waits for WP7 and
> reuses `@agenta/ui/drill-in`.

---

## 2. Target architecture

```text
@agenta/shared        pure utils, projectIdAtom
   ↑
@agenta/entities      trace (api/core/etl), annotation, session, workflow, organization
   ↑
@agenta/observability  ← GROWS: controls, queries, queryHelpers, selectors, etl,
   ↑                     useObservability / useSessions, filter engine, core types
@agenta/observability-ui ← NEW: antd-free cells, toolbar controls, empty states,
   ↑                        the extracted compact TraceRow, ObservabilityList shell
   ├── web/oss + web/ee   desktop shell: InfiniteVirtualTable + antd Filters/Sort dialogs,
   │                      column defs bind packaged cells
   └── web/mobile         features/observability: stacked-cell list + filter sheet + detail
```

Hierarchy rule (`agenta-package-practices`): `shared ← ui ← entities ← entity-ui ←
observability ← observability-ui`. `observability-ui` may import `@agenta/ui` subpaths and
`@agenta/observability`; **antd and the `@agenta/ui` root barrel are eslint-banned there**,
same config as `@agenta/sessions-ui`.

### The antd → plain-element map (23 import sites)

| antd | Replacement | Where it already exists |
| --- | --- | --- |
| `Typography.Text` (5×) | `<span>` + `text-xs text-colorTextSecondary` | sessions-ui rows |
| `Skeleton` (8×, session cells) | `SkeletonBlock` | `@agenta/navigation-ui/SidebarSkeletonLoader` |
| `Tag` (3×) | `Chip` — plain `<span>` w/ token bg/border | port from `SessionStatusIcon` styling |
| `Tooltip` (2×) | Radix tooltip | `@agenta/navigation-ui` NavMenu flyouts |
| `Space` (3×) | `flex gap-*` | — |
| `Avatar` (1×) | initials `<div>` | — |
| `Switch` (auto-refresh) | shadcn/Radix switch | mobile `components/ui` |
| `Radio.Group` (Root/LLM/All, realtime) | segmented control on plain buttons | port; note `reference_antd_segmented_icon_centering` |
| `Input.Search` | `<input>` + clear button | `SessionSearchControl` in sessions-ui |
| `Button` (export/delete) | `EnhancedButton` | `@agenta/ui/components/presentational` |
| `Spin` / `Tabs` (dashboard) | spinner div / packaged tab strip | `SessionTabStrip` |

None of these is a redesign. Desktop pixel parity in both themes is the acceptance gate.

---

## 3. Work packages

Each WP = one PR, stacked linearly in dependency order, each PR based on the one below
(see the GitButler section of `AGENTS.md` — a fan-out is expressed through PR bases).

### WP0 — entity-layer prep (no behavior change)

Move the OSS modules the observability atoms depend on down into `@agenta/entities`.

> **Corrected — there are no re-export shims.** `web/eslint.config.mjs` bans
> `export … from "@agenta/*"` in `oss/src/**` and `ee/src/**` (`no-restricted-syntax`, for
> tree-shaking). Every WP in this stack must therefore **rewrite the call sites** to import
> from the package and delete the old OSS module, rather than leaving a shim behind. WP0
> rewrote 30 import sites across 25 files. Budget for this in every later WP — the plan's
> "nothing else in OSS moves in this PR" framing does not hold.

- `lib/hooks/useAnnotations/{types,assets/{helpers,transformer}}` + `queryAllAnnotations`
  → **`@agenta/entities/annotation/dto`** (a new subpath, not the `annotation` barrel).
  *Corrected:* the barrel already exports `createAnnotation`, `fetchAnnotation`,
  `updateAnnotation`, `deleteAnnotation` and `AnnotationsResponse` for its zod-validated
  entity API — five collisions with the DTO-shaped OSS versions. The DTO module keeps its
  own subpath; `AnnotationsResponse` is renamed `AnnotationsResponseDto`. The four CRUD
  functions in `services/annotations/api` stay in OSS: they collide, and nothing in the
  observability atoms uses them.
- `lib/traces/observability_helpers` → **only `getNodeById`** moves, to
  `@agenta/entities/trace/utils/nodeTree.ts` (generic over the node type, so callers keep
  their own span shape). *Corrected:* `observabilityTransformer` and `buildNodeTree` are not
  "private-ish neighbours" — the former has four OSS call sites, and both are typed against
  `AgentaNodeDTO`/`AgentaTreeDTO`/`_AgentaRootsResponse` (149 LOC of legacy DTOs in
  `services/observability/types`) that have no place in the entity layer. They stay in OSS.
  Note `trace/utils/selectors.ts` already exists and exports a *different* set (path
  extraction, `extractInputs/Outputs`, testset mapping) — no name collisions.
- `lib/helpers/utils → sanitizeDataWithBlobUrls` → `@agenta/shared/utils`. Pure; needed by
  `FirstInputCell` / `LastOutputCell` / `getObservabilityColumns` in WP3.
- **Workspace members** for annotation author attribution. `queries.ts:159` reads
  `getOrgValues().selectedOrg?.default_workspace?.members` and passes it to
  `transformApiData({data, members})`. `transformApiData` **already takes `members` as a
  parameter**, so no logic moves — the package needs a `workspaceMembersAtom` seam that the
  host binds (WP1 table). `@agenta/entities/organization` has the `WorkspaceMember` type and
  the members API but no atom, so the seam is the right shape, not a selector import.

> **Not a WP0 item (corrected):** `sessionExistsAtom` needs no move. Despite the name it is
> the **auth**-session atom ("is the user signed in"), and `oss/src/state/session/atoms.ts:14`
> is already a bare re-export of `sessionAtom` from `@agenta/shared/state`. The package
> imports `sessionAtom` from `@agenta/shared/state` directly. Do **not** route it into
> `@agenta/entities/session` — that package is the *agent*-session entity and the two are
> unrelated.

**Gate:** OSS `tsc` 0 new errors; entity package builds + tests; no import-graph cycles.

### WP1 — `@agenta/observability` grows into the full state layer

Move `state/newObservability/**` into the package. OSS paths become re-export shims so
nothing else in OSS moves in this PR.

New package layout:

```text
src/core/     types.ts (Filter, FilterConditions, SortResult, TraceTabTypes,
              ObservabilityTabInfo), constants.ts, analytics.ts, presets.ts
src/api/      dashboard.ts (existing), queryHelpers.ts (buildTraceQueryParams,
              executeTraceQuery, mergeConditions)
src/etl/      adaptiveTracePageFetcher, adaptiveExportPacing, exportWriter,
              withRateLimitRetry
src/state/    controls.ts, queries.ts, selectors.ts, dashboard (existing)
src/hooks/    useObservability.ts, useSessions.ts, useObservabilityDashboard (existing)
```

**Host seams** (the whole point — mobile has no `selectedAppIdAtom`, no workflow context):

| OSS dep | Seam in the package | OSS binds | Mobile binds |
| --- | --- | --- | --- |
| `projectIdAtom` | `@agenta/shared/state` — already shared | existing provider | `useBindProjectContext` (exists) |
| `selectedAppIdAtom` **and** `routerAppIdAtom` | `observabilityScopeAtom: {appId, routeAppId}` — *corrected:* these are two different atoms (`selectedAppIdAtom = routerAppIdAtom \|\| recentAppIdAtom`); the query pins to `appId`, persisted filters and the `references.application.id` row scope by `routeAppId` so filters can't leak between apps | binds an OSS atom via `bindObservabilityScopeAtom` | leaves the default (project-wide) |
| `currentWorkflowContextAtom` | `observabilityWorkflowContextAtom: {workflowId, workflowKind} \| null` | existing atom sync | `null` |
| `getOrgValues()` → workspace members | `workspaceMembersAtom` in `@agenta/entities/organization` | binds an OSS atom via `bindWorkspaceMembersAtom` | default `[]` — annotations show raw ids until mobile has an org store |
| `sessionExistsAtom` | **none needed** — import `sessionAtom` from `@agenta/shared/state` (it is the auth atom; the OSS name is already a re-export of it) | unchanged | already bound |
| `Filter` / `SortResult` types | `src/core/types.ts` (`SortResult` = the existing `AnalyticsRange`, not a second copy) | type-only re-export from `lib/Types.ts` / `Sort.tsx` | direct |
| `TestsetTraceData` drawer atom | **stays in OSS** — host UI state, not query state | OSS-local atom | n/a |
| onboarding `hasReceived*Atom` | **stays in OSS** (`lib/onboarding` is OSS-only) | OSS-local | n/a |

> Two atoms deliberately do *not* move: `testsetDrawerDataAtom` and the onboarding
> `hasReceived*` pair. They are host-surface state that happens to live in the state folder
> today. They live in `oss/src/state/observability/atoms.ts`; `useObservability()` keeps
> returning `testsetDrawerData` on desktop via the thin wrapper in the same folder (which
> already existed for `useObservabilityDashboard` — follow that file's pattern).
>
> **Seams bind an atom, not a value.** The query atoms read scope/context synchronously while
> they evaluate, so a host pushing values from a `useEffect` fires one disabled query per mount
> first. Each seam is a `bind…Atom` write-only atom that takes the host's *atom*; OSS calls all
> three from `Providers.tsx` during the first render.
>
> **`executeTraceQuery` takes `projectId` explicitly.** It used to call OSS's `getProjectValues()`.
> Both `createAdaptiveTracePageFetcher` callers (CSV export, batch-add-to-queue) thread it through
> `BatchAddScanConfig`.
>
> **`referenceUtils` comes forward from WP2.** `queryHelpers` imports it, so WP1 cannot ship
> without it. It is 125 pure LOC needing only `FilterValue`; the other five filter-engine files
> stay for WP2. Note `valueCodec` imports *from* the state layer, so the two WPs are mutually
> entangled — WP2 gets easier, not harder, for this.
>
> **Types move, and OSS type-re-exports them.** `Filter`/`FilterValue`/`FilterConditions`
> (`lib/Types.ts`), `SortResult`/`SortTypes` (`Filters/Sort.tsx`) and the annotated `TraceSpanNode`
> (`services/tracing/types`) now live in `@agenta/observability/core`. The OSS lint ban is on
> `export … from "@agenta/*"`; a **no-source** `export type {X}` after a plain `import type` is not
> matched — and since types erase, the rule's tree-shaking rationale does not apply. That keeps
> 60+ existing OSS call sites untouched. Do the same in later WPs for types; never for values.

**Gate:** package `tsc` + unit tests (12 cases on `buildTraceQueryParams` /
`buildAnnotationConditions` / `mergeConditions`); OSS `tsc` 0; observability page live-QA'd
unchanged (traces load, sessions load, filters apply, export runs).

### WP2 — filter engine into `@agenta/observability/filters`

Move the 567 pure LOC: `fieldAdapter`, `operatorRegistry`, `rulesEngine`, `valueCodec`,
`referenceUtils`, `attributeKeyOptions`, plus `getFilterColumns`.
`oss/components/Filters/Filters.tsx` keeps its antd dialog and imports the engine from the
package. Also move `exportUtils` (`createTraceObject`, `DEFAULT_TRACE_EXPORT_HEADERS`) —
export is a capability mobile can have later.

> **Split `assets/constants.ts` (770 LOC) — it holds two unrelated exports.** `FILTER_COLUMNS`
> (lines 37–705) is filter field metadata and belongs to this WP; `spanTypeStyles` (line 706+)
> is the span-category icon/colour map consumed by `AvatarTreeContent` and `NodeNameCell` and
> belongs to **WP3**. Moving the file whole into either WP creates a backwards dependency
> between them. Split it at the extraction, don't carry it. (Confirmed exactly: line 37 and
> line 706.)
>
> **`assets/utils.ts` is a second mixed file the plan missed.** It holds the six operator-set
> constants the column table needs (WP2) *and* `filterTree`, the TraceTree search helper
> (WP5). Split it the same way; `filterTree` stays until WP5.
>
> **`FILTER_COLUMNS` carries 14 Phosphor icon components, so it cannot move as-is.**
> `@agenta/observability` is headless by contract (its eslint config bans antd and the UI
> packages) and mobile ships Lucide, not Phosphor — importing an icon set into the state
> package would push it into every consumer's bundle. Resolution: the packaged table is
> pure metadata with `icon?: IconSlot` (a bare `ComponentType`), and `getFilterColumns`
> takes a host icon map keyed by node label. All 14 live icons sit on top-level nodes with
> unique labels, so the overlay is one flat 14-entry record in
> `oss/.../assets/filterColumnIcons.ts`. Do the same for any later table that carries icons.
>
> **`components/Filters/types.d.ts` had to split too.** The filter-menu model (`FilterLeaf`,
> `FilterGroup`, `FilterMenuNode`, `SelectOption`, `InputConfig`, `FilterItem`, …) moves to
> the package; `Props` and `FieldMenuItem` stay in OSS because they name antd's `ButtonProps`
> and `MenuProps`. OSS type-re-exports the moved half (same erased-type technique as WP1).

**Gate:** the filter dialog behaves identically, including the trace_type ↔ references-row
label flip (`ObservabilityHeader.reconcileFilterRows`, lines 155–239) — that reconciler moved
into the package as `filters/reconcileFilterRows.ts`, a pure
`(rows, workflowKind, fieldMap) => rows` function with 10 unit tests covering the enum flip on
negated operators, array unwrapping, referenceProperty matching, non-permanent rows, and the
length/order contract the dialog's index-based mutation depends on.

### WP3 — `@agenta/observability-ui` created; cells go antd-free

New package (deps: `@agenta/observability`, `@agenta/entities`, `@agenta/ui`,
`@agenta/shared`, `@phosphor-icons/react`, `clsx`, `motion`; eslint bans antd +
`@agenta/ui` root barrel).

Ported components:

- Trace cells: `NodeNameCell`, `StatusRenderer`, `CostCell`, `DurationCell`, `UsageCell`,
  `TimestampCell`, `EvaluatorMetricsCell`, `AvatarTreeContent`, `SpanIdChip` (the inline
  `Tag` in `getObservabilityColumns`).
- Session cells (all 10): `SessionIdCell`, `FirstInputCell`, `LastOutputCell`,
  `TracesCountCell`, `StartTimeCell`, `EndTimeCell`, `DurationCell`, `TotalCostCell`,
  `TotalLatencyCell`, `TotalUsageCell`, + `sessionCellStore` (the store-context escape
  hatch travels with them, unchanged).
- Empty states: `EmptyObservability`, `EmptySessions` — **the most coupled items here, do
  them last**. **Deferred out of WP3 as shipped**: both stay in OSS for now (they carry the
  onboarding/CTA/video wiring and antd `EmptyState`/`Placeholders`). They block nothing —
  mobile supplies its own empty state in WP6 — so they move with WP6 or a follow-up.

`getObservabilityColumns` / `getSessionColumns` **stay in OSS** — they are antd
`ColumnsType` definitions — but every `render` now returns a packaged cell.

#### Per-cell dependency audit (do not assume "cell = portable")

Every cell's non-package imports, checked individually. Most are clean; four are not.

| Cell(s) | Extra OSS deps | Resolution |
| --- | --- | --- |
| `NodeNameCell`, `AvatarTreeContent`, `StatusRenderer`, `CostCell`, `DurationCell`, `UsageCell`, `TimestampCell` | none beyond `state/newObservability` (WP1) + `spanTypeStyles` (WP2 split) | **clean — port as-is** |
| 8 of the 10 session cells | `state/newObservability/atoms/queries` only (WP1) | clean |
| `FirstInputCell`, `LastOutputCell` | `sanitizeDataWithBlobUrls` | moved to `@agenta/shared/utils` in WP0 |
| `EvaluatorMetricsCell` | `LabelValuePill` (antd-free ✓), `booleanValueColorClass`, `useProjectData`, **`useEvaluatorReference`** | **D1 RESOLVED — inject the label.** `References/atoms/entityReferences` measured at **721 LOC**, far too much to drag into a cell. The packaged cell takes `displayName?: string`; OSS keeps a ~20-line wrapper that resolves it via `useEvaluatorReference`. `LabelValuePill` had exactly ONE consumer so it moved into the package too; `booleanValueColorClass` (2 lines) was inlined |
| `EmptySessions` | `Placeholders/EmptyComponent` (**antd**) | port the placeholder alongside |
| `EmptyObservability` | `EmptyState` (**antd**), `EmptyState/videos`, `Placeholders/EmptyComponent` (**antd**), `useURL`, `lib/onboarding` | heaviest item. Keep the onboarding/CTA/video wiring in OSS and let the package take copy + CTA as props; the shell is what gets shared |

**Gate:** `grep -r 'antd' web/packages/agenta-observability-ui/src` empty; desktop
screenshots identical in light + dark; add the package to the OSS Tailwind `content` globs
and mobile's `@source` list (**the known landmine** — see `project_sessions_ui_package_stack`;
a missing glob silently drops the package's unique utilities).

### WP4 — toolbar decomposition

`ObservabilityToolbar` in `observability-ui`, ported from the 743-line
`ObservabilityHeader`: search input, Root/LLM/All segmented control, realtime All/Latest
segmented control, `AutoRefreshControl` (switch + the progress-bar animation, verbatim),
refresh button, export/delete buttons. Everything not portable is a **slot**:

```tsx
<ObservabilityToolbar
    filtersSlot={<Filters … />}          // OSS: antd dialog. Mobile: filter sheet trigger.
    sortSlot={<Sort … />}                // OSS: antd popover + DatePicker.
    actionsSlot={<AddActionsDropdown … />} // OSS only (testset + queue).
/>
```

The export pipeline, delete-modal wiring, `useBatchAddTracesToQueue`, and the
add-all-matching confirm stay in OSS as callbacks handed to the toolbar. OSS
`ObservabilityHeader` shrinks to composition.

**Gate:** every toolbar capability exercised live — see the parity checklist (§5).

### WP5 — the compact trace row (extracted, not invented)

**There is no card presentation of a trace or an observability session anywhere in the
repo.** Both exist only as antd table rows. So this WP extracts the one compact row OSS
*does* ship and composes the rest from WP3's cells — it does not design a new card.

**Traces — extract `TraceTree`'s row.** `TraceContent` in
[`TraceDrawer/components/TraceTree/index.tsx`](../../../web/oss/src/components/SharedDrawers/TraceDrawer/components/TraceTree/index.tsx)
is a designed, shipping, non-table trace row: span-type glyph (`AvatarTreeContent`), span
name with error styling, and inline cost / tokens / latency from
`formattedSpan{Cost,Latency,Tokens}AtomFamily`. antd usage is only `Space` / `Tooltip` /
`Typography` — the same trivial map as WP3.

- Move `TraceRow` (the renamed `TreeContent`) + `AvatarTreeContent` +
  `filterKeySpans`/`filterTree` into `observability-ui`, antd-free.
- Move the three `formattedSpan*AtomFamily` selectors into `@agenta/observability` (WP1
  already moves `selectors/tracing`, so they arrive with it).
- **Desktop's `TraceTree` adopts the packaged row in this same PR.** One implementation —
  the tree chrome (`CustomTreeComponent`, settings popover) stays OSS.

**Observability sessions — no row exists; compose from cells.** The Sessions tab's
projection (`session_id`, first input, last output, traces count, start/end, duration,
total cost/latency/usage) has no non-table rendering to extract, and it is a *different
entity* from `@agenta/sessions` — `POST /spans/sessions/query` groups spans by session id,
whereas `@agenta/sessions` is the agent-session entity (name, pinned, alive, agent). Do not
reuse `SessionCardList`; it renders a `SessionRowVm` that this data cannot fill.

> **Open design question — flag before building.** Either (a) mobile stacks the WP3 session
> cells in a host-owned layout (honest, no new shared abstraction, and the cells stay the
> single source of formatting), or (b) design supplies a session row and it lands in
> `observability-ui` for both surfaces. Default to (a); (b) is a design ask, not an
> engineering decision. Nothing downstream blocks on the answer — WP3's cells are the
> shared part either way.

**List shell.** `ObservabilityList` in `observability-ui` — infinite scroll via
`IntersectionObserver`, skeletons, error/empty states — is genuinely new, but it is a
container with no visual design of its own, and the `SessionCardList` scroll/skeleton
handling is the model to follow rather than re-derive.

Desktop's tables are untouched by this WP; only `TraceTree` changes, and it changes to
*consume* the extraction.

### WP6 — mobile observability surface

```text
mobile/src/pages/w/[workspace_id]/p/[project_id]/observability/index.tsx
mobile/src/features/observability/
    ObservabilityScreen.tsx     tab strip (Traces | Sessions), pull-to-refresh
    TracesList.tsx              ObservabilityList over useObservability()
    SessionsList.tsx            ObservabilityList over useSessions()
    ObservabilityFilterSheet.tsx  shadcn sheet over the WP2 engine
    ObservabilitySortSheet.tsx    the 10 range presets, no custom DatePicker in v1
    states/ObservabilityStates.tsx
```

Wiring: `observabilityScopeAtom` ← route (project-wide, `appId: null`);
`observabilityWorkflowContextAtom` ← `null`; nav entry added to `useMobileNavItems`
(`Activity` lucide icon, after Sessions).

**Deliberately out of scope on mobile v1**, each an explicit non-regression (desktop keeps
all of it): CSV export, bulk delete, add-to-testset, add-to-queue, column
visibility/resize, custom date range. Document them in the PR body rather than silently
dropping.

### WP7 — mobile trace detail

Route `observability/[trace_id].tsx`. WP5 already delivered the span row; this WP adds the
rest of the detail: ports `TraceContent/OverviewTabItem` + `AccordionTreePanel` onto plain
elements into `observability-ui` (`TraceDetailPanel`), reusing `@agenta/ui/drill-in` for
navigation and the WP5 `TraceRow` for the span list. Desktop's `TraceDrawer` adopts the
packaged panels in the same PR so there is one implementation — the drawer chrome (antd
`Drawer`) stays OSS.

This is the largest WP; if it needs to slip, WP0–WP6 still ship a complete list surface.

### WP8 — dashboard tab (optional)

`AnalyticsDashboard` + `CustomAreaChart` + `widgetCard` → `observability-ui`. The data
layer is already packaged and `recharts` is antd-free, so mobile can take the chart as-is.
Gives mobile a usage/analytics view and lets `pages/overview/observability` drop its last
local components.

antd to replace: `Spin` (AnalyticsDashboard), `Tabs` + `Typography` (widgetCard), and —
easy to miss — **`CustomAreaChart.tsx:4` imports antd's `theme`** and drives the chart's
colours off `theme.useToken()`. recharts needs literal colour values, not classes, so that
becomes a `getComputedStyle` read of the `--ag-color*` CSS vars (or a small
`useThemeTokens()` helper in `@agenta/ui/theme`). Verify both themes — this is the one
place where a token regression is invisible until the chart renders.

---

## 4. Sequencing

```text
WP0 entities-prep
 └─ WP1 observability state
     └─ WP2 filter engine
         └─ WP3 observability-ui + cells
             └─ WP4 toolbar
                 └─ WP5 TraceRow extraction + list shell
                     ├─ WP6 mobile surface
                     │   └─ WP7 mobile trace detail (+ desktop drawer adopts)
                     └─ WP8 dashboard  (independent of WP6/7; order by conflict count)
```

WP6/WP7 touch only `web/mobile/**`; WP8 touches only packages + `web/oss/**`. Per the
GitButler note in `AGENTS.md`, keep them in one linear stack and set each PR's base to the
branch below — disjoint file sets can sit anywhere in the line.

---

## 5. No-functionality-removal checklist

Every item is live-verified on desktop **after each WP**, not just at the end. Desktop
must never lose any of these:

**Traces tab** — infinite scroll + total count · row selection (checkbox column, 48px) ·
row click → trace drawer with `?trace=&span=` url sync · `?tab=` sync · column visibility
(persisted, `observability-table-columns`) + resize · Root / LLM / All switch (with the
`span_type=chat` filter coupling and the `tracing` query-cache purge) · search
(`content contains`, with clear-on-empty) · filter dialog incl. the trace_type label flip ·
sort presets (default 24h) + custom range · auto-refresh 15s w/ progress bar and
page-1 reset · manual refresh (traces + annotations + evaluator-cache invalidation) ·
CSV export w/ `showSaveFilePicker` streaming, adaptive pacing, 429 backoff, cancel ·
bulk delete · add-to-testset · add-selected-to-queue · add-all-matching-filter-to-queue
(with the no-filter confirm) · dynamic evaluator metric columns · rate-limited empty state ·
new-user onboarding empty state + `data-tour` anchors.

**Sessions tab** — infinite scroll · row click → session drawer w/ url sync · All activity /
Latest activity · the 10 lazy per-session cells and their skeletons · the page-store
context escape hatch (`SessionStoreProvider`) · auto-refresh · onboarding empty state ·
hidden entirely when the current workflow is an evaluator, incl. the `?tab=sessions`
URL rewrite.

**Page** — `PageTitle` vs `WorkflowPageTitle` by workflow context · `SetupTracingModal`
opened by the `tracing-snippet` onboarding widget + its `tracing_setup_modal_opened` event ·
EE route parity (EE re-exports the OSS page — keep it a one-line re-export).

---

## 6. Risks

1. **Tailwind content globs.** New packages must be added to `oss/tailwind.config` content
   and mobile's `@source` list or their utilities silently vanish. Highest-frequency
   failure in the sessions stack.
2. **Jotai store identity.** `sessionCellStore` exists because the table mounts rows in an
   isolated store. Move it verbatim; do not "clean it up".
3. **QueryClient host contract.** Package code must never import the `queryClient`
   singleton — use `getHostQueryClient()` from `@agenta/shared/api`, resolved **per call**,
   never cached at module scope. Lint-enforced in `web/packages/eslint.config.mjs`, including
   dynamic imports. `/m` shipping its own client is exactly how package-layer
   `invalidateQueries` silently addressed an orphan cache — mutations "succeed", nothing
   refreshes. See `web/CLAUDE.md` § *The QueryClient host contract*.
4. **Names that lie — verify before trusting any of them.** Three landmines were found
   while writing this plan and there are probably more: `sessionExistsAtom` is the *auth*
   atom, not a session-entity atom; `assets/constants.ts` holds two unrelated exports that
   belong to different WPs; the observability "Sessions" tab is a different entity from
   `@agenta/sessions`. Read the file before moving it.
5. **Theme tokens in shared components.** No `--ant-color-*` and no `border-0 border-b`
   in package components — both break on mobile (`reference_shared_component_tokens_mobile`).
   `getObservabilityColumns` currently hardcodes `bg-[var(--ag-c-0517290F)]`; that becomes
   a semantic token during WP3.
6. **`useObservability()` is a 40-key god hook.** Splitting it is tempting and out of
   scope. Keep the signature; the OSS wrapper re-adds the two host-owned atoms.
7. **The Sessions-tab evaluator gating** is easy to lose in the extraction — it is the one
   piece of business logic in the page shell.
8. **Test laning.** A test that touches both a package and its host must land on the lane
   whose tip first contains every symbol it uses (`AGENTS.md`, "lane a test with the half
   that appears LAST") — a green local run proves nothing with all lanes applied.

---

## 7. Estimate

| WP | Scope | Size |
| --- | --- | --- |
| WP0 | entities prep | S |
| WP1 | state → package (2.5k LOC + seams) | L |
| WP2 | filter engine (1.4k LOC, pure) | M |
| WP3 | observability-ui + ~20 cells | L |
| WP4 | toolbar decomposition | M |
| WP5 | extract TraceTree's row + list shell | M |
| WP6 | mobile surface | M |
| WP7 | mobile trace detail + desktop drawer adoption | L |
| WP8 | dashboard (optional) | S |

WP0–WP6 is the minimum that closes the mobile gap. WP7 makes it useful; WP8 is a bonus
that also finishes `pages/overview/observability`.

---

## 8. The table — measured, and its eventual port

Out of scope for this stack, but it cannot stay antd forever: the target architecture is
`web/mobile` **replacing** `web/oss` + `web/ee`, with OSS/EE as an env-var gate in one
antd-free app (`project_mobile_replaces_oss_ee`). A 10-column resizable observability grid
has to exist in that app. So this is a scheduling decision, not an architectural exemption.

### What the coupling actually is

"13,295 LOC of antd" was wrong. Measured:

| | Count | Notes |
| --- | --- | --- |
| Files importing antd at **runtime** | **12** | and 4 of those import only `MenuProps` (a type) |
| Actual runtime antd components | `Table`, `Typography`, `Skeleton`, `Tree`, `Checkbox`, `Popover`, `Tooltip`, `Dropdown`, `Grid` | all but `Table` are the same peripheral chrome WP3 already replaces |
| Files **type**-coupled to `ColumnsType` / `ColumnType` / `antd/es/table` | **22** (167 refs) | wide, but mechanical |
| Framework-neutral logic | **~11,000 LOC** | stores, column-width math, visibility, resize, export, infinite scroll, grouping, row height — no antd |
| Consumers of `@agenta/ui/table` | **82 files** | the real blast radius |
| Consumers reaching into `.ant-table-*` DOM | **18 files, 100 refs** | e.g. observability's `[&_.ant-table-thead_tr:nth-child(2)]:hidden` |

The load-bearing coupling is a **single render leaf**:
`components/InfiniteVirtualTableInner.tsx` (767 LOC) rendering `<Table virtual />`
(`useTableManager.tsx:347`). antd 5's `virtual` mode is rc-table + rc-virtual-list, and it
is supplying virtualization, fixed/sticky columns, and the header/body split — the three
things that are genuinely hard to rebuild.

### The port, in the order it should happen

1. **Break the type coupling.** Introduce a local `ColumnDef<T>` in the package;
   `ColumnsType` becomes an adapter at the OSS boundary. 22 files, mechanical, zero visual
   risk, independently landable, and it unblocks everything after it. **Do this one early
   regardless** — it is the step that stops the debt growing.
2. **Replace the peripheral chrome.** `Typography`, `Skeleton`, `Tooltip`, `Popover`,
   `Dropdown`, `Checkbox`, `Tree`, `Grid` → the exact replacements WP3 establishes. ~8
   files. After this the package's only antd is `<Table>`.
3. **Replace the render leaf.** Two credible routes:
   - **rc-virtual-list / rc-table directly** — standalone `react-component` packages, not
     antd. Keeps virtualization and fixed-column behavior essentially identical while
     dropping the antd dependency and its theme layer. Lowest behavioral risk; the
     pragmatic default.
   - **TanStack Virtual + plain table DOM** — more control, no rc lineage, but re-implements
     sticky headers, fixed columns, and the resize/scroll hooks that currently assume antd's
     DOM (`useSmartResizableColumns` positions cells by integer widths against it).
     Note: `@tanstack/react-virtual` was rejected for *chat* virtualization
     (`project_agent_chat_virtualization`) — that was variable-height messages, the opposite
     of a uniform-row table. Not a blanket ban, but re-validate rather than assume.
4. **Give consumers stable class hooks.** The 18 files reaching into `.ant-table-*` must be
   migrated to package-owned classes (`.avt-thead`, `.avt-cell`, …) — ideally *before*
   step 3, so the leaf swap does not break them. Cheap, and it decouples the schedule.

Steps 1, 2 and 4 are independently landable, carry no visual risk, and shrink the problem
to one file. Step 3 is the only real project. Sequencing them this way means the table is
never blocking observability, mobile, or each other.

### Why mobile does not wait for it

Mobile does not want a resizable 10-column grid on a phone — WP5/WP6 stack cells
vertically, which is the right mobile surface regardless of what the table is built on.
When the port lands, mobile gains the *option* of a real table on tablet/desktop widths
with no rework, because both surfaces already read the same cells and the same state.

---

## 9. Appendix — re-measuring the numbers

Every figure in this document came from these commands, run from the repo root on
`be2548e35a`. Re-run them before starting; if one disagrees with the text, trust the
command and update the text.

```bash
# §1 landscape LOC
find web/oss/src/components/pages/observability -type f | xargs wc -l | tail -1   # 4760
find web/oss/src/state/newObservability -type f      | xargs wc -l | tail -1      # 2550
find web/oss/src/components/SharedDrawers/TraceDrawer -type f | xargs wc -l | tail -1  # 5819

# antd surface of the page (23) and of the drawer (21 files)
grep -rn 'from "antd"' web/oss/src/components/pages/observability | wc -l
grep -rl 'from "antd"' web/oss/src/components/SharedDrawers/TraceDrawer | wc -l

# the filter engine is pure — this must print nothing
grep -l 'react\|React\|jsx' web/oss/src/components/pages/observability/assets/filters/*.ts

# §3 WP1 — the OSS modules the atoms still import
grep -h 'from "' web/oss/src/state/newObservability/atoms/*.ts \
                 web/oss/src/state/newObservability/hooks/*.ts \
  | sed 's/.*from "//;s/".*//' | sort -u | grep '@/oss'

# §3 WP3 — per-cell OSS coupling (the audit table)
cd web/oss/src/components/pages/observability
for f in components/*.tsx components/SessionsTable/components/Cells/*.tsx; do
  d=$(grep -h '@/oss/' "$f" | sed 's/.*"\(@\/oss[^"]*\)".*/\1/' | tr '\n' ' ')
  [ -n "$d" ] && echo "$f → $d"
done

# §8 the table
D=web/packages/agenta-ui/src/InfiniteVirtualTable
find $D -type f | xargs wc -l | tail -1                            # 13295 total
grep -rl 'from "antd"' $D | wc -l                                  # 12 runtime importers
grep -rl 'ColumnsType\|ColumnType\|antd/es/table' $D | wc -l       # 22 type-coupled
grep -rln '@agenta/ui/table' web/oss/src web/ee/src web/packages/*/src | wc -l   # 82 consumers
grep -rln '\.ant-table' web/oss/src web/ee/src web/packages/*/src | wc -l        # 18 DOM-coupled
```

### Claims that were wrong in earlier drafts

Kept here so they are not re-derived. Each was corrected after measurement:

| Earlier claim | Reality |
| --- | --- |
| Mobile renders traces/sessions as "cards" | No card exists for either. Traces get `TraceTree`'s row extracted (WP5); the session row is an open design question |
| `SessionCardList` is reusable for the Sessions tab | Different entity — `POST /spans/sessions/query` vs `@agenta/sessions`'s agent sessions |
| `@agenta/ui/table` is 13,295 LOC of antd | ~11,000 LOC is framework-neutral; 12 runtime importers; one `<Table virtual>` leaf |
| The table cannot/should not ever be ported | It must be, under the mobile-replaces-oss+ee target. §8 sequences it |
| `sessionExistsAtom` → `@agenta/entities/session` | It is the **auth** atom, already re-exported from `@agenta/shared/state`. No move |
| `getOrgValues()` reads org **tier** | It reads workspace **members** for annotation author attribution |
| WP2 moves `assets/constants.ts` whole | The file holds `FILTER_COLUMNS` (WP2) **and** `spanTypeStyles` (WP3). Split it |
| Dashboard only needs `Spin`/`Tabs`/`Typography` | `CustomAreaChart` also uses antd's `theme.useToken()` for chart colours |
| Cells are uniformly portable | 7 are clean; `EvaluatorMetricsCell` and both empty states carry real OSS subtrees |
| WP1's app seam is `selectedAppIdAtom` | Two atoms — `selectedAppIdAtom` (query scope) and `routerAppIdAtom` (filter persistence + reference row). One seam, two fields |
| WP2 owns the whole filter engine | `queryHelpers` needs `referenceUtils`, so WP1 takes it; `valueCodec` needs the state layer, so WP2 needs WP1. Mutually entangled |
| There is one `buildTraceQueryParams` | Two unrelated functions of that name — `atoms/queryHelpers` (positional, query body) and `utils/` (object-arg, URL params). Exported as `buildTraceQueryParams` and `buildTraceUrlParams` |
| Packages can take moved code verbatim | Packages enforce `no-explicit-any: error` and both target packages had **zero** `any`. Every moved file was retyped (~45 `any` across WP1). Budget it into WP3's cells |
| `FILTER_COLUMNS` is portable metadata | It embeds 14 Phosphor icon components. The table moves icon-free; the host overlays icons by label via `getFilterColumns(attrOptions, icons)` |
| `assets/constants.ts` is the only mixed file | `assets/utils.ts` mixes WP2 operator sets with WP5's `filterTree`, and `Filters/types.d.ts` mixes the portable filter-menu model with antd-typed `Props`/`FieldMenuItem` |
| The cells are the bulk of WP3 | The 17 cells are only ~400 LOC and 4 of them touch antd. The real WP3 cost is the *rewiring* and the `StatusRenderer` prop surface (`tagProps` had to become an explicit `bordered` prop) |
| A regex rewrite of import specifiers is safe | `assets/constants` is a filename used by ~40 unrelated OSS modules (agent-home, TemplateStrip, Webhooks, state/app). A path-suffix regex clobbered all of them. **Anchor rewrites on the full specifier, and diff the touched-file list against the expected one before moving on** |
| WP0 leaves thin re-export shims at the old OSS paths | OSS/EE lint bans `export … from "@agenta/*"`. Call sites get rewritten and the old module deleted |
| `services/annotations/api` → `@agenta/entities/annotation` | Five export-name collisions with the existing zod entity API. Lands on an `annotation/dto` subpath; the 4 CRUD fns stay in OSS |
| `observability_helpers` moves whole | Only `getNodeById` moves. The other two need 149 LOC of legacy `AgentaNodeDTO` types the entity layer should not carry |
| `state/newObservability` imports 12 OSS modules | 15 distinct import paths (§9 command output) |
