# Type Chip System — Design Spec

**Date:** 2026-05-12
**Branch:** arda/input-ux
**Status:** Approved — ready for implementation planning

---

## Problem Statement

Users cannot tell what TYPE a value is by looking at a rendered editor or table cell. A short string and a number both render as text. An empty string and null both render as nothing. A stringified JSON blob renders identically to a regular long string. Production today surfaces no type indicator anywhere — the user has to read the value carefully or infer from context.

---

## Proposal Summary

A small monospace `TypeChip` primitive appears next to field names and column headers on every surface that renders user-authored data: testcase drawer (drill-in), playground execution items, and testset table columns. Same component everywhere. Same vocabulary. The chip is static for now; clicking it is reserved for Phase 2 (`ChipConversionPopover`) with the API already designed to accept `onClick` without call-site changes.

---

## Scope

**In scope:**
- `TypeChip` primitive extracted to `@agenta/ui`
- Type detection utilities (`detectDataType`, `inferRenderHint`) in `@agenta/ui/drill-in`
- Testset table column headers: type chips + button-style ±-toggle (Mahmoud's proposal)
- Testcase drawer: new sub-header toolbar, per-field "View as" dropdown, TypeChip on field headers, Form view with flag gate
- Playground: compact variable list with TypeChip, flag-gated nested rendering

**Out of scope (this phase):**
- `ChipConversionPopover` (click-to-convert type action)
- gap-09 variable provenance / usage states (used / chain / draft / unused)
- Schema-aware form direction (SchemaForm, gap-07)
- ProposedDrillIn Row 1 (auto-expand, collision detection, inline message cards)

---

## Chip Vocabulary

Three orthogonal axes. A field may carry chips from multiple axes simultaneously.

### Axis 1 — Type Primitive (always one)
What the value IS. Solid background, no border.

| Variant | Display | Colour |
|---|---|---|
| `string` | string | Neutral grey |
| `number` | number | Neutral grey |
| `boolean` | boolean | Neutral grey |
| `null` | null | Muted grey |
| `json-object` | object | Blue |
| `json-array` | array | Teal |

### Axis 2 — Render Hint (optional)
How the value is rendered. Dashed border + italic so user reads "render mode" not "type".

| Variant | Display | Meaning |
|---|---|---|
| `markdown` | markdown | Long/multiline string, rendered with markdown preview |
| `stringified` | stringified | String that parses as JSON |
| `messages` | messages | Array shaped like chat history |
| `tool-calls` | tool-calls | Array shaped like OpenAI tool calls |

### Axis 3 — State / Correctness (optional)
Domain-specific signals. Amber for warnings, red for errors.

| Variant | Display | Meaning |
|---|---|---|
| `mixed` | mixed | Column has heterogeneous types across rows |
| `collision` | ⚠ collision | Literal-dot key and nested path both exist |
| `dotted-key` | dotted-key | Literal dotted top-level key |
| `not-authored` | not authored | Union-projected key missing from this row |
| `optional` | optional | Schema-defined but not required |
| `shadowed` | ⚠ shadowed | Literal-key resolution silently overrides nested |
| `draft` | draft | Referenced in prompt but not yet on testcase |

---

## Architecture & Shared Primitives

### `TypeChip` — `@agenta/ui/type-chip`

Single presentational primitive used verbatim across all surfaces.

```typescript
interface TypeChipProps {
  variant?: ChipVariant       // explicit variant; inferred from value if omitted
  value?: unknown             // used for inference when variant is not set
  label?: string              // override display label
  ambiguousOnly?: boolean     // when true, hides chip for string / number / boolean
  onClick?: () => void        // no-op now; wiring this converts chip to <button>
  notificationBadge?: boolean // reserved for future popover nudge dot
}
```

**Forward-compatibility contract:** when `onClick` is undefined the chip renders as a static `<span>`. When `onClick` is provided it renders as a `<button>` with hover lift and focus ring. Adding `ChipConversionPopover` later is: wrap `<TypeChip onClick={openPopover} />` in a popover at the call site. Zero changes to `TypeChip` internals or any other call site.

### Type Detection — `@agenta/ui/drill-in`

- `detectDataType(value)` — already exists; returns `DataType` (string | number | boolean | null | json-object | json-array)
- `inferRenderHint(value)` — **new**; returns `RenderHint | null` (markdown | stringified | messages | tool-calls | null)
- `getViewOptions(value)` — **new**; returns ordered view mode options for a given value (Text / Markdown / JSON / YAML, contextually filtered)

All three are pure functions with no React dependency. They live in `@agenta/ui/drill-in` so drill-in, tables, and playground all import from the same source.

---

## Implementation Phases

### Phase 1 — Foundation

**Deliverable:** `TypeChip` and detection utilities available in production packages. No surface changes.

**Files:**
- `web/packages/agenta-ui/src/type-chip/TypeChip.tsx` — component (ported from mockup)
- `web/packages/agenta-ui/src/type-chip/index.ts` — barrel export
- `web/packages/agenta-ui/package.json` — add `"./type-chip"` subpath export
- `web/packages/agenta-ui/src/drill-in/index.ts` — export `inferRenderHint`, `getViewOptions`
- `web/packages/agenta-ui/src/drill-in/utils/inferRenderHint.ts` — new pure function
- `web/packages/agenta-ui/src/drill-in/utils/getViewOptions.ts` — new pure function

**Key decisions:**
- `TypeChip` styles come from the mockup's `STYLES` map verbatim — no redesign
- `BadgeKeyframes` injected once via idempotent style tag (same approach as mockup)
- `ChipVariant` type exported so surfaces can type their chip props without importing the component

---

### Phase 2 — Tables (ships with Phase 1)

**Deliverable:** Mahmoud's proposal live on `TestcasesTableShell`. No cell changes.

**Column header chip rules:**
- Top-level leaf columns: `string` / `boolean` / `object` only. Arrays, numbers, null all collapse to `object` at the top level (testset model semantics).
- Nested leaf columns: full primitive set (`string` / `number` / `boolean` / `null` / `object`)
- Group headers: always `object`
- `chipMode` prop (`"all" | "ambiguous-only" | "none"`) controls visibility

**Group toggle:**
- Replace `CaretDown` / `CaretRight` icons on group headers with a bordered ±-button (`20×20px`, `1px` border, `#f5f5f5` background, hover → blue border + blue text)
- Real `<button>` for keyboard + a11y
- Both expanded (−) and collapsed (+) states use the same button shape

**New helper:**
- `detectColumnTypes(flatRows, columns, mixedColumns)` — computes per-column `{ type, hint }` from the union of row values. Added to `web/oss/src/components/TestcasesTableNew/utils/`.

**Files:**
- `web/oss/src/components/TestcasesTableNew/TestcasesTableShell.tsx` — add chip to column header renderer, replace caret with ±-button
- `web/oss/src/components/TestcasesTableNew/utils/detectColumnTypes.ts` — new helper
- Cell components untouched.

---

### Phase 3 — Testcase Drawer (Drill-in)

**Deliverable:** ProposalV2 direction live on the testcase drawer. Production chrome header kept, Fields/JSON toggle removed, new sub-header added.

#### Header structure

```
┌─ Main chrome (unchanged minus Fields/JSON toggle) ──────────────────┐
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

#### `DrillInRootToolbar` — new component in `@agenta/ui/drill-in`

```typescript
interface DrillInRootToolbarProps {
  label: string                                    // testcase label
  viewMode: "text" | "markdown" | "json" | "yaml" | "form"
  onViewModeChange: (mode: string) => void
  onCollapseAll?: () => void
  onFilter?: () => void
  onCopy?: () => void
  enableFormView?: boolean                         // default false — Form hidden until ready
}
```

Reusable: playground mounts the same component in Phase 4.

#### Root view mode vs per-field override

The root view mode on `DrillInRootToolbar` sets the default rendering for all fields in the drawer body. Each field's "View as ▾" dropdown starts at the root mode and can be overridden independently — changing a single field's mode does not affect other fields or the root mode. Switching the root mode resets all per-field overrides to the new default.

#### `DrillInFieldHeader` changes

Single new prop: `typeChip?: ReactNode`. Rendered between the collapse toggle and the field name. Everything else unchanged.

**Forward-compatibility:** when `ChipConversionPopover` is added, the caller wraps `<TypeChip onClick={open} />` in a popover and passes the result as `typeChip`. No changes to `DrillInFieldHeader`.

#### View mode options (per field, via `getViewOptions`)

| Value type | Available options |
|---|---|
| `string` (short) | Text, Markdown, JSON, YAML |
| `string` (long / multiline) | Markdown, Text, JSON, YAML |
| `object` | JSON, YAML *(Form available when `enableFormView` is true)* |
| `messages` array | JSON, YAML |
| other arrays | JSON, YAML |
| `number` / `boolean` / `null` | JSON, YAML |

#### Form view (flag-gated)

- `JsonObjectField` drops the card-inside-card wrapper, replaces with `paddingLeft: 16px` + `2px solid` left border rail
- Style-only change, ~30–50 lines
- Only mounted when `enableFormView === true` on `DrillInRootToolbar`
- Default: `false` — ships hidden, enabled when confident

**Files:**
- `web/packages/agenta-ui/src/drill-in/core/DrillInRootToolbar.tsx` — new
- `web/packages/agenta-ui/src/drill-in/core/DrillInFieldHeader.tsx` — add `typeChip` prop
- `web/packages/agenta-ui/src/drill-in/FieldRenderers/JsonObjectField.tsx` — Form view rail style
- `web/packages/agenta-ui/src/drill-in/utils/getViewOptions.ts` — already added in Phase 1
- `web/oss/src/components/TestcaseEditDrawer/index.tsx` — wire `DrillInRootToolbar`, remove Fields/JSON toggle, pass `typeChip` to field headers

---

### Phase 4 — Playground

**Deliverable:** Compact variable list with TypeChip; flag-gated nested rendering.

**Compact row:** one dense row per variable (~26px).
```
  country  [string]  Vanuatu                                    ▾
```
- Left: field name + `TypeChip` (static)
- Middle: truncated value preview
- Right: expand chevron
- Click primitive row → morphs to inline editor
- Click structured row → expands inline (depth controlled by flag)

**`enableNestedVariableRendering` flag on the execution item:**
- `false` (default): structured rows expand to a plain JSON preview
- `true`: structured rows mount `DrillInRootToolbar` + embedded drill-in body

**`DrillInRootToolbar` reuse:** when `enableNestedVariableRendering` is true, the toolbar mounts in the testcase header area of the execution item — same component, same props as Phase 3.

**Files:**
- `web/oss/src/components/Playground/` — update execution item inputs renderer
- No new components needed; everything is Phase 1 + Phase 3 reuse

---

## Future Work (not in this spec)

- **`ChipConversionPopover`:** wrap any `TypeChip` in a popover that offers type conversions and editor-mode switching. Entry point: wire `onClick` on existing `TypeChip` instances. No structural changes to any surface.
- **Correctness chips on drill-in headers:** `[mixed]`, `[collision]`, `[dotted-key]` on field headers within the drawer (currently only on table column headers).
- **Form view (full):** expand `enableFormView` to stable, with nested object rail tested across all testset shapes.
- **gap-09 variable provenance:** used / chain / draft / unused state chips on playground variables.

---

## Tasks

### Phase 1 — Foundation

- [ ] Create `web/packages/agenta-ui/src/type-chip/TypeChip.tsx` — port from mockup, same `STYLES` map, same `BadgeKeyframes` idempotent injection, `onClick` renders `<button>` vs `<span>`
- [ ] Create `web/packages/agenta-ui/src/type-chip/index.ts` — barrel export `TypeChip`, `ChipVariant`, `TypePrimitive`, `RenderHint`, `StateChip`
- [ ] Add `"./type-chip"` subpath to `web/packages/agenta-ui/package.json`
- [ ] Create `web/packages/agenta-ui/src/drill-in/utils/inferRenderHint.ts` — port from mockup
- [ ] Create `web/packages/agenta-ui/src/drill-in/utils/getViewOptions.ts` — returns ordered view options array for a value
- [ ] Export `inferRenderHint` and `getViewOptions` from `web/packages/agenta-ui/src/drill-in/index.ts`
- [ ] Run `pnpm lint-fix` in `web/`

### Phase 2 — Tables

- [ ] Create `web/oss/src/components/TestcasesTableNew/utils/detectColumnTypes.ts` — computes `Map<colKey, { type, hint }>` from flat rows
- [ ] Update `TestcasesTableShell.tsx` — add `chipMode` prop (`"all" | "ambiguous-only" | "none"`, default `"all"`)
- [ ] Update column header renderer in `TestcasesTableShell.tsx` — add `TypeChip` using simplified top-level type rules
- [ ] Replace `CaretDown` / `CaretRight` on group headers with bordered ±-button in `TestcasesTableShell.tsx`
- [ ] Verify cell components (`TestcaseCellContent`, `JsonCellContent`, `ChatMessagesCellContent`) are untouched
- [ ] Run `pnpm lint-fix` in `web/`

### Phase 3 — Testcase Drawer

- [ ] Create `web/packages/agenta-ui/src/drill-in/core/DrillInRootToolbar.tsx` — label + filter + collapse-all + view mode select (Text / Markdown / JSON / YAML, + Form when `enableFormView`) + copy
- [ ] Export `DrillInRootToolbar` from `web/packages/agenta-ui/src/drill-in/index.ts`
- [ ] Add `typeChip?: ReactNode` prop to `DrillInFieldHeader` — render between collapse toggle and field name
- [ ] Update `JsonObjectField.tsx` — add indent + 2px left border rail style, gated behind `enableFormView` flag passed from context or prop
- [ ] Update `web/oss/src/components/TestcaseEditDrawer/index.tsx`:
  - Remove Fields/JSON toggle from main chrome header
  - Mount `DrillInRootToolbar` as sub-header below chrome
  - Pass `typeChip={<TypeChip value={fieldValue} />}` to each `DrillInFieldHeader`
  - Wire per-field "View as" dropdown using `getViewOptions(value)`
- [ ] Run `pnpm lint-fix` in `web/`

### Phase 4 — Playground

- [ ] Add `enableNestedVariableRendering?: boolean` prop to execution item component (default `false`)
- [ ] Update inputs renderer — compact row: field name + `TypeChip` + truncated value preview + expand chevron
- [ ] Wire click on primitive row → inline editor morph
- [ ] Wire click on structured row → JSON preview (flag off) or `DrillInRootToolbar` + embedded drill-in (flag on)
- [ ] Run `pnpm lint-fix` in `web/`
