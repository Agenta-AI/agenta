# Type Chip — Phase 1+2: Foundation + Tables ✅ COMPLETED

> **Status:** Fully implemented and merged. All tasks below are done. Phase 3 is the active branch.

**Goal:** Wire the chip-on-column-header proposal as a generic `InfiniteVirtualTable` feature — so any table can opt in via a `typeChips` prop — then wire the testcase table as the first consumer.

**Current state:** ✅ Complete. All utilities, hooks, and testcase table wiring are live.

**Architecture:** Type detection runs inside `InfiniteVirtualTable` via a new `useTypeChipColumns` hook. The hook receives a `getRowValue` callback (consumer-provided), samples the first 30 rows, runs `detectColumnTypes`, and enhances leaf column titles with `TypeChip` nodes. Group headers keep their `[object]` chip + `±-button` in `TestcasesTableShell` (complex consumer-owned layout), and parent/collapsed group keys opt out of the leaf-chip enhancer by returning `undefined` from `resolveHeaderVariant`. Persisted show/hide state is generic via `typeChips.storageKey` and appears in the table settings dropdown.

**Tech Stack:** React, TypeScript, `@agenta/ui`, Jotai (`atomWithStorage`)

**Spec:** `docs/superpowers/specs/2026-05-12-type-chip-system-design.md`

**Mockup sources:**
- `web/apps/design-mockups/src/components/proposed/TypeChip.tsx`
- `web/apps/design-mockups/src/components/proposed/testsetTableHelpers.ts` → `detectColumnTypes()`
- `web/apps/design-mockups/src/pages/solutions-tables.tsx` → table layout and toggle-button visual references

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `web/packages/agenta-ui/src/InfiniteVirtualTable/utils/detectColumnTypes.ts` | Pure function: rows + columns → Map of type info; exports `defaultHeaderVariant` |
| Modify | `web/packages/agenta-ui/src/InfiniteVirtualTable/index.ts` | Export `detectColumnTypes`, `defaultHeaderVariant`, `ColumnTypeInfo` |
| Modify | `web/packages/agenta-ui/src/InfiniteVirtualTable/types.ts` | Add `TypeChipConfig<RecordType>` interface; add `typeChips?` prop to `InfiniteVirtualTableProps` |
| Create | `web/packages/agenta-ui/src/InfiniteVirtualTable/hooks/useTypeChipColumns.tsx` | Hook: samples rows via `getRowValue`, detects types, returns enhanced columns (`.tsx` — renders JSX) |
| Create | `web/packages/agenta-ui/src/InfiniteVirtualTable/hooks/useTypeChipFeature.tsx` | Generic persisted type-chip visibility state + settings menu item |
| Modify | `web/packages/agenta-ui/src/InfiniteVirtualTable/components/InfiniteVirtualTableInner.tsx` | Call `useTypeChipColumns`; replace `finalColumns` with enhanced result |
| Modify | `web/packages/agenta-ui/src/InfiniteVirtualTable/features/InfiniteVirtualTableFeatureShell.tsx` | Add `typeChips?` to `InfiniteVirtualTableFeatureProps`; resolve visibility and add settings UI |
| Modify | `web/oss/src/components/TestcasesTableNew/components/TestcasesTableShell.tsx` | Replace caret spans with `GroupToggleButton`; add `[object]` TypeChip to group headers; forward `typeChips` prop |
| Modify | `web/oss/src/components/TestcasesTableNew/index.tsx` | Create `getRowValue`; pass `typeChips.storageKey` + `defaultEnabled` |

---

## Task 1: Verify clean starting state

The TypeChip utilities (`TypeChip`, `inferRenderHint`, `getViewOptions`) in `@agenta/ui` are the only chip-related code that exists — they are keepers. The testcase table has **no intermediate chip implementation** to remove; this task confirms the baseline before adding new code.

