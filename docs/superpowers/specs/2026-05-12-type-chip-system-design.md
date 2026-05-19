# Type Chip System — Design Spec

**Date:** 2026-05-12
**Branch:** arda/input-ux
**Status:** Approved — ready for implementation planning

---

## Problem Statement

Users cannot tell what TYPE a value is by looking at a rendered editor or table cell. A short string and a number both render as text. An empty string and null both render as nothing. A stringified JSON blob renders identically to a regular long string. Production today surfaces no type indicator anywhere — the user has to read the value carefully or infer from context.

**Full problem breakdown + vocabulary rationale:**
`web/apps/design-mockups/src/pages/gap-01-type-chips.tsx` — the concept page that defines the chip system, explains all three axes, and describes the type-switching mechanism.

---

## Proposal Summary

A small monospace `TypeChip` primitive appears next to field names and column headers on every surface that renders user-authored data: testcase drawer (drill-in), playground execution items, and testset table columns. Same component everywhere. Same vocabulary. The chip is static for now; clicking it is reserved for a later phase (`ChipConversionPopover`) with the API already designed to accept `onClick` without call-site changes.

**Chip design reference:** `web/apps/design-mockups/src/components/proposed/TypeChip.tsx`
**Conversion popover reference (future):** `web/apps/design-mockups/src/components/proposed/ChipConversionPopover.tsx`

---

## Scope

**In scope:**
- `TypeChip` primitive (Axis 1 — type primitive) extracted to `@agenta/ui`
- Type detection utilities (`detectDataType`, `inferRenderHint`, `getViewOptions`) in `@agenta/ui/drill-in`
- Axis 2 (render hints) and Axis 3 (state/correctness) chips — implemented but **hidden behind flags** (off by default)
- Testset table column headers: type chips + button-style ±-toggle based on the table mockup reference
- Testcase drawer: new sub-header toolbar, per-field "View as" dropdown, TypeChip on field headers, Form view with flag gate
- Playground: compact variable list with TypeChip, flag-gated nested rendering

**Out of scope (this phase):**
- `ChipConversionPopover` (click-to-convert type action) — full implementation in mockup at `web/apps/design-mockups/src/components/proposed/ChipConversionPopover.tsx`; deferred
- gap-09 variable provenance / usage states (used / chain / draft / unused)
- Schema-aware form direction (SchemaForm, gap-07)
- ProposedDrillIn Row 1 (auto-expand, collision detection, inline message cards) — reference: `web/apps/design-mockups/src/components/proposed/ProposedDrillIn.tsx`

---

## Chip Vocabulary

Three orthogonal axes. A field may carry chips from multiple axes simultaneously. **Only Axis 1 is enabled by default.** Axes 2 and 3 are implemented but gated behind flags at the surface level.

### Axis 1 — Type Primitive (always one, always on)

What the value IS. Solid background, no border. One chip per field, inferred from `detectDataType(value)`.

| Variant key | Display label | Colour |
|---|---|---|
| `string` | string | Neutral grey |
| `number` | number | Neutral grey |
| `boolean` | boolean | Neutral grey |
| `null` | null | Muted grey |
| `json-object` | object | Blue `#1677ff` |
| `json-array` | array | Teal `#13c2c2` |

Note: variant keys use `json-object` / `json-array` for TS precision (greppable); display labels are `object` / `array`.

### Axis 2 — Render Hint (optional, flag-gated)

How a value is rendered. Dashed border + italic so the user reads "render mode" not "type". Stacks alongside the Axis 1 chip. Inferred from `inferRenderHint(value)`.

**Flag:** `enableRenderHints` on each surface component — default `false`.

| Variant | Display | Meaning |
|---|---|---|
| `markdown` | markdown | Long/multiline string, rendered with markdown preview |
| `stringified` | stringified | String that parses as JSON |
| `messages` | messages | Array shaped like chat history (role + content per item) |
| `tool-calls` | tool-calls | Array shaped like OpenAI tool calls (id + type:function + function) |

Examples from mockup: `[str][markdown]`, `[str][stringified]`, `[arr][messages]`, `[arr][tool-calls]`

**Mockup reference:**
- Type detection: `web/apps/design-mockups/src/components/proposed/TypeChip.tsx` → `inferRenderHint()`
- Usage in drill-in: `web/apps/design-mockups/src/components/proposed/ProposedDrillIn.tsx` (search `renderHint`)
- Usage in table cells: `web/apps/design-mockups/src/components/proposed/ProposedTableCell.tsx`

