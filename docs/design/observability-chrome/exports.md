# Exports and dependencies to wire in phase I

Tracks append here instead of editing barrels or `package.json`. One section per track.
The integrator applies these during the serial integration phase.

## P0-A — `DateRangePicker` (`@agenta/ui`)

New file: `web/packages/agenta-ui/src/components/ui/date-range-picker.tsx`. Nothing else touched.

### Barrel export

`web/packages/agenta-ui/src/components/ui/index.ts` — append next to the `Cascader` line:

```ts
export {
    DateRangePicker,
    DateRangeCalendar,
    type DateRangeValue,
    type DateRangePickerProps,
    type DateRangeCalendarProps,
} from "./date-range-picker"
```

### Dependencies

**None added.** Date library decision: **dayjs**, imported as
`import {dayjs} from "@agenta/shared/utils/dateTime"`. `@agenta/shared` is already a
`dependencies` entry of `@agenta/ui`, that subpath is already in shared's `exports`, and it
pre-extends the `utc` plugin — so no `react-day-picker` and no new `package.json` line. The
`dateTime` subpath was chosen over the `@agenta/shared/utils` barrel to keep the module graph
small. Everything else is already in `@agenta/ui`: `@radix-ui/react-popover` (via `./popover`),
`lucide-react`, `@phosphor-icons/react`, and the local `Button` / `inputVariants` /
`selectTriggerVariants` / `cn`.

### Two entry points

- `DateRangePicker` — trigger (`selectTriggerVariants`, so it is dimensionally identical to
  Select/Cascader) + portaled `Popover` + the panel. Use standalone.
- `DateRangeCalendar` — **the panel alone**, no trigger and no portal. Use this inside an
  existing overlay; T2's `RangePicker` renders its custom branch inside the sort popover, and
  nesting a second portaled popover there is avoidable with this.

### Contract (for T2)

- `value: {startTime?: string; endTime?: string}` / `onChange(value)`. Exactly
  `SortResult["customRange"]`. Fully controlled — the only internal state is popover-open,
  hovered day, and visible month. *Which* end the next click fills is **derived** from `value`,
  so it cannot drift; there is no seeded-from-prop state (the `Sort.tsx:107` defect class).
- Strings are **UTC, second precision, no zone designator** — `2024-01-31T09:00:00` — byte
  identical to what `Sort.tsx` emits today (`dayjs(x).utc().toISOString().split(".")[0]`), so
  the query payload is unchanged. Parsed back with `dayjs.utc(...).local()`, verified lossless.
- Either side may be set alone (Sort allows start-only or end-only): clicking a day sets the
  start, the next click sets the end; the panel's per-side state is visible from the two time
  inputs, and `Clear` emits `{}`.
- Bounds: `minDate` / `maxDate`, same wire format. Out-of-range days render disabled.
- Other props: `showTime` (default `true`, HH:mm:ss via native `input type=time step=1`),
  `months` (`1 | 2`, default `2`), `weekStartsOn`, `hideClear` (drop the built-in Clear footer
  when the host supplies its own actions row — T2 will want this, since Sort owns Cancel/Apply),
  plus `size`/`variant`/`disabled`/`invalid`/`allowClear`/`placeholder`/`format`/`container` on
  the picker.

### Deliberately NOT included

No presets, no `exclude`, no label/`SortResult` shaping, no Apply/Cancel — all of that is T2's.
This component is a generic date-range input and imports nothing from observability.

## P0-B — `TreeSelect` (`@agenta/ui`)

**Verdict: cascader could NOT replace antd `TreeSelect`.** New primitive built —
`web/packages/agenta-ui/src/components/ui/tree-select.tsx`. Rationale in §"Why not cascader"
below.

### Barrel export

`web/packages/agenta-ui/src/components/ui/index.ts` — append next to the `Cascader` line:

```ts
export {TreeSelect, type TreeSelectOption, type TreeSelectProps} from "./tree-select"
```

### Dependencies

**None added.** The component uses only what `@agenta/ui` already depends on:
`react`, `@radix-ui/react-popover` (via `./popover`), `lucide-react`, `@phosphor-icons/react`,
and the local `selectTriggerVariants` / `cn`.

### Name collision to watch at integration

`Filters.tsx` currently imports `TreeSelect` **and** `type TreeSelectProps` from `antd`. Both
names are reused by this primitive with different shapes — `treeData` items are
`TreeSelectOption`, not antd's `DataNode`. Delete the antd import; do not alias one over the
other.

### Call-site mapping (for T3, `Filters.tsx:1338–1499`)