**Files:**
- `web/oss/src/components/TestcasesTableNew/state/` — should contain only `collapsedGroups.ts`, `rowHeight.ts`, `groupColumns.ts`
- `web/oss/src/components/TestcasesTableNew/utils/` — should contain only `groupColumns.ts`
- `web/oss/src/components/TestcasesTableNew/components/TestcasesTableShell.tsx` — should contain no `TypeChip`, `ChipMode`, or chip resolver imports
- `web/oss/src/components/TestcasesTableNew/index.tsx` — should contain no chip atom imports

- [x] **Confirm the testcase table has no chip code**

```bash
grep -rn "TypeChip\|columnTypeInfo" \
  web/oss/src/components/TestcasesTableNew/ 2>/dev/null
```

Expected: no output

- [x] **Confirm the group headers use caret icons (not a ±-button yet)**

```bash
grep -n "CaretRight\|CaretDown\|GroupToggleButton" \
  web/oss/src/components/TestcasesTableNew/components/TestcasesTableShell.tsx
```

Expected: `CaretRight` and `CaretDown` present — Task 8 will replace them.

Clean slate confirmed — proceed to Task 2.

---

## Task 2: Add `detectColumnTypes` to `@agenta/ui`

**Files:**
- Create: `web/packages/agenta-ui/src/InfiniteVirtualTable/utils/detectColumnTypes.ts`
- Modify: `web/packages/agenta-ui/src/InfiniteVirtualTable/index.ts`

- [x] **Create the file** — ported from `web/apps/design-mockups/src/components/proposed/testsetTableHelpers.ts` → `detectColumnTypes()`, with `defaultHeaderVariant` added:

```typescript
// web/packages/agenta-ui/src/InfiniteVirtualTable/utils/detectColumnTypes.ts

export type ColumnTypePrimitive =
    | "string"
    | "number"
    | "boolean"
    | "null"
    | "json-object"
    | "json-array"

export type ColumnRenderHint = "messages" | "tool-calls" | "stringified" | "markdown"

export interface ColumnTypeInfo {
    type: ColumnTypePrimitive
    hint: ColumnRenderHint | null
}

function isMessagesArray(arr: unknown[]): boolean {
    return (
        arr.length > 0 &&
        arr.every(
            (item) =>
                item != null &&
                typeof item === "object" &&
                "role" in (item as object) &&
                ("content" in (item as object) || "tool_calls" in (item as object)),
        )
    )
}

const TOOL_CALL_KEYS = new Set(["id", "type", "function"])

function isToolCallsArray(arr: unknown[]): boolean {
    return (
        arr.length > 0 &&
        arr.every(
            (item) =>
                item != null &&
                typeof item === "object" &&
                Object.keys(item as object).every((k) => TOOL_CALL_KEYS.has(k)) &&
                (item as {type?: unknown}).type === "function",
        )
    )
}

function isStringifiedJson(s: string): boolean {
    if (s.length < 2 || (s[0] !== "{" && s[0] !== "[")) return false
    try {
        JSON.parse(s)
        return true
    } catch {
        return false
    }
}

function isMarkdownString(s: string): boolean {
    return s.length > 100 || s.includes("\n")
}

/**
 * Computes a per-column type + render-hint from the union of provided row values.
 * Mixed columns (different concrete types across rows) are excluded from the result.
 * Ported from web/apps/design-mockups/.../testsetTableHelpers.ts → detectColumnTypes()
 */
export function detectColumnTypes(
    rows: Record<string, unknown>[],
    columnKeys: string[],
): Map<string, ColumnTypeInfo> {
    const result = new Map<string, ColumnTypeInfo>()

    for (const key of columnKeys) {
        let observedType: ColumnTypePrimitive | null = null
        let observedHint: ColumnRenderHint | null = null
        let sawAnyValue = false
        let sawAnyString = false
        let allStringsStringified = true
        let allStringsMarkdown = true

        for (const row of rows) {
            const v = row[key]
            if (v === undefined) continue
            sawAnyValue = true

            let nextType: ColumnTypePrimitive
            let nextHint: ColumnRenderHint | null = null

            if (v === null) {
                nextType = "null"
            } else if (Array.isArray(v)) {
                nextType = "json-array"
                if (isMessagesArray(v)) nextHint = "messages"
                else if (isToolCallsArray(v)) nextHint = "tool-calls"
            } else if (typeof v === "object") {
                nextType = "json-object"
            } else if (typeof v === "string") {
                sawAnyString = true
                nextType = "string"
                if (!isStringifiedJson(v)) allStringsStringified = false
                if (!isMarkdownString(v)) allStringsMarkdown = false
            } else if (typeof v === "number") {
                nextType = "number"
            } else if (typeof v === "boolean") {
                nextType = "boolean"
            } else {
                continue
            }

            if (observedType === null) {
                observedType = nextType
                observedHint = nextHint
            } else if (observedType === "null" && nextType !== "null") {
                observedType = nextType
                observedHint = nextHint
            } else if (observedType !== nextType && nextType !== "null") {
                observedType = null
                break
            } else if (observedHint !== nextHint && nextType !== "null") {
                observedHint = null
            }
        }

        if (sawAnyValue && observedType !== null) {
            if (observedType === "string" && sawAnyString) {
                if (allStringsStringified) observedHint = "stringified"
                else if (allStringsMarkdown) observedHint = "markdown"
            }
            result.set(key, {type: observedType, hint: observedHint})
        }
    }

    return result
}

/**
 * Returns undefined when typeInfo is undefined (no data detected for column — skip chip).
 */
export function defaultHeaderVariant(
    _colKey: string,
    typeInfo: ColumnTypeInfo | undefined,
): ColumnTypePrimitive | undefined {
    return typeInfo?.type
}
```