### Axis 3 — State / Correctness (optional, flag-gated)

Domain-specific signals that stack alongside type + render-hint chips. Amber for warnings, red for errors.

**Flag:** `enableStateChips` on each surface component — default `false`.

| Variant | Display | Meaning |
|---|---|---|
| `mixed` | mixed | Column has heterogeneous types across rows |
| `collision` | ⚠ collision | Literal-dot key and nested path both exist on the same row |
| `dotted-key` | dotted-key | Literal dotted top-level key (`"geo.region"` as a key, not a path) |
| `not-authored` | not authored | Union-projected key missing from this row (gap-04) |
| `optional` | optional | Schema-defined but not required (gap-07, out of scope for now) |
| `shadowed` | ⚠ shadowed | Literal-key resolution silently overrides nested path |
| `draft` | draft | Referenced in prompt template but not yet on testcase (gap-09) |

**Mockup references:**
- Collision + dotted-key detection: `web/apps/design-mockups/src/components/proposed/testsetTableHelpers.ts` → `detectCollisionColumns()`, `detectDottedKeyColumns()`
- Mixed column detection: `web/apps/design-mockups/src/components/proposed/testsetTableHelpers.ts` → `detectMixedColumns()`
- Column header warnings consolidated as single indicator: `web/apps/design-mockups/src/components/proposed/ProposedTableCell.tsx` → `CellWarningsIndicator`
- Drill-in field warnings: `web/apps/design-mockups/src/components/proposed/ProposedDrillIn.tsx` → `FieldWarningsIndicator`

---

## Architecture & Shared Primitives

### `TypeChip` — `@agenta/ui/type-chip`

Single presentational primitive used verbatim across all surfaces. Source of truth for styles, labels, and the three-axis vocabulary.

**Mockup source:** `web/apps/design-mockups/src/components/proposed/TypeChip.tsx` — reference only. Production `TypeChip` owns the final `STYLES` map.

```typescript
interface TypeChipProps {
  variant?: ChipVariant       // explicit variant; inferred from value if omitted
  value?: unknown             // used for inference when variant is not set
  label?: string              // override display label (e.g. "5 messages")
  ambiguousOnly?: boolean     // when true, hides chip for string / number / boolean
  onClick?: () => void        // no-op now; wiring this converts chip to <button> with hover lift + focus ring
  notificationBadge?: boolean // reserved for future popover nudge dot (pulsing purple dot)
  badgeTooltip?: string       // tooltip for the badge
}
```

**Forward-compatibility contract:** when `onClick` is undefined the chip renders as a static `<span>`. When `onClick` is provided it renders as a `<button>` with hover lift (`translateY(-1px)`) and focus ring. Adding `ChipConversionPopover` later requires: wrap `<TypeChip onClick={openPopover} />` in a popover at the call site. Zero changes to `TypeChip` internals or any existing call site.

**Axis 1 colors:** primitive colors are defined once in `TypeChip`: string = green, number = purple, boolean = orange, null = muted gray, object = blue, array = teal.

**`ChipVariant` type** is exported separately so surfaces can type their chip props without importing the full component:
```typescript
export type ChipVariant = TypePrimitive | RenderHint | StateChip
```

### Type Detection — `@agenta/ui/drill-in`

Pure functions, no React dependency. All three surfaces import from the same source.

- **`detectDataType(value)`** — already exists in production; returns `DataType` (`string | number | boolean | null | json-object | json-array`)
- **`inferRenderHint(value)`** — **new**; returns `RenderHint | null`. Ported from `web/apps/design-mockups/src/components/proposed/TypeChip.tsx` → `inferRenderHint()`. Logic: checks for `messages` shape (array with `role` key), `tool-calls` shape (array with `type: "function"`), `stringified` (string that JSON-parses to object/array), `markdown` (length > 100 or contains newline).
- **`getViewOptions(value)`** — **new**; returns ordered view mode options for a given value. Used by drill-in field header and playground to populate the "View as ▾" dropdown.

---

## Feature Flags Summary