| antd prop | here |
| --- | --- |
| `treeData` (from `mapToTreeData`) | `treeData`, items `{value, label, children, searchLabel, displayLabel, selectable, disabled}` |
| node `title` | `label` |
| `treeNodeLabelProp="pathLabel"` | per-option `displayLabel={pathLabel}` |
| `treeNodeFilterProp` / `filterTreeNode` (title \| value \| pathLabel) | per-option `searchLabel={pathLabel}`; `value` is always matched too, and `value` = `attributes.${pathLabel}`, so one field covers all three |
| `value` / `onChange(v)` | `value` / `onChange(v, option)` — same scalar, `v` is `undefined` when cleared |
| `onSearch` | `onSearch` — fires on every keystroke **and with `""` on close**, so the existing `onDropdownVisibleChange` clear-the-term handler is no longer needed |
| `treeDefaultExpandAll` + frozen `treeExpandedKeys` + `onTreeExpand={noop}` | `defaultExpandAll` — expands every branch, and keeps *newly arriving* branches expanded without undoing a manual collapse (so `collectTreeKeys` / `noopTreeExpand` can be dropped) |
| `treeLine={{showLeafIcon: false}}` | `showLine` (default `true`) |
| `dropdownMatchSelectWidth={false}` + popup `minWidth: 260` | `panelMinWidth={260}` |
| `getPopupContainer={(t) => getWithinPopover(t)}` | `container={…}` (portal target) |
| `showSearch` | `showSearch` (default `true`) |
| `placeholder` / `disabled` | same |
| `className="w-[260px]"` | same — the trigger takes `className` |

`mapToTreeData` / `buildCustomTreeNode` in
`web/oss/src/components/Filters/helpers/utils.ts` need a small rewrite for the new option shape
(`title` → `label`, keep `pathLabel` as both `searchLabel` and `displayLabel`, drop `key`). They
are pure — T3 should move them to `@agenta/observability/filters` alongside the other packaged
helpers. `collectTreeKeys` and `noopTreeExpand` become dead.

### Why not cascader

Recorded so nobody re-litigates it. Cascader fails on four independent requirements of the real
call site:

1. **Panel shape.** The call site renders the tree *fully expanded, inline, with tree lines*
   (`treeDefaultExpandAll` + frozen `treeExpandedKeys`) so any attribute key is one click away.
   Cascader is structurally multi-column drill-down — one level visible at a time. For the
   unscoped `ag` tree that turns a single click into three or four.
2. **No `onSearch`.** The dialog injects a **synthetic node built from the live search text**
   (`normalizeAttributeSearch` + `buildCustomTreeNode`) so a user can filter on an attribute key
   that is absent from the loaded traces. Cascader keeps its query in private state and exposes
   no `onSearch`, so the host can never see the typed text. Adding one would mean editing
   `cascader.tsx`, which is outside this track's ownership.
3. **Value shape.** antd `TreeSelect` commits ONE node value; option values here are already
   full dotted paths (`attributes.ag.data.inputs.country`). Cascader commits a `string[]` path,
   so every call site would need a scalar↔path adapter in both directions.
4. **Selectable branches.** Every node in `buildAttributeKeyTreeOptions` is selectable
   (`addPath` marks every segment). Cascader only commits a branch under `changeOnSelect`, and
   that mode also keeps the panel open on commit — a different interaction from
   select-and-close. Its per-node `selectable` has no cascader equivalent either (`disabled`
   blocks expansion as well as selection).

Cosmetics that would also have drifted: cascader's search renders `a / b / c`, hard-coded, where
this control shows the dotted `pathLabel`; and its trigger display has no `treeNodeLabelProp`
equivalent, only a `displayRender` the call site would have to supply.

### Notes for T3

- The primitive is **controlled**: `value` in, `onChange` out. It holds no selection state.
- Expansion is internal by default; pass `expandedKeys` + `onExpandedKeysChange` only if a call
  site genuinely needs to own it. `defaultExpandAll` is the parity path for this dialog.
- While searching, the tree filters in place (matches **plus their ancestors**) and force-expands
  — matching antd, not cascader's flat hit list.
- Keyboard: Up/Down over visible rows (skips disabled, wraps), Right expand/descend, Left
  collapse/ascend, Home/End, Enter select (or toggle a non-selectable branch), Escape close,
  Backspace clear when `allowClear`.

## T1 — `ObservabilityToolbar` (`@agenta/observability-ui`)

New directory: `web/packages/agenta-observability-ui/src/toolbar/`. Nothing outside it touched.