- [x] **Export from the InfiniteVirtualTable package index** — add to `web/packages/agenta-ui/src/InfiniteVirtualTable/index.ts` after the grouped-tree-data exports:

```typescript
// ============================================================================
// TYPE CHIP UTILITIES
// ============================================================================

export {defaultHeaderVariant, detectColumnTypes} from "./utils/detectColumnTypes"
export type {ColumnTypeInfo, ColumnTypePrimitive, ColumnRenderHint} from "./utils/detectColumnTypes"
```

- [x] **Verify TypeScript compiles**

```bash
cd web && pnpm --filter @agenta/ui types:check
```

Expected: no errors

- [x] **Commit**

```bash
git add web/packages/agenta-ui/src/InfiniteVirtualTable/utils/detectColumnTypes.ts \
        web/packages/agenta-ui/src/InfiniteVirtualTable/index.ts
git commit -m "feat(@agenta/ui): add detectColumnTypes to InfiniteVirtualTable"
```

---

## Task 3: Add `TypeChipConfig` type and `typeChips` prop to `InfiniteVirtualTable`

**Files:**
- Modify: `web/packages/agenta-ui/src/InfiniteVirtualTable/types.ts`

- [x] **Add the `TypeChipConfig` interface** — insert before the `InfiniteVirtualTableProps` interface in `types.ts`:

```typescript
import type {ColumnTypeInfo, ColumnTypePrimitive} from "./utils/detectColumnTypes"
import type {ChipVariant} from "../type-chip/TypeChip"

/**
 * Configuration for type chip rendering on column headers.
 *
 * When enabled, InfiniteVirtualTable samples the first 30 rows via `getRowValue`,
 * detects per-column types, and enhances leaf column titles with a TypeChip node.
 * Group column headers are NOT enhanced here — consumers handle those.
 *
 * `getRowValue` MUST be stable (useCallback) to prevent re-detection on every render.
 */
export interface TypeChipConfig<RecordType> {
    /** Controlled visibility. When omitted, visibility is managed internally. */
    enabled?: boolean
    /** Callback fired when the built-in settings menu toggles chip visibility. */
    onEnabledChange?: (enabled: boolean) => void
    /** Initial visibility for uncontrolled mode. Defaults to true when typeChips is provided. */
    defaultEnabled?: boolean
    /** LocalStorage key for persisting uncontrolled visibility. */
    storageKey?: string
    /**
     * Returns the raw value for a cell given a row record and column key.
     * Called on the first 30 rows to detect column types.
     * Must be referentially stable (wrap in useCallback).
     */
    getRowValue: (record: RecordType, columnKey: string) => unknown
    /**
     * Custom variant resolver for the column header chip.
     * Receives the column key and detected ColumnTypeInfo (or undefined for undetected columns).
     * Return undefined to skip chip for that column.
     *
     * Default: `defaultHeaderVariant` — renders the detected primitive type.
     */
    resolveHeaderVariant?: (columnKey: string, typeInfo: ColumnTypeInfo | undefined) => ChipVariant | undefined
    /** Show Axis 2 render-hint chips alongside Axis 1. Default false. */
    enableRenderHints?: boolean
    /** Show Axis 3 state/correctness chips. Default false. */
    enableStateChips?: boolean
}
```

- [x] **Add `typeChips` to `InfiniteVirtualTableProps`** — append after the `tableRef` prop inside the `InfiniteVirtualTableProps` interface:

```typescript
/**
 * Configuration for type chip rendering on column headers.
 * When enabled, the table samples rows via `getRowValue`, detects column types,
 * and adds TypeChip nodes to leaf column titles.
 * Default: undefined (no chips).
 */
typeChips?: TypeChipConfig<RecordType>
```

- [x] **Verify TypeScript compiles**

```bash
cd web && pnpm --filter @agenta/ui types:check
```

Expected: no errors

- [x] **Commit**

```bash
git add web/packages/agenta-ui/src/InfiniteVirtualTable/types.ts
git commit -m "feat(@agenta/ui): add TypeChipConfig and typeChips prop to InfiniteVirtualTableProps"
```

---

## Task 4: Create `useTypeChipColumns` hook

**Files:**
- Create: `web/packages/agenta-ui/src/InfiniteVirtualTable/hooks/useTypeChipColumns.tsx`

Note: the file extension is `.tsx` (not `.ts`) because the hook returns JSX nodes (`<TypeChip />`, `<div>`). Other hooks in this directory that return JSX also use `.tsx` (e.g., `useExpandableRows.tsx`, `useRowHeight.tsx`).

- [x] **Create the file**

