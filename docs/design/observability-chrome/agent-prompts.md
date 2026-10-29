# Agent prompts — copy-paste dispatch

Ready-to-send prompts, one per track. Each is self-contained: an agent with no conversation
context can execute it.

**Dispatch order:** Wave 1 (P0-A + P0-B together) → Wave 2 (T1 + T2 + T3 + T4 together) →
Wave 3 (I, alone). T5 anytime **except** during Wave 3.

**Prepend this preamble to every prompt:**

> You are working in the Agenta monorepo at
> the repository worktree you were started in, on
> branch `obs/wp3-observability-ui`. Frontend lives under `web/`.
>
> Before you start, read: `docs/design/observability-chrome/plan.md`,
> `docs/design/observability-chrome/KICKOFF.md` §1–§2 and §5, and `web/CLAUDE.md`.
>
> **Hard rules.** (1) You create NEW files inside `web/packages/**` only. Do not edit any file
> under `web/oss/` or `web/ee/` — all app rewiring happens later in a serial phase. (2) Do not
> edit any package's `index.ts` barrel or `package.json`; instead append the exports and
> dependencies you need to `docs/design/observability-chrome/exports.md` (create it if absent,
> one section per track). (3) Packages ban `any` — `@typescript-eslint/no-explicit-any` is an
> error and these packages currently have zero. (4) Never rewrite imports with a path-suffix
> regex; anchor on the full specifier. (5) Reuse before building: `EnhancedButton`, the 35
> primitives in `web/packages/agenta-ui/src/components/ui/`, and the packaged engine functions
> already exist and are tested.
>
> **Verify with:** `cd web && pnpm turbo run build lint --filter=@agenta/<pkg>` and
> `pnpm --filter @agenta/oss exec tsc --noEmit > /tmp/t.txt 2>&1; echo "exit=$?"` — capture `$?`
> into a file, never pipe tsc to `head`/`grep` and read the exit code, you get the pipe's status.
>
> **Report back:** what you created, the exports/deps you appended, anything the plan got wrong,
> and anything you could not do without touching a forbidden file.

---

## P0-A · DateRangePicker

> Build `DateRangePicker` at
> `web/packages/agenta-ui/src/components/ui/date-range-picker.tsx`.
>
> It replaces antd's `DatePicker` (used twice) in
> `web/oss/src/components/Filters/Sort.tsx` — **read that file's custom-range branch first** to
> see exactly what behaviour is required. Do not edit it.
>
> Requirements:
> - Emits `{startTime?: string; endTime?: string}` as ISO strings — the shape
>   `SortResult["customRange"]` already uses (see `@agenta/observability` `core/types.ts`).
> - Controlled: takes the current value and an `onChange`. No internal state that can drift
>   from the caller.
> - Range selection with a start and an end, optional min/max bounds, and a clear affordance.
> - Match the conventions of the sibling files in that directory: Radix where a primitive fits,
>   `cn` from `../../utils/styles`, semantic tokens (`text-colorText`, `bg-colorBgContainer`,
>   …) — **never** `--ant-color-*` and never `border-0 border-b`, both break on mobile.
> - Works in light and dark; the packages are theme-agnostic and inherit from the host.
>
> **Decision you own:** `@agenta/ui` has no date library today. `dayjs` is used repo-wide (it is
> re-exported from `@agenta/shared/utils`). Prefer a dayjs-backed calendar over adding
> `react-day-picker`. Whichever you choose, justify it in a one-line comment and state the
> dependency in your report — do not add one silently.
>
> Scope guard: this component knows nothing about observability, sorting, or filters. It is a
> generic date-range input.

---

## P0-B · Attribute-key tree input (decide first, build only if needed)