```
toolbar/ObservabilityToolbar.tsx   the composed section + the three slots
toolbar/ToolbarSearch.tsx          search box, clear-on-empty, Enter commits `content`
toolbar/TraceTabsControl.tsx       Root / LLM / All + the span_type=chat coupling + cache purge
toolbar/RealtimeModeControl.tsx    All activity / Latest activity (sessions)
toolbar/AutoRefreshControl.tsx     switch + the 100ms-ticked progress bar (ported verbatim)
toolbar/ToolbarButtons.tsx         RefreshButton, ExportButton, DeleteTracesButton
toolbar/filterControls.ts          useUpdateFilter, useDropFilterField, useToolbarFilterSync
toolbar/useLazyEffect.ts           typed port of oss/src/hooks/useLazyEffect (that one is `any`)
toolbar/state.ts                   hasTracesAtom — boolean view of tracesAtom
toolbar/constants.ts               AUTO_REFRESH_INTERVAL
toolbar/index.ts                   sub-module index (new file, not the package barrel)
```

### Barrel export

`web/packages/agenta-observability-ui/src/index.ts` — append a section:

```ts
// ============================================================================
// TOOLBAR
// ============================================================================
export {
    ObservabilityToolbar,
    type ObservabilityToolbarProps,
    AutoRefreshControl,
    type AutoRefreshControlProps,
    ToolbarSearch,
    TraceTabsControl,
    RealtimeModeControl,
    RefreshButton,
    ExportButton,
    DeleteTracesButton,
    type RefreshButtonProps,
    type ExportButtonProps,
    type DeleteTracesButtonProps,
    AUTO_REFRESH_INTERVAL,
    hasTracesAtom,
    useUpdateFilter,
    useDropFilterField,
    useToolbarFilterSync,
    type FilterUpdate,
} from "./toolbar"
```

Everything below `ObservabilityToolbar` is optional surface — export at least
`ObservabilityToolbar` and `AUTO_REFRESH_INTERVAL` (see the constant note below).

### Dependencies

**None added.** Uses only what `@agenta/observability-ui` already declares: `@agenta/observability`,
`@agenta/shared`, `@agenta/ui` (subpaths `/ui` and `/components/presentational`),
`@phosphor-icons/react`, `clsx`, `jotai`, `react`.