```typescript
// web/packages/agenta-ui/src/InfiniteVirtualTable/hooks/useTypeChipColumns.tsx

import {useMemo} from "react"
import type {ReactNode} from "react"

import type {ColumnGroupType, ColumnType, ColumnsType} from "antd/es/table"

import {TypeChip} from "../../type-chip/TypeChip"
import {defaultHeaderVariant, detectColumnTypes, type ColumnTypeInfo} from "../utils/detectColumnTypes"
import type {TypeChipConfig} from "../types"

// Collect all leaf column keys from an antd column tree (depth-first)
function collectLeafKeys<R>(columns: ColumnsType<R>): string[] {
    const keys: string[] = []
    for (const col of columns) {
        const asGroup = col as ColumnGroupType<R>
        if (Array.isArray(asGroup.children) && asGroup.children.length > 0) {
            keys.push(...collectLeafKeys(asGroup.children as ColumnsType<R>))
        } else {
            const key = (col as ColumnType<R>).key
            if (typeof key === "string" && key) keys.push(key)
        }
    }
    return keys
}

// Wrap a column title to append a TypeChip at the end
function wrapTitleWithChip(original: ReactNode, chip: ReactNode): ReactNode {
    return (
        <div style={{display: "flex", alignItems: "center", gap: 4, width: "100%", overflow: "hidden"}}>
            <div style={{flex: 1, minWidth: 0, overflow: "hidden"}}>{original}</div>
            <div style={{flexShrink: 0}}>{chip}</div>
        </div>
    )
}

// Walk column tree and enhance leaf column titles with TypeChip nodes.
// Group columns (has children) are not touched — consumers own their complex header layouts.
function enhanceLeafColumns<R>(
    columns: ColumnsType<R>,
    columnTypes: Map<string, ColumnTypeInfo>,
    resolveVariant: (key: string, info: ColumnTypeInfo | undefined) => string | undefined,
): ColumnsType<R> {
    return columns.map((col) => {
        const asGroup = col as ColumnGroupType<R>
        if (Array.isArray(asGroup.children) && asGroup.children.length > 0) {
            // Group column — recurse into children, leave group title unchanged
            return {
                ...col,
                children: enhanceLeafColumns(
                    asGroup.children as ColumnsType<R>,
                    columnTypes,
                    resolveVariant,
                ),
            }
        }
        // Leaf column — compute variant and wrap title
        const key = String((col as ColumnType<R>).key ?? "")
        const typeInfo = columnTypes.get(key)
        const variant = resolveVariant(key, typeInfo)
        if (!variant) return col
        return {
            ...col,
            title: wrapTitleWithChip(
                col.title as ReactNode,
                <TypeChip variant={variant as Parameters<typeof TypeChip>[0]["variant"]} />,
            ),
        }
    })
}

/**
 * Enhances column titles with TypeChip nodes when `typeChips.enabled` is true.
 *
 * Samples the first 30 rows from `dataSource` using `typeChips.getRowValue`,
 * runs `detectColumnTypes`, then wraps each leaf column title with a TypeChip.
 * Group column titles are left unchanged — consumers add their own chips there.
 *
 * Memoized: re-runs only when `columns`, `dataSource`, or `typeChips` config changes.
 * To prevent unnecessary re-runs, the consumer MUST wrap `getRowValue` in `useCallback`.
 */
export function useTypeChipColumns<R extends object>(
    columns: ColumnsType<R>,
    dataSource: R[],
    typeChips: TypeChipConfig<R> | undefined,
): ColumnsType<R> {
    const leafKeys = useMemo(() => collectLeafKeys(columns), [columns])

    const columnTypes = useMemo((): Map<string, ColumnTypeInfo> | null => {
        if (!typeChips?.enabled || !typeChips.getRowValue || !dataSource.length) return null
        const sample = dataSource.slice(0, 30)
        const rows = sample.map((record) => {
            const obj: Record<string, unknown> = {}
            for (const key of leafKeys) {
                obj[key] = typeChips.getRowValue(record, key)
            }
            return obj
        })
        return detectColumnTypes(rows, leafKeys)
    }, [typeChips?.enabled, typeChips?.getRowValue, dataSource, leafKeys])

    return useMemo((): ColumnsType<R> => {
        if (!typeChips?.enabled || !columnTypes) return columns
        const resolveVariant = typeChips.resolveHeaderVariant ?? defaultHeaderVariant
        return enhanceLeafColumns(columns, columnTypes, resolveVariant)
    }, [columns, columnTypes, typeChips?.enabled, typeChips?.resolveHeaderVariant])
}
```

- [x] **Verify TypeScript compiles**

```bash
cd web && pnpm --filter @agenta/ui types:check
```

Expected: no errors

- [x] **Commit**

```bash
git add web/packages/agenta-ui/src/InfiniteVirtualTable/hooks/useTypeChipColumns.tsx
git commit -m "feat(@agenta/ui): add useTypeChipColumns hook for type chip header enhancement"
```

---

## Task 5: Wire `useTypeChipColumns` in `InfiniteVirtualTableInner`

**Files:**
- Modify: `web/packages/agenta-ui/src/InfiniteVirtualTable/components/InfiniteVirtualTableInner.tsx`

- [x] **Add import** — add after the existing hook imports near the top:

```typescript
import {useTypeChipColumns} from "../hooks/useTypeChipColumns"
```