| Flag | Default | Controls |
|---|---|---|
| `enableRenderHints` | `false` | Axis 2 chips (markdown / stringified / messages / tool-calls) |
| `enableStateChips` | `false` | Axis 3 chips (mixed / collision / dotted-key / not-authored / etc.) |
| `enableFormView` | `false` | Form view option in the "View as" dropdown + rail-style nested object renderer |
| `enableNestedVariableRendering` | `false` | Playground: expand structured rows into full embedded drill-in body |

Flags live on the surface-level components, not on `TypeChip` itself. `TypeChip` is always capable of rendering any axis; the surface controls what it passes down.

---

## Implementation Phases

### Phase 1 + 2 — Foundation + Tables (single PR)

**Status:** Phase 1 primitives (`TypeChip`, `inferRenderHint`, `getViewOptions`) are already implemented in `@agenta/ui`. The table-level implementation plan builds detection into `InfiniteVirtualTable` as a generic feature.

**Design mockup references:**
- `web/apps/design-mockups/src/components/proposed/TypeChip.tsx` — chip component (already ported)
- `web/apps/design-mockups/src/pages/solutions-tables.tsx` — table layout and toggle-button visual references
- `web/apps/design-mockups/src/components/proposed/testsetTableHelpers.ts` → `detectColumnTypes()`

**Architecture decision:** Type chip rendering is a generic `InfiniteVirtualTable` feature, not testcase-table-specific. Any table can opt in by passing `typeChips={{ storageKey, defaultEnabled, getRowValue, resolveHeaderVariant }}`. The testcase table is the first consumer.

**`typeChips` prop on `InfiniteVirtualTable`:**
```typescript
interface TypeChipConfig<RecordType> {
    enabled?: boolean
    onEnabledChange?: (enabled: boolean) => void
    defaultEnabled?: boolean
    storageKey?: string
    getRowValue: (record: RecordType, columnKey: string) => unknown  // must be stable (useCallback)
    resolveHeaderVariant?: (key: string, info: ColumnTypeInfo | undefined) => ChipVariant | undefined
    enableRenderHints?: boolean   // default false
    enableStateChips?: boolean    // default false
}
```

**Column header chip rules (encoded in `defaultHeaderVariant`):**
- Leaf columns render the detected primitive type (`string` / `number` / `boolean` / `null` / `object` / `array`)
- Nested leaf columns use the same detected primitive type set
- Group headers: always `object` — rendered by the consumer (`TestcasesTableShell`), not by `InfiniteVirtualTable`
- Collapsed group columns are parent keys and do not receive an extra leaf chip; `TestcasesTableShell` returns `undefined` from `resolveHeaderVariant` for those keys so parent and child chips stay visually separate

**Group toggle:**
- `GroupToggleButton` component in `TestcasesTableShell` — `20×20px`, `1px solid rgba(5,23,41,0.18)` border, `#f5f5f5` background, hover → `#e6f4ff` background + `#1677ff` border + `#1677ff` text
- Shows `+` on collapsed groups, `−` on expanded groups
- Group header title = `[±-button] [group name] [object chip]` — consumer-owned layout

**Type chip visibility persistence:** `useTypeChipFeature()` in `@agenta/ui/table` owns the persisted show/hide state when `typeChips.storageKey` is provided. The settings dropdown renders a "Show type chips" / "Hide type chips" item. The testcase table uses key `"agenta:testcase-table:type-chips-enabled"` with `defaultEnabled: true`.

**Detection:** `useTypeChipColumns` hook inside `InfiniteVirtualTable` — samples first 30 rows of `dataSource` via `getRowValue`, runs `detectColumnTypes`, enhances leaf column titles with `TypeChip` nodes. Group column titles are not touched by the hook.

**Files:**
- `web/packages/agenta-ui/src/InfiniteVirtualTable/utils/detectColumnTypes.ts` — new; exports `detectColumnTypes`, `defaultHeaderVariant`, `ColumnTypeInfo`
- `web/packages/agenta-ui/src/InfiniteVirtualTable/types.ts` — adds `TypeChipConfig<RecordType>` + `typeChips` prop
- `web/packages/agenta-ui/src/InfiniteVirtualTable/hooks/useTypeChipColumns.tsx` — new hook (`.tsx` — renders JSX)
- `web/packages/agenta-ui/src/InfiniteVirtualTable/components/InfiniteVirtualTableInner.tsx` — wires the hook
- `web/packages/agenta-ui/src/InfiniteVirtualTable/hooks/useTypeChipFeature.tsx` — generic persisted visibility + settings menu item
- `web/packages/agenta-ui/src/InfiniteVirtualTable/features/InfiniteVirtualTableFeatureShell.tsx` — resolves `typeChips` visibility and adds settings UI
- `web/oss/src/components/TestcasesTableNew/components/TestcasesTableShell.tsx` — adds `GroupToggleButton` (replaces caret spans) + `[object]` TypeChip on group headers; uses generic type chip feature state
- `web/oss/src/components/TestcasesTableNew/index.tsx` — creates `getRowValue`; passes `typeChips.storageKey` + `defaultEnabled` to shell
- Cell components untouched: `TestcaseCellContent`, `JsonCellContent`, `ChatMessagesCellContent`