> **Your first deliverable is a decision, not code.**
>
> Determine whether `web/packages/agenta-ui/src/components/ui/cascader.tsx` can replace antd's
> `TreeSelect` at `web/oss/src/components/Filters/Filters.tsx:1395`.
>
> Read both files, plus `AttributeKeyTreeOption` and `buildAttributeKeyTreeOptions` in
> `web/packages/agenta-observability/src/filters/attributeKeyOptions.ts`.
>
> The requirement, from the real usage: render an arbitrarily nested tree of attribute keys,
> searchable, single-select, with a `treePath` that scopes the visible branch (see
> `getFilterColumns` in the same package for how `treePath` narrows the options).
>
> - **If cascader covers it:** write no component. Report exactly how the call site should use
>   it, including any props gap, and stop.
> - **If it cannot:** build `web/packages/agenta-ui/src/components/ui/tree-select.tsx` following
>   the conventions of its siblings. Controlled, searchable, keyboard-navigable, semantic tokens.
>
> Report which way you went and why. This decision is the whole point of the task — a wrong
> "build it" costs a duplicate primitive.

---

## T1 · ObservabilityToolbar

> Create `web/packages/agenta-observability-ui/src/toolbar/` containing `ObservabilityToolbar`
> and its sub-controls, ported from the antd original at
> `web/oss/src/components/pages/observability/components/ObservabilityHeader/index.tsx`
> (743 LOC). **Read it fully before writing.** Do not edit it.
>
> Port these, antd-free:
> - search input (with clear-on-empty behaviour)
> - Root / LLM / All segmented control
> - realtime All activity / Latest activity segmented control
> - `AutoRefreshControl` — the switch **and its progress-bar animation, verbatim**; this is the
>   one piece of visual behaviour that is easy to lose
> - refresh button, export button, delete button
>
> Every antd component you need already exists in `@agenta/ui/ui` (`segmented`, `switch`,
> `input`, `button`) or as `EnhancedButton` in `@agenta/ui/components/presentational`. Import
> via subpaths — the `@agenta/ui` root barrel is eslint-banned in this package because it
> re-exports antd-backed components.
>
> Everything not portable is a **slot** the host fills:
>
> ```tsx
> <ObservabilityToolbar filtersSlot={…} sortSlot={…} actionsSlot={…} />
> ```
>
> The export pipeline, delete-modal wiring, `useBatchAddTracesToQueue` and the
> add-all-matching confirm stay in the app and arrive as callbacks — take them as props, do not
> reimplement them.
>
> State comes from `@agenta/observability` (`searchQueryAtom`, `traceTabsAtom`,
> `realtimeModeAtom`, `autoRefreshAtom`, …). Read from those atoms directly rather than adding
> new props for things already in state.
>
> Do not touch `src/filters/` or `src/range/` — other agents own those.

---

## T2 · RangePicker (replaces Sort)

> Create `web/packages/agenta-observability-ui/src/range/` with a controlled range picker that
> replaces `web/oss/src/components/Filters/Sort.tsx` (318 LOC). Read it first. Do not edit it.
>
> **Do not write a preset list.** `web/packages/agenta-home-ui/src/AnalyticsRangePicker.tsx` is
> 54 LOC, already antd-free, and already renders `ANALYTICS_RANGE_PRESETS` — the same catalogue
> Sort uses (`SortResult` is an alias of `AnalyticsRange`; see
> `@agenta/observability` `core/types.ts`). Move it to a home both surfaces can import, most
> likely your new `range/` directory, and leave `home-ui` importing from there. Reusing it is a
> requirement, not a suggestion.
>
> Add the one thing it deliberately omits: the **custom start/end** branch, using
> `DateRangePicker` from `@agenta/ui/ui` (built by agent P0-A — coordinate on its exact export
> name via `docs/design/observability-chrome/exports.md`).
>
> Preserve from `Sort.tsx`: all 10 presets, the `exclude` prop, the "Define start and end time"
> affordance, and the emitted `{type, sorted, customRange, label}` shape.
>
> **Fix this pre-existing defect as part of the port.** `Sort.tsx:107` is uncontrolled —
> `useState<SortTypes>(defaultSortValue)` with `defaultSortValue="24 hours"` hardcoded at
> `ObservabilityHeader:685`, and nothing syncs it back from the atom. Switching tabs resets the
> visible label to "Last 24 hours" while the query keeps the real window (verified live: set
> "All time" → 7 rows, round-trip tabs → label reads "Last 24 hours", table still shows 7). Your
> component must be **controlled**: derive the displayed range from `sortAtom` in
> `@agenta/observability`, never from local state seeded by a prop.