- [x] **Destructure `typeChips` from props** — in the `InfiniteVirtualTableInnerBase` function signature, the props are destructured. Add `typeChips` to the destructuring:

```typescript
// Add alongside the existing destructured props:
typeChips,
```

- [x] **Wire the hook** — find the line `const finalColumns = resizableProcessedColumns` and replace it:

```typescript
const typeChipColumns = useTypeChipColumns(resizableProcessedColumns, dataSource, typeChips)
const finalColumns = typeChipColumns
```

- [x] **Update the `InfiniteVirtualTableInnerProps` type** — the inner component's props type is derived from `InfiniteVirtualTableProps` but excludes `useIsolatedStore` and `store`. `typeChips` is already included automatically since it's part of `InfiniteVirtualTableProps`. No change needed here unless the exclusion list is explicit.

- [x] **Verify TypeScript compiles + lint**

```bash
cd web && pnpm --filter @agenta/ui types:check && pnpm lint-fix
```

Expected: no errors

- [x] **Commit**

```bash
git add web/packages/agenta-ui/src/InfiniteVirtualTable/components/InfiniteVirtualTableInner.tsx
git commit -m "feat(@agenta/ui): wire useTypeChipColumns into InfiniteVirtualTableInner"
```

---

## Task 6: Thread `typeChips` through `InfiniteVirtualTableFeatureShell`

The testcase table uses `InfiniteVirtualTableFeatureShell`, not `InfiniteVirtualTable` directly. The feature shell must forward `typeChips` to the inner table.

**Files:**
- Modify: `web/packages/agenta-ui/src/InfiniteVirtualTable/features/InfiniteVirtualTableFeatureShell.tsx`

- [x] **Add `typeChips` to `InfiniteVirtualTableFeatureProps`** — find the interface (around line 102) and add after `tableRef`:

```typescript
typeChips?: InfiniteVirtualTableProps<Row>["typeChips"]
```

- [x] **Find where `InfiniteVirtualTable` is rendered inside the feature shell** — search for `<InfiniteVirtualTable` in the file. Pass `typeChips` through:

```typescript
<InfiniteVirtualTable
    {/* ...existing props... */}
    typeChips={props.typeChips}
/>
```

- [x] **Verify TypeScript compiles**

```bash
cd web && pnpm --filter @agenta/ui types:check
```

- [x] **Commit**

```bash
git add web/packages/agenta-ui/src/InfiniteVirtualTable/features/InfiniteVirtualTableFeatureShell.tsx
git commit -m "feat(@agenta/ui): thread typeChips prop through InfiniteVirtualTableFeatureShell"
```

---

## Task 7: Create generic type chip visibility feature

Create the generic persisted visibility helper in `@agenta/ui`; do not add testcase-scoped chip atoms.

**Files:**
- Create: `web/packages/agenta-ui/src/InfiniteVirtualTable/hooks/useTypeChipFeature.tsx`
- Modify: `web/packages/agenta-ui/src/InfiniteVirtualTable/index.ts`

- [x] **Create the file**

```typescript
// web/packages/agenta-ui/src/InfiniteVirtualTable/hooks/useTypeChipFeature.tsx
// Owns persisted visibility via `typeChips.storageKey` and exposes settings menu items.
```

- [x] **Export the hook from `@agenta/ui/table`**

- [x] **Verify typecheck passes**

```bash
cd web && pnpm --filter @agenta/ui types:check
```

- [x] **Commit**

```bash
git add web/packages/agenta-ui/src/InfiniteVirtualTable/hooks/useTypeChipFeature.tsx web/packages/agenta-ui/src/InfiniteVirtualTable/index.ts
git commit -m "feat(@agenta/ui): add type chip visibility settings feature"
```

---

## Task 8: Update `TestcasesTableShell` — group headers + `typeChips` forwarding

Leaf column TypeChip rendering is handled by `InfiniteVirtualTable` via the `typeChips` prop (wired in Task 9). `TestcasesTableShell` owns two things: the ±-button on group headers (replacing the existing `CaretRight`/`CaretDown` caret span), and the hardcoded `[object]` TypeChip on group header titles.

