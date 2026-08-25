# Observability chrome → antd-free (the WP4.5 the first plan did not have)

> **Status:** plan only. Written after WP0–WP3 of
> [`../observability-packages/plan.md`](../observability-packages/plan.md) landed
> (branches `obs/wp0…obs/wp3`). Every number below was measured on that stack's tip, not
> estimated — **re-run §7 before starting.**
> **To execute, start from `KICKOFF.md` in this directory.**

## 1. Why this exists

WP0–WP3 moved observability's **state and cells**. They moved almost none of its **chrome**.
Open the page and the toolbar is still antd end to end: `ant-radio-button-label` on
Root/LLM/All, `ant-switch-inner` on auto-refresh, `ant-btn` on Export/Delete/Add,
`ant-popover` on the sort menu, and a 1,983-line antd dialog behind the filter button.

The original plan was internally consistent about this — it treats the filter dialog and the
sort popover as **slots that stay antd on desktop**, and gives mobile its own sheet built on
the shared engine. That is coherent only if desktop keeps antd forever. It contradicts the
stated target architecture (`/m` replacing `web/oss` + `web/ee`, OSS/EE as an env-var gate in
one antd-free app) and it bakes in duplication: two filter UIs, two sort UIs, sharing only the
engine underneath.

**The ordering argument is the whole point of doing this now.** The moment WP6 ships a mobile
filter sheet and a mobile sort sheet, a second implementation exists and the cost of collapsing
them roughly doubles. This is the last cheap moment.

Scope here is the **chrome around the table**. The table itself (13,295 LOC, 12 antd runtime
importers) and the trace drawer (5,821 LOC, 21 antd files) stay out — see §6.

## 2. The finding that makes this cheap

`@agenta/ui/components/ui` (exported as `@agenta/ui/ui`) is **already a near-complete antd-free
primitive set**, built on Radix:

```
accordion  alert  alert-dialog  avatar  badge  breadcrumb  button  cascader  checkbox
combobox  context-menu  data-table  dialog  divider  dropdown-menu  empty-state  field
input  input-number  label  notification  popover  progress  radio-group  segmented  select
sheet  skeleton  slider  spinner  split-pane  switch  tabs  toast  tooltip
```

Cross-referenced against every antd component the chrome actually uses:

| Surface | antd used | Covered by `@agenta/ui/ui`? |
| --- | --- | --- |
| `ObservabilityHeader` (743 LOC) | `Radio.Group` ×7, `Space` ×5, `Input.Search`, `Switch`, `Typography` | **all covered** — `segmented`, flex, `input`, `switch`, spans |
| `Sort.tsx` (318 LOC) | `Popover`, `Button` ×3, `Divider` ×2, `Typography.Text` ×4, **`DatePicker` ×2** | all but `DatePicker` |
| `Filters.tsx` (1,983 LOC) | `Button` ×11, `Select` ×9, `Space` ×5, `Input` ×5, `Typography.Text` ×4, `Divider` ×2, `Popover`, `Dropdown`+`MenuProps`, **`TreeSelect`** | all but `TreeSelect` |
| `getObservabilityColumns` | `Tag`, `ColumnsType` | `Tag` → `SpanIdChip` (already built in WP3); `ColumnsType` is §6 |

**Exactly two real gaps: a date-range picker and a tree-select.** Everything else is wiring.

Second finding: **`@agenta/home-ui/AnalyticsRangePicker` is 54 LOC, already antd-free, and
already renders `ANALYTICS_RANGE_PRESETS`** — the same preset catalogue Sort uses (WP1 aliased
`SortResult = AnalyticsRange` precisely because they are the same type). Its own comment says
custom start/end was skipped *because it needs a date picker*. So the preset half of Sort's
replacement already exists and must be reused, not rebuilt.

## 3. Target

```text
@agenta/ui/ui              ← GROWS: DateRangePicker, TreeSelect (the two gaps)
   ↑
@agenta/observability      (unchanged — engine + state, from WP1/WP2)
   ↑
@agenta/observability-ui   ← GROWS: ObservabilityToolbar, RangePicker, FilterDialog,
   ↑                          FilterRow, AnnotationFilterRow
   ├── web/oss + web/ee     desktop composes the same components; antd originals deleted
   └── web/mobile           WP6 reuses these directly — no parallel sheet
```

The rule that makes it parallel: **agents write NEW files in packages. Nobody edits the OSS
originals until the integration phase.** `Filters.tsx` is not touched by four agents at once;
it is replaced once, at the end, by a composition of files they wrote independently.

## 4. Work packages

Dependency shape — P0 blocks two tracks, the five T-tracks are mutually independent, I is serial:

```text
P0-A DateRangePicker ─┐
P0-B TreeSelect ──────┼─→ T2 RangePicker ─┐
                      └─→ T3 FilterDialog ─┤
                          T1 Toolbar ──────┼─→ I  Integration + QA
                          T4 AnnotationRow ─┤
                          T5 Column defs ───┘
```

### P0 — the two missing primitives (blocking, 2 agents in parallel)

**P0-A · `DateRangePicker` in `@agenta/ui/ui`.** The only greenfield component in this plan.
Replaces antd `DatePicker` ×2 in `Sort.tsx` (custom start/end). No date library is currently a
dependency of `@agenta/ui`; `dayjs` is already used across the repo, so prefer a dayjs-backed
calendar over adding `react-day-picker` — **decide and record the choice, do not add a
dependency silently**. Needs: two-month range selection, min/max, and it must emit the
`{startTime, endTime}` ISO shape `SortResult.customRange` already uses.

**P0-B · attribute-key tree input.** Replaces antd `TreeSelect` (one usage,
`Filters.tsx:1395`) which renders `AttributeKeyTreeOption[]` from
`@agenta/observability/filters`. **First evaluate the existing `cascader`** — if it covers a
searchable, arbitrarily-nested, single-select tree, use it and write no new component. Only
build `tree-select.tsx` if cascader genuinely cannot. Report which way you went and why.

### T1 — `ObservabilityToolbar` (independent, no P0 dependency)

This is WP4 of the original plan, unchanged in intent. Port from the 743-line
`ObservabilityHeader`: search input, Root/LLM/All segmented control, realtime All/Latest
segmented control, `AutoRefreshControl` (switch + the progress-bar animation, **verbatim** —
it is the one piece of visual behaviour that is easy to lose), refresh button, export/delete
buttons. Everything not portable stays a slot:

```tsx
<ObservabilityToolbar
    filtersSlot={…}   // T3's FilterDialog once integrated
    sortSlot={…}      // T2's RangePicker
    actionsSlot={…}   // OSS-only: AddActionsDropdown (testset + queue)
/>
```

Export pipeline, delete-modal wiring, `useBatchAddTracesToQueue` and the add-all-matching
confirm stay in OSS as callbacks handed to the toolbar.

### T2 — `RangePicker` (needs P0-A)

**Do not write a preset list.** Start from `@agenta/home-ui/AnalyticsRangePicker` (54 LOC,
antd-free) and move it to a shared home both surfaces can import — likely
`@agenta/observability-ui`, with `home-ui` re-pointed at it. Add the `custom` branch it
deliberately omits, using P0-A. Preserve every behaviour in `Sort.tsx`: the 10 presets, the
`exclude` prop, "Define start and end time", and the `{type, sorted, customRange, label}`
result shape.

> **Known defect to fix while here (pre-existing, not caused by the package work).**
> `Sort.tsx:107` is uncontrolled — `useState<SortTypes>(defaultSortValue)` with
> `defaultSortValue="24 hours"` hardcoded at `ObservabilityHeader:685`, and no effect syncing
> back from the atom. Switch tabs and the button label resets to "Last 24 hours" while the
> query keeps the real window. Verified live: set "All time" (7 rows), round-trip tabs, label
> reads "Last 24 hours", table still shows 7. The replacement must be **controlled** — read
> the range from `sortAtom`, never from local state seeded by a prop.

### T3 — `FilterDialog` + `FilterRow` (needs P0-B)

The bulk. `Filters.tsx` decomposes along real seams:

- **lines 1–270** — helpers: `collapseAnnotationAnyEvaluatorRowsFromProps`,
  `extractAnnotationValue`, `buildFieldMenuItems`. Pure; some siblings already moved to
  `@agenta/observability/filters` in WP2. Move these too, with unit tests.
- **line 840+** — the `Popover` shell: header, `+ Add`, `Clear`, `Cancel`, `Apply`.
- **the per-row render** — field menu (`Dropdown` + `MenuProps`), operator `Select`, value
  input (`Select` / `Input` / the P0-B tree).