---

## T3 · FilterDialog + FilterRow

> Create `web/packages/agenta-observability-ui/src/filters/FilterDialog.tsx` and
> `FilterRow.tsx`, plus `web/packages/agenta-observability/src/filters/dialogHelpers.ts` for the
> pure parts. These replace most of `web/oss/src/components/Filters/Filters.tsx` (1,983 LOC).
> **Read it first.** Do not edit it.
>
> Your scope is the dialog shell, the generic filter row, and `FilterTagsInput.tsx` — the
> multi-VALUE tags input (antd `mode="tags"`) the generic row needs. The export handoff lists
> it under T3, so it is yours; do not leave it unowned:
> - **Shell** (from ~line 840): the popover container, heading, `+ Add`, `Clear`, `Cancel`,
>   `Apply`. Use `popover` from `@agenta/ui/ui` and `EnhancedButton`.
> - **Generic row:** field menu (antd `Dropdown` + `MenuProps` → `dropdown-menu` from
>   `@agenta/ui/ui`), operator select, and the value input.
> - **Pure helpers** (lines 1–270): `collapseAnnotationAnyEvaluatorRowsFromProps`,
>   `extractAnnotationValue`, `buildFieldMenuItems` → move to `dialogHelpers.ts` in
>   `@agenta/observability` with unit tests in that package's `tests/unit/`.
>
> **You are NOT writing the annotation evaluator/feedback sub-row** (original lines 938–1283) —
> agent T4 owns `AnnotationFilterRow.tsx`. Leave a clearly-typed slot or child prop for it and
> do not assume its internals.
>
> **Consume the packaged engine; do not re-derive it.** `@agenta/observability/filters` already
> exports and unit-tests: `planInputs` (which decides `needsKey` / `showValue` / `valueAs` per
> field+operator), `normalizeFilter`, `toUIValue`, `fieldConfigByOptionKey`, `getFilterColumns`,
> and `reconcileFilterRows`. Call them.
>
> Two contracts you must not break:
> - **Field-menu icons are host-injected.** `getFilterColumns(attributeKeyOptions, icons)` takes
>   an icon map keyed by node label; the packaged `FILTER_COLUMNS` is icon-free so mobile can
>   supply Lucide instead of Phosphor. Take the icon map as a prop.
> - **`reconcileFilterRows` preserves array length and per-index order** because the dialog
>   mutates rows by index. Keep mutating by index, and keep calling it for the display-only
>   projection that flips the references-row label when `trace_type` changes.
>
> For the attribute-key value input, use whatever agent P0-B concluded (cascader or a new
> tree-select) — check `docs/design/observability-chrome/exports.md`.

---

## T4 · AnnotationFilterRow

> Create `web/packages/agenta-observability-ui/src/filters/AnnotationFilterRow.tsx`, ported from
> `web/oss/src/components/Filters/Filters.tsx` lines **938–1283**. Read that range plus enough
> surrounding context to understand the row model. Do not edit the file.
>
> It is the evaluator + feedback sub-row, and it is self-contained: it owns
> `handleEvaluatorChange`, `handleFeedbackFieldChange`, `handleFeedbackOperatorChange`,
> `handleFeedbackValueChange`, `removeEvaluator`, `removeFeedback`, the
> `renderAddFeedbackButton` affordance, and the `feedbackOptionsForSelect` /
> `availableFeedbackOptions` derivations.
>
> Its operator sets are already packaged — import `NUM_OPS`,
> `STRING_EQU_AND_CONTAINS_OPS` and friends from `@agenta/observability` rather than
> redefining `ALL_FEEDBACK_OPERATOR_OPTIONS` / `NUMERIC_FEEDBACK_OPERATOR_VALUES` locally.
>
> antd → `@agenta/ui/ui`: `Select` → `select` (or `combobox` where it is searchable), `Button` →
> `EnhancedButton`, `Space` → flex, `Typography.Text` → `<span>` with semantic token classes.
>
> **Export an explicit props contract and do not assume how it is laid out.** Agent T3 owns the
> surrounding row and will embed you; you must not reach into its files, and it must not need to
> reach into yours. Anything you need from the parent (the row's value, an `onChange`, the
> evaluator list) is a prop.