---

### Phase 3 — Testcase Drawer (Drill-in)

**Deliverable:** ProposalV2 direction live on the testcase drawer.

**Design mockup references:**
- ProposalV2 component: `web/apps/design-mockups/src/components/proposed/ProposalV2DrillIn.tsx`
- ProposalV2 view type logic: `web/apps/design-mockups/src/components/proposed/proposalV2Views.ts` → `getViewOptions()`, `getDefaultViewForValue()`
- Per-field view type select: `web/apps/design-mockups/src/components/proposed/ProposalV2ViewTypeSelect.tsx`
- Root toolbar (from Row 1 proposal): `web/apps/design-mockups/src/components/proposed/ProposedDrillIn.tsx` → root header section (filter icon, collapse-all, view-mode select, copy)
- Three-row comparison page: `web/apps/design-mockups/src/pages/solutions-drill-in.tsx`

#### Header structure

```
┌─ Main chrome (unchanged, Fields/JSON toggle removed) ───────────────┐
│  ‹ › ∧   Testcase 12  □                        Add to queue         │
└─────────────────────────────────────────────────────────────────────┘
┌─ DrillInRootToolbar (new) ──────────────────────────────────────────┐
│  Vanuatu (kitchen sink)      ▽  ⇅  [ Text ▾ ]  □                   │
└─────────────────────────────────────────────────────────────────────┘
┌─ Drawer body ───────────────────────────────────────────────────────┐
│  country  [string]                               View as ▾          │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ Vanuatu                                                      │    │
│  └─────────────────────────────────────────────────────────────┘    │
│  ...                                                                 │
└─────────────────────────────────────────────────────────────────────┘
```

The `DrillInRootToolbar` sub-header is the root toolbar from the first proposal (ProposedDrillIn) combined with the per-field "View as ▾" body from ProposalV2. These two proposals are intentionally composed — the toolbar from Row 1 is the chrome, the body from Row 2 is the content.

#### `DrillInRootToolbar` — new component in `@agenta/ui/drill-in`

```typescript
interface DrillInRootToolbarProps {
  label: string
  viewMode: "text" | "markdown" | "json" | "yaml" | "form"
  onViewModeChange: (mode: "text" | "markdown" | "json" | "yaml" | "form") => void
  onCollapseAll?: () => void
  onFilter?: () => void
  onCopy?: () => void
  enableFormView?: boolean   // default false — Form absent from dropdown until ready
}
```

Reusable: playground mounts the same component in Phase 4 when `enableNestedVariableRendering` is true.

#### Root view mode vs per-field override

The root view mode on `DrillInRootToolbar` sets the default rendering for all fields in the drawer body. Each field's "View as ▾" dropdown starts at the root mode and can be overridden independently — changing a single field's mode does not affect other fields or the root mode. Switching the root mode resets all per-field overrides to the new default.

#### `DrillInFieldHeader` changes

Single new prop: `typeChip?: ReactNode`. Rendered between the collapse toggle and the field name. Everything else unchanged.

**Forward-compatibility:** when `ChipConversionPopover` is added, the caller wraps `<TypeChip onClick={open} />` in a popover and passes the result as `typeChip`. No changes to `DrillInFieldHeader` or any other consumer.

Axis 2 + 3 on field headers:
- `enableRenderHints`: when true, the caller additionally passes the render hint chip (e.g. `[markdown]`, `[messages]`) stacked alongside the type chip in the `typeChip` slot
- `enableStateChips`: when true, the caller additionally passes a `FieldWarningsIndicator` (reference: `ProposedDrillIn.tsx`) alongside — same Warning icon + tooltip pattern as the table

#### View mode options per field (via `getViewOptions`)