**Current state:** Group headers use `<span onClick=...><CaretRight /></span>` / `<CaretDown />`. No TypeChip. No GroupToggleButton.

**Files:**
- Modify: `web/oss/src/components/TestcasesTableNew/components/TestcasesTableShell.tsx`

- [x] **Add imports** at the top of the file:

```typescript
import {TypeChip} from "@agenta/ui/type-chip"
import type {TypeChipConfig} from "@agenta/ui/table"
```

Remove the `CaretRight` and `CaretDown` imports from `phosphor-react` (or `@phosphor-icons/react`) since they're replaced by the ±-button.

- [x] **Define `GroupToggleButton` inline** — add this component near the top of the file (or above the main component, outside the render function):

```tsx
function GroupToggleButton({
    isCollapsed,
    groupPath,
    onToggle,
}: {
    isCollapsed: boolean
    groupPath: string
    onToggle: () => void
}) {
    return (
        <button
            type="button"
            onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                onToggle()
            }}
            aria-label={isCollapsed ? `Expand ${groupPath} group` : `Collapse ${groupPath} group`}
            style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 20,
                height: 20,
                padding: 0,
                borderRadius: 4,
                border: "1px solid rgba(5, 23, 41, 0.18)",
                background: "#f5f5f5",
                color: "#051729",
                fontSize: 14,
                fontWeight: 700,
                lineHeight: 1,
                cursor: "pointer",
                userSelect: "none",
                flexShrink: 0,
                transition: "background 0.12s ease, border-color 0.12s ease, color 0.12s ease",
            }}
            onMouseEnter={(e) => {
                e.currentTarget.style.background = "#e6f4ff"
                e.currentTarget.style.borderColor = "#1677ff"
                e.currentTarget.style.color = "#1677ff"
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.background = "#f5f5f5"
                e.currentTarget.style.borderColor = "rgba(5, 23, 41, 0.18)"
                e.currentTarget.style.color = "#051729"
            }}
        >
            {isCollapsed ? "+" : "−"}
        </button>
    )
}
```

- [x] **Replace group header spans in `createCollapsedColumnDef`** — find the `title` JSX inside `createCollapsedColumnDef`. It currently wraps `<span onClick=...><CaretRight /></span>`. Replace the entire title with:

```tsx
title: (
    <div className="flex items-center gap-1.5 w-full max-w-full overflow-hidden">
        <GroupToggleButton
            isCollapsed
            groupPath={groupPath}
            onToggle={() => toggleGroupCollapse(groupPath)}
        />
        <div className="flex-1 min-w-0">
            <EditableColumnHeader
                columnKey={groupPath}
                columnName={displayName}
                onRename={(_oldName, newName) => handleGroupRename(groupPath, newName)}
                onDelete={() => handleGroupDelete(groupPath)}
                disabled={!isEditable}
                inlineActionsMinWidth={80}
            />
        </div>
        <TypeChip variant="json-object" />
    </div>
),
```

- [x] **Replace group header spans in `renderGroupHeader`** — find the returned JSX. It currently wraps `<span role="button" onClick=...><CaretRight /> / <CaretDown /></span>`. Replace the entire return with:

```tsx
return (
    <div className="flex items-center gap-1.5 w-full max-w-full overflow-hidden">
        <GroupToggleButton
            isCollapsed={isCollapsed}
            groupPath={groupPath}
            onToggle={() => toggleGroupCollapse(groupPath)}
        />
        <div className="flex-1 min-w-0">
            <EditableColumnHeader
                columnKey={groupPath}
                columnName={displayName}
                onRename={(_oldName, newName) => handleGroupRename(groupPath, newName)}
                onDelete={() => handleGroupDelete(groupPath)}
                disabled={!isEditable}
                inlineActionsMinWidth={80}
            />
        </div>
        <TypeChip variant="json-object" />
        {!isTopLevel && (
            <span className="text-gray-400 text-xs flex-shrink-0">({childCount})</span>
        )}
    </div>
)
```