---

## T5 · Column defs and the ColumnsType seam — RUN ALONE

> **Do not run this concurrently with the integration phase.** It touches app files by design.
>
> Two independent items:
>
> **1. Tag swap.** `web/oss/src/components/pages/observability/assets/getObservabilityColumns.tsx`
> still imports antd `Tag`. Replace with `SpanIdChip`, already built and exported from
> `@agenta/observability-ui`. Small and self-contained.
>
> **2. Break the `ColumnsType` type coupling.** This is step 1 of the table port
> (`docs/design/observability-packages/plan.md` §8), pulled forward because it is independently
> landable, mechanical, and carries zero visual risk — and it stops the type debt growing.
>
> Introduce a local `ColumnDef<T>` inside `web/packages/agenta-ui/src/InfiniteVirtualTable/` and
> make antd's `ColumnsType` an adapter applied at the app boundary. Measured surface: **22 files,
> 167 references** — re-measure with
> `grep -rl 'ColumnsType\|ColumnType\|antd/es/table' web/packages/agenta-ui/src/InfiniteVirtualTable | wc -l`.
>
> This does **not** port the table's rendering. `<Table virtual>` stays. You are only replacing
> the type surface so later steps are unblocked.
>
> `web/oss/src/components/pages/observability/assets/types.d.ts` imports antd solely for this
> type; its antd import should disappear as a result.

---

## I · Integration — RUN ALONE, AFTER ALL TRACKS

> All component tracks are complete. Your job is to make desktop use them and delete the antd
> originals. You are the only agent allowed to edit `web/oss/` and `web/ee/`.
>
> 1. **Read `docs/design/observability-chrome/exports.md`.** Add every reported export to
>    `web/packages/agenta-observability-ui/src/index.ts` and `@agenta/ui`'s `ui/index.ts`, and
>    every reported dependency to the right `package.json`. Run `pnpm install`.
> 2. **Compose the toolbar.** `ObservabilityHeader` shrinks to composition around
>    `ObservabilityToolbar`, passing `filtersSlot` (the new `FilterDialog`), `sortSlot` (the new
>    `RangePicker`) and `actionsSlot` (`AddActionsDropdown`, OSS-only). Keep the export pipeline,
>    delete-modal wiring, `useBatchAddTracesToQueue` and the add-all-matching confirm in the app,
>    handed down as callbacks.
> 3. **Delete** `web/oss/src/components/Filters/Filters.tsx` and `Sort.tsx`, and rewrite every
>    call site. Anchor rewrites on the **full import specifier** and diff the touched-file list
>    against what you expected before continuing — a path-suffix regex clobbered ~40 unrelated
>    modules in a previous session because `assets/constants` is a common filename.
> 4. **Remember OSS bans re-export shims** (`export … from "@agenta/*"` is lint-blocked in
>    `oss/src` and `ee/src`). Rewrite call sites; do not leave a shim. Type-only re-exports
>    (`import type` + a no-source `export type`) are the one legal exception.
> 5. **Gates:** `pnpm lint-fix` · OSS/EE/mobile `tsc` with `$?` captured to a file · every
>    touched package builds, lints and tests · `grep -rn 'from "antd"\|from "@ant-design'
>    web/packages/agenta-observability-ui/src` prints nothing.
> 6. **Browser pass**, both themes, against `plan.md` §5. Ask the user for a URL rather than
>    starting a dev server. Note: resizing the viewport desyncs the resizable-column table and
>    makes headers look blank — reload before judging anything as a regression.
>
> Report what landed, what §5 showed, and anything left out and why.