T3 owns the shell and the generic row. It must consume `planInputs` from
`@agenta/observability/filters` (WP2's `rulesEngine`) rather than re-deriving which inputs to
show — that decision logic is already packaged and unit-tested.

### T4 — `AnnotationFilterRow` (independent of T3's files)

`Filters.tsx:938–1283` is a self-contained feature: the evaluator + feedback sub-row with its
own handlers (`handleEvaluatorChange`, `handleFeedbackFieldChange`,
`handleFeedbackOperatorChange`, `handleFeedbackValueChange`, `removeEvaluator`,
`removeFeedback`) and its own operator sets (`ALL_FEEDBACK_OPERATOR_OPTIONS`,
`NUMERIC_FEEDBACK_OPERATOR_VALUES`). Written as a separate file it does not collide with T3.

### T5 — column defs and the `ColumnsType` seam (independent)

Two small, unrelated-to-each-other items:

1. `getObservabilityColumns.tsx` still imports antd `Tag` — swap for `SpanIdChip`, already
   built in WP3 and exported from `@agenta/observability-ui`.
2. **§8 step 1 of the original plan, pulled forward:** introduce a local `ColumnDef<T>` in
   `@agenta/ui/table` and make `ColumnsType` an adapter at the OSS boundary. 22 files, 167
   refs, mechanical, zero visual risk, independently landable. It does not port the table — it
   stops the type debt growing and unblocks every later table step. `assets/types.d.ts`'s antd
   import goes away with it.

### I — integration (serial, one agent, after all tracks)

Compose desktop from the new components, delete `Filters.tsx` / `Sort.tsx` / the antd bits of
`ObservabilityHeader`, run the gates, and do the browser pass. This is the only phase that
edits OSS call sites, which is why it cannot be parallel.

## 5. No-functionality-removal checklist

Everything in §5 of the original plan still applies. The chrome-specific additions:

**Filter dialog** — field menu with all 14 top-level nodes **and their icons** (host-injected
by label via `getFilterColumns(attrOptions, icons)`; verified working in the browser after WP2)
· nested group submenus · operator list driven by `planInputs` · value input shape per field
type (text / select / tags / range / none) · the attribute-key tree with its `treePath`
scoping · the annotation evaluator+feedback sub-row · multi-row add/remove · Clear · Cancel
discards, Apply commits · **the trace_type ↔ references-row label flip** (`reconcileFilterRows`,
already packaged with 10 unit tests — the dialog must keep calling it and must keep mutating by
index, since the reconciler preserves array length and order for exactly that reason).

**Sort** — 10 presets · custom start/end · `exclude` · label reflects the **actual applied
range** across tab switches and remounts (the defect above).

**Toolbar** — search with clear-on-empty · Root/LLM/All incl. the `span_type=chat` coupling and
the `tracing` cache purge · realtime All/Latest · auto-refresh 15s with progress bar and page-1
reset · manual refresh · export · delete · add-to-testset · add-to-queue.

## 6. Explicitly out of scope

- **The table** (`InfiniteVirtualTable`, 13,295 LOC / 12 antd runtime importers). T5 does step 1
  of its port only. Steps 2–4 stay scheduled in §8 of the original plan.
- **The trace drawer** (5,821 LOC / 21 antd files) — WP7 there.
- **The dashboard** (`AnalyticsDashboard`, `widgetCard`, `CustomAreaChart`) — WP8 there, and
  note `CustomAreaChart` drives colours off antd's `theme.useToken()`.
- **`EnhancedButton`** is the sanctioned button and is already antd-free; do not re-port it.

## 7. Appendix — re-measuring

```bash
cd web
# the two dialogs
wc -l oss/src/components/Filters/Filters.tsx oss/src/components/Filters/Sort.tsx   # 1983 / 318
# antd still in the observability page
grep -rn 'from "antd"\|from "@ant-design' oss/src/components/pages/observability
# the primitive set that already exists
ls packages/agenta-ui/src/components/ui/
# the preset picker to reuse, not rebuild
wc -l packages/agenta-home-ui/src/AnalyticsRangePicker.tsx                          # 54
# the deferred surfaces
find packages/agenta-ui/src/InfiniteVirtualTable -type f | xargs wc -l | tail -1    # 13295
grep -rl 'from "antd"' packages/agenta-ui/src/InfiniteVirtualTable | wc -l          # 12
find oss/src/components/SharedDrawers/TraceDrawer -type f | xargs wc -l | tail -1   # 5821
```

## 8. Claims worth not re-deriving

| Assumption | Reality |
| --- | --- |
| The chrome needs a big new primitive library | `@agenta/ui/ui` already has 35 antd-free primitives. Only `DateRangePicker` and possibly `TreeSelect` are missing |
| Sort's preset list must be built | `@agenta/home-ui/AnalyticsRangePicker` already renders it, antd-free, from the same `ANALYTICS_RANGE_PRESETS` |
| `Filters.tsx` is a 2k-line monolith | It has clean seams: helpers (1–270), popover shell (840+), generic row, annotation sub-row (938–1283). Four agents can work without touching each other |
| Desktop keeping antd is a valid end state | Only if `/m` never replaces oss+ee. It contradicts the stated target and guarantees two filter UIs |
| The sort label bug came from the package work | Pre-existing. `Sort.tsx` has always been uncontrolled with a hardcoded default; git-diffed to confirm |