Note: TypeChip comes before the child count badge — this matches the mockup at `web/apps/design-mockups/src/pages/solutions-tables.tsx:519-524`.

- [x] **Add `typeChips?` prop to `TestcasesTableShellProps`** and forward it to `InfiniteVirtualTableFeatureShell`:

```typescript
// Add this import near the top (already imported @agenta/ui/table above for TypeChipConfig):
// import type {TypeChipConfig} from "@agenta/ui/table"   ← already added in step 1

// In TestcasesTableShellProps — add after existing props:
typeChips?: TypeChipConfig<TestcaseTableRow>

// In the InfiniteVirtualTableFeatureShell render at the bottom, add:
typeChips={props.typeChips}
```

- [x] **Verify TypeScript compiles + lint**

```bash
cd web && pnpm lint-fix
```

- [x] **Commit**

```bash
git add web/oss/src/components/TestcasesTableNew/components/TestcasesTableShell.tsx
git commit -m "feat(testcases-table): add group header ±-button and TypeChip, forward typeChips prop"
```

---

## Task 9: Wire `typeChips` in `TestcasesTableNew/index.tsx`

**Files:**
- Modify: `web/oss/src/components/TestcasesTableNew/index.tsx`

Use the same OSS testcase controller that powers table cells so header detection samples the same values users see in cells.

- [x] **Add imports**

```typescript
import {useCallback} from "react"
import {getDefaultStore} from "jotai/vanilla"
import {testcase} from "@/oss/state/entities/testcase"
import type {TestcaseTableRow} from "@/oss/state/entities/testcase"
```

- [x] **Create `getRowValue`** — add in the component body:

```typescript
const getRowValue = useCallback(
    (record: TestcaseTableRow, columnKey: string): unknown => {
        const id = record.id ?? String(record.key)
        return getDefaultStore().get(testcase.selectors.cell({id, column: columnKey}))
    },
    [],
)
```

`testcase.selectors.cell(...)` is the same selector used by `TestcaseCell`, so detection follows dot-path columns and local drafts consistently with cell rendering.

- [x] **Pass `typeChips` to `TestcasesTableShell`**

```tsx
<TestcasesTableShell
    {/* ...existing props... */}
    typeChips={{
        defaultEnabled: true,
        storageKey: "agenta:testcase-table:type-chips-enabled",
        getRowValue,
    }}
/>
```

- [x] **Verify TypeScript compiles + lint**

```bash
cd web && pnpm lint-fix
```

- [x] **Commit**

```bash
git add web/oss/src/components/TestcasesTableNew/index.tsx
git commit -m "feat(testcases-table): wire typeChips prop with testcase cell sampling"
```

---

## Task 10: Final lint + visual verification

- [x] **Full lint-fix**

```bash
cd web && pnpm lint-fix
```

Expected: clean — no lint errors

- [x] **TypeScript check on all modified packages**

```bash
cd web && pnpm --filter @agenta/ui types:check
```

Expected: no errors

- [x] **Visual verification** — open the testset table and use the table settings menu to show/hide type chips:

```bash
cd web && pnpm dev
```

Expected in the browser:
1. Leaf column headers show TypeChip (`[string]`, `[boolean]`, `[object]`)
2. Group headers (expanded) show `[object]` chip + `±-button`
3. Group headers (collapsed) show `[object]` chip + `+` button
4. Setting localStorage key `agenta:testcase-table:chip-mode` → `"none"` hides all chips
5. No regressions in cell rendering
6. Any other table using `InfiniteVirtualTable` WITHOUT `typeChips` prop shows zero chip rendering

- [x] **Verify no chip rendering on unrelated tables** — open another table in the app (traces, evaluations) and confirm no TypeChip appears on their headers. These tables don't pass `typeChips` so nothing should change.