| Value type | Available options |
|---|---|
| `string` (short, < 100 chars, no newlines) | Text, Markdown, JSON, YAML |
| `string` (long / multiline) | Markdown, Text, JSON, YAML |
| `object` | JSON, YAML *(+ Form when `enableFormView` is true)* |
| `messages` array | JSON, YAML |
| other arrays | JSON, YAML |
| `number` / `boolean` / `null` | JSON, YAML |

Threshold for "long string" matches `inferRenderHint`: length > 100 or contains `\n`.

#### Form view (flag-gated, `enableFormView`)

- `JsonObjectField` drops the card-inside-card wrapper, replaces with `paddingLeft: 16px` + `2px solid` left border rail
- Style-only change, ~30–50 lines in `JsonObjectField.tsx`
- Gated via `DrillInUIContext` — the existing context at `web/packages/agenta-ui/src/drill-in/context/DrillInUIContext.tsx` already propagates injectable values through the whole drill-in tree. Add `featureFlags?: { enableFormView?: boolean }` to the `DrillInUIComponents` interface. `JsonObjectField` reads this via `useDrillInUI()` — no prop threading required
- The OSS app wrapper sets `featureFlags.enableFormView = false` by default; flipping it to `true` in the provider is the only change needed to enable Form view globally
- Default: `false` — ships hidden, enabled when confident

**Files:**
- `web/packages/agenta-ui/src/drill-in/core/DrillInRootToolbar.tsx` — new
- `web/packages/agenta-ui/src/drill-in/core/DrillInFieldHeader.tsx` — add `typeChip?: ReactNode`
- `web/packages/agenta-ui/src/drill-in/FieldRenderers/JsonObjectField.tsx` — Form view rail style, gated
- `web/packages/agenta-ui/src/drill-in/index.ts` — export `DrillInRootToolbar`
- `web/packages/agenta-entity-ui/src/testcase/TestcaseDrawer.tsx` — remove Fields/JSON toggle from chrome, add `rootViewMode` state, mount `DrillInRootToolbar`, extend `TestcaseDrawerContentRenderProps` with `rootViewMode`/`fieldViewModes`/`onFieldViewModeChange`
- `web/oss/src/components/TestcasesTableNew/components/TestcaseEditDrawer/index.tsx` — consume `rootViewMode` from render props, pass `typeChip` to `DrillInFieldHeader`, wire per-field "View as" via `getViewOptions`

---

### Phase 4 — Playground

**Deliverable:** Compact variable list with TypeChip; flag-gated nested rendering.

**Design mockup references:**
- Compact execution item: `web/apps/design-mockups/src/components/proposed/PlaygroundExecutionItemCompact.tsx`
- Three-way compare page: `web/apps/design-mockups/src/pages/solutions-playground.tsx` — "Alt compact" panel

**Compact row layout (~26px height):**
```
  country  [string]  Vanuatu                                    ▾
```
- Left: field name + `TypeChip` (Axis 1, static)
- Middle: truncated value preview
- Right: expand chevron
- Click primitive row → morphs to inline editor
- Click structured row → expands inline (depth controlled by `enableNestedVariableRendering`)

**`enableNestedVariableRendering` flag:**
- `false` (default): structured rows expand to a plain JSON preview inline
- `true`: structured rows mount `DrillInRootToolbar` + embedded drill-in body (same as Phase 3 drawer)

**Axis 2 + 3 in playground:**
- Same flags: `enableRenderHints` and `enableStateChips` on the execution item component
- When off (default): only Axis 1 chip appears next to the field name

**Files:**
- `web/oss/src/components/Playground/Components/PlaygroundTestcaseEditor.tsx` — update inputs renderer (this is the component that renders variable rows in the execution item; it already imports `executionItemController.selectors.variableKeys`)
- No new components; everything is Phase 1 (`TypeChip`) + Phase 3 (`DrillInRootToolbar`) reuse

---

## Future Work (not in this spec)

- **`ChipConversionPopover`:** full implementation already in mockup at `web/apps/design-mockups/src/components/proposed/ChipConversionPopover.tsx`. Covers type conversion rules (string → object/array/number/bool, null → any, object → string, etc.), lossy-conversion warnings inline, and editor mode switching (short/long) for string fields. Entry point: wire `onClick` on existing `TypeChip` instances at each surface. No structural changes required.
- **Axis 3 on drill-in headers:** correctness chips (`[mixed]`, `[collision]`, `[dotted-key]`) on field headers within the drawer — enabled by turning on `enableStateChips`.
- **Form view (full):** expand `enableFormView` to stable once rail-style nesting is tested across all testset shapes.
- **gap-09 variable provenance:** `[draft]`, `[unused]`, `[chain]` state chips on playground variables — part of Axis 3, gated behind `enableStateChips` already.