`jotai-tanstack-query` was deliberately NOT added. The original read the client with
`useAtomValue(queryClientAtom)`; the port calls `getHostQueryClient()` from `@agenta/shared/api`
per web/CLAUDE.md's host contract. Equivalent here because the observability page store *is* the
default store (see `SessionsTable`'s `useStore()` comment).

### Props contract

```tsx
<ObservabilityToolbar
    componentType="traces" | "sessions"
    isLoading={…}
    onRefresh={…}          // required; host owns what refresh means
    refreshTrigger={…}     // host tick; falls back to the toolbar's own counter
    onExport={…}           // omit to hide the button — this is the canExportData gate
    isExporting={…}
    onDelete={…}           // omit to hide the button
    filtersSlot={…}        // T3's FilterDialog
    sortSlot={…}           // T2's RangePicker
    actionsSlot={…}        // OSS-only AddActionsDropdown
/>
```

The host keeps: the export pipeline, `DeleteTraceModal` + `deleteTraceModalAtom`,
`useBatchAddTracesToQueue`, the add-all-matching confirm, `AddActionsDropdown`, and
`getTestsetTraceData`. None of it is reimplemented in the package.

Dropped props (now read from `@agenta/observability` atoms): `realtimeMode` / `setRealtimeMode`
(`realtimeModeAtom`), `autoRefresh` / `setAutoRefresh` (`autoRefreshAtom`), and `columns` (only
the OSS export pipeline needed it).

### Integration note — `AUTO_REFRESH_INTERVAL`

`web/oss/src/components/pages/observability/constants.ts` still exports its own copy, imported by
`ObservabilityTable` and `SessionsTable`. The value must equal the toolbar's or the progress bar
drifts out of step with the reload. At integration, point those two files at the packaged constant
and delete the OSS one (or pass `intervalMs` to `AutoRefreshControl`).

## T4 — `AnnotationFilterRow` (`@agenta/observability-ui`)

New file: `web/packages/agenta-observability-ui/src/filters/AnnotationFilterRow.tsx`. Nothing
else touched — no barrel edit, no `package.json` edit, no OSS file read-only aside.

### Barrel export

`web/packages/agenta-observability-ui/src/index.ts` — append a section:

```ts
// ============================================================================
// FILTERS
// ============================================================================
export {
    AnnotationFilterRow,
    AnnotationEvaluatorControl,
    AnnotationFeedbackControl,
    AnnotationFilterLabel,
    useAnnotationFilterRow,
    ALL_FEEDBACK_OPERATOR_OPTIONS,
    buildAnnotationFeedbackOptions,
    dedupeAnnotationFeedbackOptions,
    deriveFeedbackValueType,
    type AnnotationFilterRowProps,
    type AnnotationFilterRowState,
    type AnnotationFilterValue,
    type AnnotationFeedbackCondition,
    type AnnotationFeedbackOption,
    type AnnotationFeedbackScalar,
    type AnnotationFeedbackValue,
    type AnnotationFeedbackValueType,
    type AnnotationEvaluatorOption,
} from "./filters/AnnotationFilterRow"
```

### Dependencies

**None added.** Uses only what `@agenta/observability-ui` already declares: `react`,
`@agenta/entities` (type-only, `@agenta/entities/workflow` → `EvaluatorFeedbackSchema`),
`@agenta/observability` (`NUM_OPS`, `STRING_EQU_AND_CONTAINS_OPS`, `STRING_EQU_OPS`,
`FilterConditions`), `@agenta/ui/ui`, `@agenta/ui/components/presentational` (`EnhancedButton`),
`@agenta/ui/styles` (`cn`), `@phosphor-icons/react`.

### Three entry points (layout is T3's, not mine)

The original renders this feature in **two** places: the evaluator control inline on the
field/operator line (`Filters.tsx:1560–1611`), the feedback control on a second line
(`1763–1907`). So it is exported in halves, not as one block:

- `AnnotationEvaluatorControl` — inline half. Evaluator `Combobox` + trash, or the
  "Add Evaluator" / "Add Feedback" buttons.
- `AnnotationFeedbackControl` — second-line half. The feedback row, or the "Add Feedback"
  button, or `null` when neither sub-condition is active.
- `AnnotationFilterRow` — the two stacked in a `flex-col`, for callers that don't need them apart.
- `useAnnotationFilterRow` — every handler and derivation, layout-free, if T3 wants to render
  its own markup. Both controls call it internally; calling it again is cheap and safe.

All four take the same `AnnotationFilterRowProps`.

### Props contract

```tsx
<AnnotationEvaluatorControl
    value={annotationValue}          // AnnotationFilterValue | undefined  (the row's value[0])
    onChange={next => onFilterChange({columnName: "value", value: next ? [next] : [], idx})}
    onRemoveRow={() => onDeleteFilter(idx)}
    evaluatorOptions={…}             // {label: evaluator.name || slug, value: slug}[]
    feedbackOptions={…}              // AnnotationFeedbackOption[] — see below
    disabled={item.isPermanent}
    container={dialogEl}             // portal target for the dropdown panels
/>
```

**`onChange(undefined)` means "clear this row's value"** — the dialog stores `[]`. `onChange(v)`
means store `[v]`. That is exactly the original `setAnnotationValue`, which also applies the
`feedback.valueType ??= "string"` default before handing the value over. Keep the dialog's
by-index mutation as-is; nothing here touches row order.

`onRemoveRow` fires where the original called `onDeleteFilter(idx)`: removing the evaluator when
there is no feedback, or removing the feedback when there is no evaluator.

### Wiring the two option lists (the only thing T3/I must supply)

The component reads **no atoms** — deliberate, so it stays testable and mobile-safe. The
integrator supplies:

```tsx
// in the dialog (OSS or T3's FilterDialog), unchanged from Filters.tsx:278–322
useEnsureEvaluatorEnrichment()                                   // @agenta/entity-ui/selection
const evaluatorPreviews = useAtomValue(evaluatorsListDataAtom)   // @agenta/entities/workflow
const schemas = useAtomValue(evaluatorFeedbackSchemasAtom)       // @agenta/entities/workflow

const evaluatorOptions = useMemo(
    () => (evaluatorPreviews ?? []).map(e => ({label: e.name || e.slug, value: e.slug})),
    [evaluatorPreviews],
)
const feedbackOptions = useMemo(() => buildAnnotationFeedbackOptions(schemas), [schemas])
```

`buildAnnotationFeedbackOptions` (exported here) is the ported
`annotationFeedbackOptions` derivation, retyped off `any`. `useEnsureEvaluatorEnrichment` stays
in the dialog because `@agenta/observability-ui` does not depend on `@agenta/entity-ui` and this
track was not going to add a dependency for one hook — **that gate is load-bearing: without it
`evaluatorFeedbackSchemasAtom` returns an empty array and the feedback picker has no options.**

### Behaviour preserved (Filters.tsx parity)

- `handleEvaluatorChange` drops feedback keys the newly selected evaluator does not own (array →
  first surviving key; scalar → `undefined`); clearing the evaluator keeps the feedback and turns
  the row into "any evaluator".
- `handleFeedbackFieldChange` narrows to a single key when an evaluator is selected, re-derives
  `valueType` from the picked option, re-runs `ensureFeedbackOperator`, and resets the value
  (`true` for boolean, `""` otherwise).
- `handleFeedbackOperatorChange` forces `valueType: "number"` for the numeric operators and
  coerces the current value.
- `handleFeedbackValueChange` keeps the JSON-array escape hatch (`"[1, 2]"` → `[1, 2]`) and the
  string/number/boolean coercions.
- `availableFeedbackOptions` scopes by evaluator (keeping an out-of-scope selected key visible)
  and dedupes across evaluators when there is none.
- `feedbackOptionsForSelect` keeps already-selected custom keys labelled and prepends the
  currently-typed text as `"<typed> (custom)"`.
- The **multi-select** feedback picker for "any evaluator" rows is preserved (antd
  `mode="multiple"`), including the search-then-Enter custom key.
- The `Add Evaluator` / `Add Feedback` affordances appear exactly where they did: both inline when
  neither sub-condition is active, `Add Feedback` on the second line once the evaluator exists.

### Two things the plan/ownership table did not cover

1. **`@agenta/ui/ui` has no multi-select.** `Select` is single + no search; `Combobox` is single
   + search but exposes **no `onSearch`**, which the "type a custom feedback key" affordance needs
   (the dialog synthesises an option from the live query). So a private `FeedbackFieldPicker`
   (searchable single **and** multi, controlled search) lives inside this file. It is ~150 lines
   on `Popover` + `selectTriggerVariants`, so it is dimensionally identical to the other controls.
   **If a `MultiCombobox` is ever added to `@agenta/ui`, this is the call site to collapse** —
   the file was not allowed to touch `@agenta/ui` (P0's ownership).
2. **The `"That"` label** (`Filters.tsx:1521–1528`) sits between the key input and the operator
   select, i.e. inside T3's row markup. `AnnotationFilterLabel` is exported for it (and is what
   renders `"Feedback"` here) so both use one secondary-text style.

### Deliberate deviations (both tiny, both improvements)

- `parseFeedbackArrayInput` now requires every array member to be a scalar; `"[{\"a\":1}]"` stays
  a plain string instead of being sent as an object array. The old code typed it `any[]`.
- The boolean value select maps anything that is not `false` to `true` (antd received the raw
  value and fell back to `true`). Same visible result, no `any`.

### Gates

`pnpm --filter @agenta/observability-ui exec tsc --noEmit` → exit 0 ·
`eslint --config ./eslint.config.mjs src/filters/AnnotationFilterRow.tsx` → exit 0 ·
`pnpm --filter @agenta/oss exec tsc --noEmit` → exit 0 · antd grep over
`packages/agenta-observability-ui/src` → empty. No `any` in the file.

`pnpm turbo run build lint --filter=@agenta/observability-ui` currently fails **upstream, not
here**: `@agenta/observability` lint (T3's `filters/dialogHelpers.ts:685` prettier) and
`@agenta/ui` build+lint (P0's in-flight files). Both are other tracks' working trees.

There is no unit test: `@agenta/observability-ui` has no `test` script and no `tests/` directory,
and adding either means editing `package.json` — out of bounds for this track. The pure helpers
(`deriveFeedbackValueType`, `buildAnnotationFeedbackOptions`, `dedupeAnnotationFeedbackOptions`)
are exported and side-effect-free, so they are ready for tests once the integrator adds the
harness.

## T2 — `RangePicker` (`@agenta/observability-ui`)

New files, nothing else touched except the one re-export noted under "home-ui" below:

```
packages/agenta-observability-ui/src/range/RangePicker.tsx              (the control)
packages/agenta-observability-ui/src/range/ObservabilityRangePicker.tsx (sortAtom-bound)
packages/agenta-observability-ui/src/range/AnalyticsRangePicker.tsx     (moved from home-ui)
packages/agenta-observability-ui/src/range/rangeResolution.ts           (pure helpers)
```

### Barrel export

`web/packages/agenta-observability-ui/src/index.ts` — append:

```ts
// ============================================================================
// RANGE PICKER
// ============================================================================
export {RangePicker, type RangePickerProps} from "./range/RangePicker"
export {
    ObservabilityRangePicker,
    type ObservabilityRangePickerProps,
} from "./range/ObservabilityRangePicker"
export {AnalyticsRangePicker, type AnalyticsRangePickerProps} from "./range/AnalyticsRangePicker"
export {
    ALL_TIME_SENTINEL,
    formatRangeLabel,
    presetRowLabel,
    resolveCustomRange,
    resolvePresetRange,
    selectedRangeLabel,
    type CustomRange,
} from "./range/rangeResolution"
```

### Dependencies — one REQUIRED package.json change

`web/packages/agenta-home-ui/package.json` `dependencies` must gain:

```json
"@agenta/observability-ui": "workspace:../agenta-observability-ui",
```

`AnalyticsRangePicker` moved to `observability-ui/src/range/`, and
`agenta-home-ui/src/AnalyticsRangePicker.tsx` is now a one-line re-export from
`@agenta/observability-ui` (kept as a file because `UsageCard.tsx` and `home-ui/src/index.ts`
both address it by that path, and neither is editable from this track). **Without the dependency
line + `pnpm install`, `@agenta/home-ui` does not typecheck.** No new third-party dependency:
`@agenta/observability-ui` already depends on `@agenta/observability`, `@agenta/ui` and
`@phosphor-icons/react`, and takes `jotai` as a peer.

> Verified locally by symlinking `agenta-home-ui/node_modules/@agenta/observability-ui →
> ../../../agenta-observability-ui` (exactly what pnpm creates once the dep is declared). **That
> symlink is still in place in this worktree** so `home-ui` typechecks today; `pnpm install` will
> remove it, so land the dependency line.

### Depends on P0-A

`RangePicker` imports `DateRangeCalendar` (the panel, no trigger, no portal) and
`type DateRangeValue` from `@agenta/ui/ui`, so **P0-A's barrel line must land** for this to
compile. Nesting a second portaled `DateRangePicker` inside the sort popover was avoided, exactly
as P0-A's contract suggests.

### Call-site mapping (for integration)

`ObservabilityRangePicker` is a drop-in for `Sort` on the observability toolbar and takes no
`value`/`onChange` — it reads and writes `sortAtom`:

```tsx
// ObservabilityHeader:612 (plan.md says 685; it is 612 on this tip)
- <Sort onSortApply={onSortApply} defaultSortValue="24 hours" />
+ <ObservabilityRangePicker />
```

`onSortApply` (`ObservabilityHeader:285`) currently calls `setSort` plus a page reset; if the
reset is still wanted, keep it as an effect/subscription on `sortAtom` rather than a callback —
the picker no longer emits one. `defaultSortValue` is gone: the readout is derived from the atom.

The other three call sites keep their own atom, so they use the presentational `RangePicker`
with `value`/`onChange` (props map 1:1 onto the antd `Sort` props):

| Sort call site | replacement |
| --- | --- |
| `UsageSummary/index.tsx:72` | `<RangePicker type="text" exclude={["all time"]} ariaLabel="Usage date range" fallbackLabel="1 month" value={timeRange} onChange={setTimeRange} />` |
| `dashboard/AnalyticsDashboard.tsx:76` | same, plus `disabled={loading \|\| isFetching}` |
| `EvaluationRunsTablePOC/.../QuickDateRangePicker.tsx:133` | `<RangePicker value={…} onChange={handleSortApply} />` — and **delete its `key={sortComponentKey}` remount hack and its private 10-entry `SORT_PRESETS` copy**; both existed only to force the uncontrolled `Sort` to re-seed. `detectSortValue` is still needed to turn its `{from,to,preset}` shape into a `SortResult`. |

`Sort`'s `type` prop (`"link" \| "text" \| "default" \| "primary" \| "dashed"`) is preserved
verbatim and forwarded to `EnhancedButton`, which maps it. `exclude`, `disabled` and `ariaLabel`
are unchanged. `defaultSortValue` becomes `fallbackLabel` and means something narrower: the label
shown when the applied window carries **no** label (`DEFAULT_SORT` is a real 24h window with no
`label` field). It never overrides a labelled range, which is what made the original defect
possible.

### Two things the plan did not have right

1. **`resolveRangePreset("all time")` returns `sorted: ""`, but `Sort.tsx:127` emitted
   `"1970-01-01T00:00:00"`.** Not cosmetic: `fetchDashboardAnalytics` does
   `dayjs(range.sorted)` and throws `Invalid startTime` on `""`, so an "all time" pick routed at
   the dashboard would have crashed the query. `range/rangeResolution.ts` re-applies the epoch
   sentinel (`ALL_TIME_SENTINEL`) on top of `resolveRangePreset`, so the emitted payload stays
   byte-identical to the antd original. The preset arithmetic itself is still
   `resolveRangePreset` — nothing was re-derived. Fixing this inside
   `@agenta/observability/core/presets.ts` instead would be cleaner but belongs to whoever owns
   that file.
2. **There are four `Sort` call sites, not one.** `plan.md` §4 T2 only mentions the observability
   header. `UsageSummary`, `AnalyticsDashboard` and `QuickDateRangePicker` all render it against
   their own atoms, which is why `RangePicker` is presentational and `ObservabilityRangePicker`
   is the thin atom-bound wrapper — one component, three bindings, no duplicated preset list.

### Behaviour notes

- **Home's trigger changes from `DropdownMenu` to `Popover`** (one control cannot be both: a
  `DropdownMenu` steals typing for typeahead, which breaks the calendar's time inputs). Visually
  identical — the trigger classes, icon sizes and `aria-label` are carried over verbatim — but
  the menu's roving arrow-key focus becomes plain Tab order over `role="menuitemradio"` buttons.
- The custom panel renders **one** month (`calendarMonths` prop, `1 | 2`) to stay near the antd
  popover's 536px footprint. `hideClear` is set because Sort owns Cancel/Apply.
- Cancel discards the draft; the draft is re-seeded from the applied value on every open, so a
  discarded edit never lingers and a custom range re-opens on the panel that produced it.

### Handoff state of the gates (T2)

With the barrel lines above applied temporarily, `@agenta/oss` `tsc --noEmit` exits **0** and
`src/range` is clean under `tsc` and `eslint`. With them reverted (the state this track hands
over), OSS `tsc` reports exactly two errors, both the same missing-barrel-member signature:

```
../packages/agenta-home-ui/src/AnalyticsRangePicker.tsx(6,9):  TS2305 … no exported member 'AnalyticsRangePicker'
../packages/agenta-home-ui/src/AnalyticsRangePicker.tsx(6,36): TS2305 … no exported member 'AnalyticsRangePickerProps'
```

They disappear with the `observability-ui` barrel line. No other signature changed.

### T4 addendum — the T3 type overlap (read before wiring)

T3 landed the same three types in the ENGINE package while this track ran:
`AnnotationFilterValue`, `AnnotationFeedbackCondition`, `AnnotationFeedbackValueType` in
`web/packages/agenta-observability/src/filters/dialogHelpers.ts` (alongside
`extractAnnotationValue`). That is the better home. This file declares its own copies because it
may not import from a module the `@agenta/observability` barrel does not export yet.

They were made **structurally identical on purpose** — `AnnotationFeedbackCondition["value"]` here
is aliased to the engine's `FilterValue`, exactly as T3 types it — so
`extractAnnotationValue(item.value)` flows straight into the `value` prop and `onChange`'s
argument flows back out, with no cast in either direction.

At integration, once `dialogHelpers` is exported from `@agenta/observability/filters`, delete the
three local declarations here and re-point them at the engine's:

```ts
import type {
    AnnotationFeedbackCondition,
    AnnotationFeedbackValueType,
    AnnotationFilterValue,
} from "@agenta/observability"
```

Keep `AnnotationFeedbackOption`, `AnnotationEvaluatorOption`, `AnnotationFeedbackScalar` and
`AnnotationFilterRowProps` here — they are UI-layer shapes with no engine equivalent.

Second overlap, lower stakes: T3's `filters/FilterTagsInput.tsx` is a multi-VALUE tags input
(antd `mode="tags"`, free text commits as a tag) and T4's private `FeedbackFieldPicker` is a
multi-OPTION picker (antd `mode="multiple"` + a synthesised custom option from the live query).
Different semantics, same missing primitive underneath. If a `MultiCombobox` ever lands in
`@agenta/ui/ui`, both collapse onto it — that is the consolidation to do, not merging the two
current files into each other.

## T3 — `FilterDialog` + `FilterRow` (`@agenta/observability-ui`) and `dialogHelpers` (`@agenta/observability`)

New files, nothing else touched:

```
packages/agenta-observability/src/filters/dialogHelpers.ts        the pure half
packages/agenta-observability/tests/unit/dialogHelpers.test.ts    35 unit tests
packages/agenta-observability-ui/src/filters/FilterDialog.tsx     popover shell
packages/agenta-observability-ui/src/filters/FilterRow.tsx        generic row + annotation slot
packages/agenta-observability-ui/src/filters/FilterTagsInput.tsx  antd `Select mode="tags"` stand-in
```

### Barrel exports — ONE file for the helpers, ONE for the components

`web/packages/agenta-observability/src/filters/index.ts` — append. The components import from
the `@agenta/observability/filters` **subpath**, deliberately, so the ROOT barrel needs no change:

```ts
export {
    CUSTOM_FIELD_VALUE,
    createEmptyFilter,
    toStringValue,
    collectOptionValues,
    valueToPathLabel,
    normalizeAttributeSearch,
    isNumberLike,
    isBooleanLike,
    getOptionKey,
    findFirstLeafValue,
    hasLeafWithValue,
    getGroupDefaultValue,
    customOperatorIdsForType,
    operatorOptionsFromIds,
    effectiveFieldForRow,
    mapToTreeData,
    buildCustomTreeNode,
    buildKeyTreeData,
    extractAnnotationValue,
    collapseAnnotationAnyEvaluatorRowsFromProps,
    explodeAnnotationAnyEvaluatorRows,
    buildFieldMenuItems,
    resolveFieldForFilter,
    mapFilterData,
    sanitizeFilterItems,
    selectSendableRows,
    validateFilterRow,
    filtersEqual,
    type FilterFieldMap,
    type FilterTreeOption,
    type AnnotationFeedbackValueType,
    type AnnotationFeedbackCondition,
    type AnnotationFilterValue,
    type FieldMenuEntry,
    type FieldMenuLeafEntry,
    type FieldMenuGroupEntry,
    type BuildFieldMenuOptions,
} from "./dialogHelpers"
```

`web/packages/agenta-observability-ui/src/index.ts` — append a `FILTERS` section:

```ts
export {FilterDialog, type FilterDialogProps} from "./filters/FilterDialog"
export {
    FilterRow,
    type FilterRowProps,
    type FilterRowColumn,
    type AnnotationRowSlot,
    type AnnotationRowContext,
} from "./filters/FilterRow"
export {FilterTagsInput, type FilterTagsInputProps, type FilterTagValue} from "./filters/FilterTagsInput"
```

**`FilterRow.tsx` imports `TreeSelect` from `@agenta/ui/ui`, so P0-B's barrel line is a hard
prerequisite** — `@agenta/observability-ui` does not typecheck until it lands.

### Dependencies

**None added**, in either package. `dialogHelpers.ts` imports only from its own package;
the components use `@agenta/observability`, `@agenta/ui/ui`,
`@agenta/ui/components/presentational`, `@phosphor-icons/react`, `clsx` and `react` — all
already `dependencies`. `lodash/isEqual` was replaced by a local `filtersEqual` (same
`undefined` semantics as lodash: `filtersEqual([], undefined) === false`) rather than adding
lodash to the package.

### What T4 must consume (`AnnotationFilterRow.tsx`)

T4 does not import `FilterRow.tsx`'s internals; it exports an object matching this contract and
the integrator passes it as `<FilterDialog annotationRow={…} />`:

```ts
interface AnnotationRowContext {
    index: number                                              // rows are mutated BY INDEX
    item: FilterItem
    value: AnnotationFilterValue | undefined                   // already parsed for you
    onChange: (next: AnnotationFilterValue | undefined) => void // undefined clears the row value
    onRemoveRow: () => void
    container: HTMLElement | null                              // portal target = the dialog popover
    disabled: boolean
}

interface AnnotationRowSlot {
    renderInline: (ctx) => ReactNode      // tail of the main line (where the value input sits)
    renderBelow?: (ctx) => ReactNode      // the second line (feedback sub-row)
    hidesRowDelete?: (ctx) => boolean     // true while the slot owns its own removal buttons
}
```

`onChange` already applies the original's normalization: it stores `[value]`, defaults
`feedback.valueType` to `"string"`, and writes `[]` when handed `undefined`. The
`AnnotationFilterValue` / `AnnotationFeedbackCondition` / `AnnotationFeedbackValueType` types
and `extractAnnotationValue` are in `dialogHelpers.ts` — T4 should import them from there
rather than redeclaring. `ALL_FEEDBACK_OPERATOR_OPTIONS` / `NUMERIC_FEEDBACK_OPERATOR_VALUES`
stay T4's (they are built from `NUM_OPS` / `STRING_EQU_AND_CONTAINS_OPS`, already packaged).

Without `annotationRow`, annotation rows fall back to the generic value input — the dialog
compiles and runs standalone.

### Notes for the integrator

- `columns` must be built by `getFilterColumns(attributeKeyOptions, icons)`; the dialog reads
  `node.icon`. The extra `icons` prop is only a by-label fallback for icon-free columns.
- `reconcileFilterRows` stays a **prop** (the host binds `workflowKind` + the field map). The
  dialog renders from its return value and still mutates by index — the length/order contract
  is unchanged.
- `buttonProps` is now `EnhancedButtonProps` (antd-shaped, so existing call sites compile);
  pass `trigger` to replace the funnel button outright.
- The count badge is `bg-foreground` / `text-background`, not antd's hardcoded `#000000`, so it
  stays legible in dark mode. That is a deliberate (small) visual change.