---

## Tasks

### Phase 1 + 2 — Foundation + Tables ✅ DONE

**Phase 1 — done:** `TypeChip`, `inferRenderHint`, `getViewOptions` in `@agenta/ui`.

**Phase 2 — done:**
- [x] Verified testcase table had no intermediate chip code (clean baseline)
- [x] Created `web/packages/agenta-ui/src/InfiniteVirtualTable/utils/detectColumnTypes.ts`
- [x] Added `TypeChipConfig<RecordType>` + `typeChips?` to `InfiniteVirtualTableProps`
- [x] Created `web/packages/agenta-ui/src/InfiniteVirtualTable/hooks/useTypeChipColumns.tsx`
- [x] Wired `useTypeChipColumns` in `InfiniteVirtualTableInner.tsx`
- [x] Threaded `typeChips` through `InfiniteVirtualTableFeatureShell`
- [x] Created `useTypeChipFeature()` in `@agenta/ui/table` — persisted visibility via `storageKey`
- [x] Updated `TestcasesTableShell.tsx` — `GroupToggleButton`, `[object]` TypeChip on group headers, `typeChips` forwarding
- [x] Updated `TestcasesTableNew/index.tsx` — `getRowValue` + `typeChips` wiring
- [x] Verified cell components untouched
- [x] Lint clean

### Phase 3 — Testcase Drawer

- [ ] Create `web/packages/agenta-ui/src/drill-in/core/DrillInRootToolbar.tsx` — label + filter icon + collapse-all + view mode select (Text / Markdown / JSON / YAML; Form when `enableFormView`) + copy; reference root header section in `ProposedDrillIn.tsx`
- [ ] Export `DrillInRootToolbar` from `web/packages/agenta-ui/src/drill-in/index.ts`
- [ ] Add `typeChip?: ReactNode` prop to `DrillInFieldHeader` — render between collapse toggle and field name
- [ ] Add `featureFlags?: { enableFormView?: boolean }` to `DrillInUIComponents` in `web/packages/agenta-ui/src/drill-in/context/DrillInUIContext.tsx`
- [ ] Update `JsonObjectField.tsx` — read `useDrillInUI().featureFlags?.enableFormView`; when true, render indent + 2px left border rail instead of card wrapper
- [ ] Update `web/packages/agenta-entity-ui/src/testcase/TestcaseDrawer.tsx` (shell):
  - Remove Fields/JSON toggle from main chrome header
  - Add `rootViewMode` state + `DrillInRootToolbar` sub-header below chrome
  - Extend `TestcaseDrawerContentRenderProps` with `rootViewMode`, `fieldViewModes`, `onFieldViewModeChange`
- [ ] Update `web/oss/src/components/TestcasesTableNew/components/TestcaseEditDrawer/index.tsx` (content):
  - Consume `rootViewMode`/`fieldViewModes`/`onFieldViewModeChange` from render props
  - Pass `typeChip={<TypeChip value={fieldValue} />}` to each `DrillInFieldHeader`
  - Wire per-field "View as" dropdown using `getViewOptions(value)` — reference `ProposalV2DrillIn.tsx` + `ProposalV2ViewTypeSelect.tsx`
- [ ] Run `pnpm lint-fix` in `web/`

### Phase 4 — Playground

- [ ] Add `enableNestedVariableRendering`, `enableRenderHints`, `enableStateChips` props to `PlaygroundTestcaseEditor.tsx` (all default `false`)
- [ ] Update inputs renderer in `PlaygroundTestcaseEditor.tsx` — compact row: field name + `TypeChip` + truncated value preview + expand chevron; reference `web/apps/design-mockups/src/components/proposed/PlaygroundExecutionItemCompact.tsx`
- [ ] Wire click on primitive row → inline editor morph
- [ ] Wire click on structured row → JSON preview (flag off) or `DrillInRootToolbar` + embedded drill-in (flag on)
- [ ] Run `pnpm lint-fix` in `web/`
