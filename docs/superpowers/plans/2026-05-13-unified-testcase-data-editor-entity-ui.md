# Unified Testcase Data Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote testcase data rendering/editing into `@agenta/entity-ui/testcase` so the testset drawer, playground testcase editor, and read-only testcase previews share one behavior model.

**Architecture:** `@agenta/entity-ui` owns a presentational `TestcaseDataEditor` with a plain `value/onChange` API. OSS and playground wrappers remain responsible for state adapters, save/commit shell actions, and schema/column sourcing. The shared editor owns root view-mode/collapse toolbar state, injects an editable field renderer into `DrillInContent`, and exposes `mode="view" | "edit"` plus `surface="drawer" | "playground" | "inline"` with a small `features` object only for optional cross-surface controls.

**Tech Stack:** React, TypeScript, `@agenta/entity-ui/testcase`, `@agenta/ui/drill-in`, `@agenta/ui/type-chip`, `@agenta/shared/utils`, Jotai adapters in OSS

---

## Scope

This plan unifies testcase data UI only. It does not change testset persistence, playground execution state, commit/save modals, add-to-queue behavior, or table cell rendering.

The shared editor must support:

- `mode="view"`: read-only data inspection, no add/delete/mapping/edit controls.
- `mode="edit"`: editable values, add/delete controls when the surface allows them.
- `surface="drawer"`: drawer-friendly spacing, root toolbar, field headers, full drill-in body.
- `surface="playground"`: compact embedded layout suitable for playground panels.
- `surface="inline"`: compact read-only/editable embedded inspector.

Keep feature controls minimal:

```typescript
type TestcaseDataEditorFeatures = {
    typeChips?: boolean
    rootViewMode?: boolean
    compactRows?: boolean
    columnMapping?: boolean
}
```

Defaults are derived from `mode` and `surface`; callers override only when necessary.

Hard requirements:

- `TestcaseDataEditor` must not use bare `DrillInContent` without a renderer. The default `DrillInContent` renderer is read-only `<pre>` output, so the shared editor must pass a field renderer adapter that provides editable text, number, boolean, JSON object/array, and read-only preview behavior.
- Root toolbar ownership is singular. Once a surface migrates to `TestcaseDataEditor`, the parent drawer/shell must not render its own `DrillInRootToolbar`.
- Dotted column keys are not automatically nested paths. Flat keys such as `agents.md` are valid. The shared editor must read direct keys first and write direct keys by default unless column metadata explicitly opts into nested path behavior.
- Playground compact editing must stay schema-aware. Numbers, booleans, nulls, and JSON values must not be coerced through a plain string input.

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `web/packages/agenta-entity-ui/src/testcase/TestcaseDataEditor.types.ts` | Public props, modes, surface presets, column metadata, feature types |
| Create | `web/packages/agenta-entity-ui/src/testcase/TestcaseDataEditor.utils.ts` | Pure helpers for root items, path updates, feature defaults, preview formatting |
| Create | `web/packages/agenta-entity-ui/src/testcase/TestcaseDrillInFieldRenderer.tsx` | Editable renderer adapter for `DrillInContent` |
| Create | `web/packages/agenta-entity-ui/src/testcase/TestcaseDataEditor.tsx` | Shared drill-in based testcase editor/viewer |
| Create | `web/packages/agenta-entity-ui/src/testcase/TestcaseCompactRows.tsx` | Playground/inline compact variable rows |
| Modify | `web/packages/agenta-entity-ui/src/testcase/index.ts` | Export `TestcaseDataEditor` and public types |
| Modify | `web/packages/agenta-entity-ui/src/index.ts` | Re-export testcase editor types from package root |
| Modify | `web/packages/agenta-entity-ui/src/testcase/TestcaseDrawer.tsx` | Keep drawer chrome/shell; remove editor-specific root toolbar ownership if it moves into `TestcaseDataEditor` |
| Modify | `web/oss/src/components/TestcasesTableNew/components/TestcaseEditDrawer/index.tsx` | Replace direct `EntityDualViewEditor` use with `TestcaseDataEditor` and OSS testcase adapter |
| Modify | `web/oss/src/components/Playground/Components/PlaygroundTestcaseEditor.tsx` | Replace custom testcase body with `TestcaseDataEditor` using playground adapter |
| Modify | `web/oss/src/components/SharedDrawers/TestcaseDrawer/index.tsx` | Pass drawer render props through to the new shared editor adapter |

---

## Public API

The target public API in `@agenta/entity-ui/testcase`:

```typescript
export type TestcaseDataEditorMode = "view" | "edit"
export type TestcaseDataEditorSurface = "drawer" | "playground" | "inline"

export interface TestcaseDataEditorColumn {
    key: string
    name?: string
    label?: string
    type?: string
    schema?: unknown
    pathMode?: "direct" | "nested" | "auto"
}

export interface TestcaseDataEditorFeatures {
    typeChips?: boolean
    rootViewMode?: boolean
    compactRows?: boolean
    columnMapping?: boolean
}

export interface TestcaseDataEditorProps {
    value: Record<string, unknown> | null | undefined
    columns?: TestcaseDataEditorColumn[]
    onChange?: (nextValue: Record<string, unknown>) => void
    mode?: TestcaseDataEditorMode
    surface?: TestcaseDataEditorSurface
    title?: string
    features?: TestcaseDataEditorFeatures
    initialPath?: string[]
    onPathChange?: (path: string[]) => void
    className?: string
    columnOptions?: {value: string; label: string}[]
    mappedPaths?: Map<string, string>
    onMapToColumn?: (dataPath: string, column: string) => void
    onUnmap?: (dataPath: string) => void
    onCopy?: () => void
    getDefaultValueForType?: (type: "string" | "number" | "boolean" | "object" | "array") => unknown
}
```

Rules:

- `value` is the testcase data object only, not the whole testcase entity.
- `onChange` receives the whole next testcase data object.
- `mode="view"` ignores `onChange`, add, delete, and mapping callbacks.
- `surface` determines default spacing and feature defaults.
- `features` only overrides surface defaults.
- `pathMode` controls dotted column semantics:
  - `"direct"` writes to `value[column.key]` even when the key contains dots.
  - `"nested"` writes to `setValueAtPath(value, column.key.split("."), nextValue)`.
  - `"auto"` reads direct key first, falls back to nested read, and writes direct if the direct key currently exists; otherwise writes nested.
  - default is `"direct"` to preserve flat dotted testcase columns.

---

## Task 1: Add Public Types and Pure Helpers

**Files:**
- Create: `web/packages/agenta-entity-ui/src/testcase/TestcaseDataEditor.types.ts`
- Create: `web/packages/agenta-entity-ui/src/testcase/TestcaseDataEditor.utils.ts`

- [ ] **Step 1: Create `TestcaseDataEditor.types.ts`**

```typescript
import type {PropertyType, RootViewMode} from "@agenta/ui/drill-in"

export type TestcaseDataEditorMode = "view" | "edit"
export type TestcaseDataEditorSurface = "drawer" | "playground" | "inline"

export interface TestcaseDataEditorColumn {
    key: string
    name?: string
    label?: string
    type?: string
    schema?: unknown
    pathMode?: "direct" | "nested" | "auto"
}

export interface TestcaseDataEditorFeatures {
    typeChips?: boolean
    rootViewMode?: boolean
    compactRows?: boolean
    columnMapping?: boolean
}

export interface TestcaseDataEditorResolvedFeatures {
    typeChips: boolean
    rootViewMode: boolean
    compactRows: boolean
    columnMapping: boolean
}

export interface TestcaseDataEditorProps {
    value: Record<string, unknown> | null | undefined
    columns?: TestcaseDataEditorColumn[]
    onChange?: (nextValue: Record<string, unknown>) => void
    mode?: TestcaseDataEditorMode
    surface?: TestcaseDataEditorSurface
    title?: string
    features?: TestcaseDataEditorFeatures
    initialPath?: string[]
    onPathChange?: (path: string[]) => void
    className?: string
    columnOptions?: {value: string; label: string}[]
    mappedPaths?: Map<string, string>
    onMapToColumn?: (dataPath: string, column: string) => void
    onUnmap?: (dataPath: string) => void
    onCopy?: () => void
    getDefaultValueForType?: (type: PropertyType) => unknown
}

export interface TestcaseDataEditorRootItem {
    key: string
    name: string
    value: unknown
    isColumn: boolean
}

export interface TestcaseCompactRowsProps {
    value: Record<string, unknown>
    columns?: TestcaseDataEditorColumn[]
    mode: TestcaseDataEditorMode
    rootViewMode: RootViewMode
    features: TestcaseDataEditorResolvedFeatures
    onChange?: (nextValue: Record<string, unknown>) => void
}
```

- [ ] **Step 2: Create `TestcaseDataEditor.utils.ts`**

```typescript
import {getValueAtPath, setValueAtPath, type DataPath} from "@agenta/shared/utils"

import type {
    TestcaseDataEditorColumn,
    TestcaseDataEditorFeatures,
    TestcaseDataEditorResolvedFeatures,
    TestcaseDataEditorRootItem,
    TestcaseDataEditorSurface,
} from "./TestcaseDataEditor.types"

export function normalizeTestcaseData(
    value: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {}
}

function normalizeObjectValue(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {}
}

export function resolveTestcaseEditorFeatures(
    surface: TestcaseDataEditorSurface,
    features?: TestcaseDataEditorFeatures,
): TestcaseDataEditorResolvedFeatures {
    const defaults: Record<TestcaseDataEditorSurface, TestcaseDataEditorResolvedFeatures> = {
        drawer: {
            typeChips: true,
            rootViewMode: true,
            compactRows: false,
            columnMapping: true,
        },
        playground: {
            typeChips: true,
            rootViewMode: true,
            compactRows: true,
            columnMapping: false,
        },
        inline: {
            typeChips: true,
            rootViewMode: true,
            compactRows: false,
            columnMapping: false,
        },
    }

    return {...defaults[surface], ...features}
}

export function getTestcaseRootItems(
    value: Record<string, unknown>,
    columns?: TestcaseDataEditorColumn[],
): TestcaseDataEditorRootItem[] {
    if (columns?.length) {
        return columns.map((column) => ({
            key: column.key,
            name: column.label ?? column.name ?? column.key,
            value: getTestcaseColumnValue(value, column) ?? "",
            isColumn: true,
        }))
    }

    return Object.keys(value)
        .sort()
        .map((key) => ({
            key,
            name: key,
            value: value[key],
            isColumn: false,
        }))
}

export function getTestcaseColumnValue(
    value: Record<string, unknown>,
    column: TestcaseDataEditorColumn,
): unknown {
    const mode = column.pathMode ?? "direct"

    if (mode === "direct") {
        return value[column.key]
    }

    if (mode === "nested") {
        return getValueAtPath(value, column.key.split("."))
    }

    const directValue = value[column.key]
    return directValue !== undefined ? directValue : getValueAtPath(value, column.key.split("."))
}

export function setTestcaseColumnValue(
    value: Record<string, unknown>,
    column: TestcaseDataEditorColumn,
    nextValue: unknown,
): Record<string, unknown> {
    const mode = column.pathMode ?? "direct"

    if (mode === "nested") {
        return normalizeTestcaseData(
            setValueAtPath(value, column.key.split(".") as DataPath, nextValue) as Record<
                string,
                unknown
            >,
        )
    }

    if (mode === "auto" && value[column.key] === undefined) {
        return normalizeTestcaseData(
            setValueAtPath(value, column.key.split(".") as DataPath, nextValue) as Record<
                string,
                unknown
            >,
        )
    }

    return {...value, [column.key]: nextValue}
}

export function getTestcasePathValue(
    value: Record<string, unknown>,
    path: string[],
    columns?: TestcaseDataEditorColumn[],
): unknown {
    if (path.length === 0) return value

    const column = columns?.find((candidate) => candidate.key === path[0])
    if (!column) return getValueAtPath(value, path)

    const columnValue = getTestcaseColumnValue(value, column)
    if (path.length === 1) return columnValue
    return getValueAtPath(normalizeObjectValue(columnValue), path.slice(1))
}

export function setTestcasePathValue(
    value: Record<string, unknown>,
    path: string[],
    nextValue: unknown,
    columns?: TestcaseDataEditorColumn[],
): Record<string, unknown> {
    if (path.length === 0) {
        return normalizeTestcaseData(nextValue as Record<string, unknown>)
    }

    const column = columns?.find((candidate) => candidate.key === path[0])
    if (!column) {
        return normalizeTestcaseData(setValueAtPath(value, path as DataPath, nextValue) as Record<
            string,
            unknown
        >)
    }

    if (path.length === 1) {
        return setTestcaseColumnValue(value, column, nextValue)
    }

    const currentColumnValue = getTestcaseColumnValue(value, column)
    const nextColumnValue = setValueAtPath(
        normalizeObjectValue(currentColumnValue),
        path.slice(1) as DataPath,
        nextValue,
    )

    return setTestcaseColumnValue(value, column, nextColumnValue)
}

export function formatCompactPreview(value: unknown, maxLength = 80): string {
    const raw =
        value === null || value === undefined
            ? String(value ?? "")
            : typeof value === "string"
              ? value
              : typeof value === "number" || typeof value === "boolean"
                ? String(value)
                : JSON.stringify(value)

    if (!raw) return ""
    return raw.length > maxLength ? `${raw.slice(0, maxLength)}...` : raw
}
```

- [ ] **Step 3: Verify the package compiles**

Run:

```bash
cd web/packages/agenta-entity-ui && pnpm types:check
```

Expected: PASS with `tsc --noEmit`.

- [ ] **Step 4: Commit**

```bash
git add web/packages/agenta-entity-ui/src/testcase/TestcaseDataEditor.types.ts web/packages/agenta-entity-ui/src/testcase/TestcaseDataEditor.utils.ts
git commit -m "feat(entity-ui): add testcase data editor types and helpers"
```

---

## Task 2: Build `TestcaseDataEditor` Drill-In Surface

**Files:**
- Create: `web/packages/agenta-entity-ui/src/testcase/TestcaseDrillInFieldRenderer.tsx`
- Create: `web/packages/agenta-entity-ui/src/testcase/TestcaseDataEditor.tsx`

- [ ] **Step 1: Create the editable renderer adapter**

`DrillInContent`'s fallback renderer is display-only. Create an adapter that satisfies `CoreFieldRendererProps` and provides real editors for edit mode.

```typescript
import {useMemo} from "react"

import {EditorProvider} from "@agenta/ui/editor"
import {JsonEditorWithLocalState, type CoreFieldRendererProps} from "@agenta/ui/drill-in"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {InputNumber, Switch} from "antd"

function toDisplayString(value: unknown): string {
    if (typeof value === "string") return value
    const json = JSON.stringify(value, null, 2)
    return json ?? ""
}

function parseJsonEditorValue(value: string, fallback: unknown): unknown {
    try {
        return JSON.parse(value)
    } catch {
        return fallback
    }
}

export function TestcaseDrillInFieldRenderer({
    value,
    editable,
    onChange,
    fullPathKey,
    dataType,
    isRawMode,
    viewMode,
}: CoreFieldRendererProps) {
    const displayValue = useMemo(() => toDisplayString(value), [value])

    if (!editable || isRawMode) {
        return (
            <pre className="text-xs font-mono whitespace-pre-wrap break-words m-0 p-3 bg-gray-50 rounded-md max-h-[200px] overflow-auto">
                {displayValue}
            </pre>
        )
    }

    if (dataType === "number") {
        return (
            <InputNumber
                className="w-full"
                size="middle"
                value={typeof value === "number" ? value : Number(value)}
                onChange={(nextValue) => onChange(nextValue ?? 0)}
            />
        )
    }

    if (dataType === "boolean") {
        return (
            <Switch
                checked={Boolean(value)}
                onChange={(checked) => onChange(checked)}
                size="small"
            />
        )
    }

    if (
        dataType === "json-object" ||
        dataType === "json-array" ||
        dataType === "messages" ||
        viewMode === "json" ||
        viewMode === "yaml"
    ) {
        return (
            <JsonEditorWithLocalState
                editorKey={`testcase-field-${fullPathKey}`}
                initialValue={displayValue}
                onValidChange={(nextValue) => onChange(parseJsonEditorValue(nextValue, value))}
            />
        )
    }

    const editorId = `testcase-field-${fullPathKey}`

    return (
        <EditorProvider
            key={`${editorId}-provider`}
            id={editorId}
            initialValue={typeof value === "string" ? value : displayValue}
            showToolbar={false}
            enableTokens
        >
            <SharedEditor
                id={editorId}
                initialValue={typeof value === "string" ? value : displayValue}
                handleChange={(nextValue) => onChange(nextValue)}
                editorType="border"
                className="overflow-hidden"
                disableDebounce
                noProvider
            />
        </EditorProvider>
    )
}
```

- [ ] **Step 2: Create the shared editor component**

```typescript
import {useCallback, useMemo, useState} from "react"

import {
    DrillInContent,
    DrillInRootToolbar,
    getViewOptions,
    type PropertyType,
    type RootViewMode,
} from "@agenta/ui/drill-in"
import {TypeChip} from "@agenta/ui/type-chip"

import type {TestcaseDataEditorProps} from "./TestcaseDataEditor.types"
import {TestcaseDrillInFieldRenderer} from "./TestcaseDrillInFieldRenderer"
import {
    getTestcasePathValue,
    getTestcaseRootItems,
    normalizeTestcaseData,
    resolveTestcaseEditorFeatures,
    setTestcasePathValue,
} from "./TestcaseDataEditor.utils"

const DEFAULT_VALUE_BY_TYPE: Record<PropertyType, unknown> = {
    string: "",
    number: 0,
    boolean: false,
    object: {},
    array: [],
}

export function TestcaseDataEditor({
    value,
    columns,
    onChange,
    mode = "edit",
    surface = "drawer",
    title = "Testcase Data",
    features,
    initialPath,
    onPathChange,
    className,
    columnOptions,
    mappedPaths,
    onMapToColumn,
    onUnmap,
    onCopy,
    getDefaultValueForType,
}: TestcaseDataEditorProps) {
    const [rootViewMode, setRootViewMode] = useState<RootViewMode>("text")
    const [collapseSignal, setCollapseSignal] = useState(0)

    const resolvedValue = useMemo(() => normalizeTestcaseData(value), [value])
    const resolvedFeatures = useMemo(
        () => resolveTestcaseEditorFeatures(surface, features),
        [surface, features],
    )

    const editable = mode === "edit" && !!onChange

    const getValue = useCallback(
        (path: string[]): unknown => {
            return getTestcasePathValue(resolvedValue, path, columns)
        },
        [resolvedValue, columns],
    )

    const setValue = useCallback(
        (path: string[], nextValue: unknown) => {
            if (!editable) return
            onChange?.(setTestcasePathValue(resolvedValue, path, nextValue, columns))
        },
        [editable, onChange, resolvedValue, columns],
    )

    const getRootItems = useCallback(
        () => getTestcaseRootItems(resolvedValue, columns),
        [resolvedValue, columns],
    )

    const defaultValueForType = useCallback(
        (type: PropertyType) => getDefaultValueForType?.(type) ?? DEFAULT_VALUE_BY_TYPE[type] ?? "",
        [getDefaultValueForType],
    )

    return (
        <div className={className}>
            {resolvedFeatures.rootViewMode && (
                <DrillInRootToolbar
                    label={title}
                    viewMode={rootViewMode}
                    onViewModeChange={setRootViewMode}
                    onCollapseAll={() => setCollapseSignal((signal) => signal + 1)}
                    onCopy={onCopy}
                    enableFormView={false}
                />
            )}

            <DrillInContent
                getValue={getValue}
                setValue={setValue}
                getRootItems={getRootItems}
                FieldRenderer={TestcaseDrillInFieldRenderer}
                valueMode="native"
                rootTitle="Root"
                editable={editable}
                showAddControls={editable}
                showDeleteControls={editable && !columns?.length}
                initialPath={initialPath}
                onPathChange={onPathChange}
                columnOptions={resolvedFeatures.columnMapping && editable ? columnOptions : undefined}
                mappedPaths={resolvedFeatures.columnMapping && editable ? mappedPaths : undefined}
                onMapToColumn={resolvedFeatures.columnMapping && editable ? onMapToColumn : undefined}
                onUnmap={resolvedFeatures.columnMapping && editable ? onUnmap : undefined}
                getDefaultValueForType={defaultValueForType}
                collapseSignal={collapseSignal}
                viewModeResetSignal={rootViewMode}
                enableFieldViewModes={resolvedFeatures.rootViewMode}
                getFieldViewModeOptions={({value}) => getViewOptions(value)}
                getDefaultFieldViewMode={({options}) =>
                    options.includes(rootViewMode) ? rootViewMode : (options[0] ?? "json")
                }
                getFieldTypeChip={
                    resolvedFeatures.typeChips ? (fieldValue) => <TypeChip value={fieldValue} /> : undefined
                }
                hideBreadcrumb={surface === "drawer"}
            />
        </div>
    )
}
```

- [ ] **Step 3: Verify TypeScript**

Run:

```bash
cd web/packages/agenta-entity-ui && pnpm types:check
```

Expected: PASS with `tsc --noEmit`.

- [ ] **Step 4: Commit**

```bash
git add web/packages/agenta-entity-ui/src/testcase/TestcaseDrillInFieldRenderer.tsx web/packages/agenta-entity-ui/src/testcase/TestcaseDataEditor.tsx
git commit -m "feat(entity-ui): add shared testcase data editor"
```

---

## Task 3: Add Compact Rows for Playground Surface

**Files:**
- Create: `web/packages/agenta-entity-ui/src/testcase/TestcaseCompactRows.tsx`
- Modify: `web/packages/agenta-entity-ui/src/testcase/TestcaseDataEditor.tsx`

- [ ] **Step 1: Create compact rows component**

```typescript
import {useCallback, useMemo, useState} from "react"

import {CaretDown, CaretRight} from "@phosphor-icons/react"
import {JsonEditorWithLocalState} from "@agenta/ui/drill-in"
import {TypeChip} from "@agenta/ui/type-chip"
import {InputNumber, Switch} from "antd"

import type {TestcaseCompactRowsProps} from "./TestcaseDataEditor.types"
import {formatCompactPreview, getTestcaseRootItems, setTestcasePathValue} from "./TestcaseDataEditor.utils"

function CompactRow({
    name,
    value,
    type,
    editable,
    onChange,
}: {
    name: string
    value: unknown
    type?: string
    editable: boolean
    onChange?: (nextValue: unknown) => void
}) {
    const [expanded, setExpanded] = useState(false)
    const isJsonType =
        type === "object" ||
        type === "array" ||
        Array.isArray(value) ||
        (!!value && typeof value === "object")

    const jsonEditorValue = useMemo(() => {
        if (typeof value === "string") return value
        const stringified = JSON.stringify(value, null, 2)
        return stringified ?? "null"
    }, [value])

    return (
        <div className="border-0 border-b border-solid border-[rgba(5,23,41,0.06)]">
            <button
                type="button"
                className="w-full min-h-8 px-3 py-1 flex items-center gap-2 bg-transparent border-none text-left cursor-pointer"
                onClick={() => setExpanded((open) => !open)}
            >
                <span className="text-[rgba(5,23,41,0.45)] flex items-center">
                    {expanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
                </span>
                <span className="text-xs font-semibold text-[#051729] shrink-0">{name}</span>
                <TypeChip value={value} />
                {!expanded && (
                    <span className="text-xs text-[rgba(5,23,41,0.45)] truncate min-w-0">
                        {formatCompactPreview(value)}
                    </span>
                )}
            </button>

            {expanded && (
                <div className="px-3 pb-2">
                    {editable && (type === "number" || type === "integer" || typeof value === "number") ? (
                        <InputNumber
                            className="w-full"
                            size="small"
                            value={value !== null && value !== undefined ? Number(value) : undefined}
                            onChange={(nextValue) => onChange?.(nextValue ?? 0)}
                        />
                    ) : editable && (type === "boolean" || typeof value === "boolean") ? (
                        <Switch
                            checked={Boolean(value)}
                            onChange={(checked) => onChange?.(checked)}
                            size="small"
                        />
                    ) : editable && isJsonType ? (
                        <JsonEditorWithLocalState
                            editorKey={`compact-${name}`}
                            initialValue={jsonEditorValue}
                            onValidChange={(nextValue) => {
                                try {
                                    onChange?.(JSON.parse(nextValue))
                                } catch {
                                    // JsonEditorWithLocalState calls onValidChange only for valid JSON.
                                }
                            }}
                        />
                    ) : editable && value !== null ? (
                        <input
                            className="w-full text-xs px-2 py-1 border border-solid border-[rgba(5,23,41,0.18)] rounded"
                            value={String(value ?? "")}
                            onChange={(event) => onChange?.(event.target.value)}
                        />
                    ) : (
                        <pre className="text-xs whitespace-pre-wrap break-words m-0 p-2 bg-[#FAFAFA] rounded">
                            {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
                        </pre>
                    )}
                </div>
            )}
        </div>
    )
}

export function TestcaseCompactRows({
    value,
    columns,
    mode,
    features,
    onChange,
}: TestcaseCompactRowsProps) {
    const items = useMemo(() => getTestcaseRootItems(value, columns), [value, columns])
    const editable = mode === "edit" && !!onChange

    const handleChange = useCallback(
        (key: string, nextValue: unknown) => {
            onChange?.(setTestcasePathValue(value, [key], nextValue, columns))
        },
        [columns, onChange, value],
    )

    return (
        <div className="rounded border border-solid border-[rgba(5,23,41,0.06)] bg-white overflow-hidden">
            {items.map((item) => (
                <CompactRow
                    key={item.key}
                    name={item.name}
                    value={item.value}
                    type={columns?.find((column) => column.key === item.key)?.type}
                    editable={editable}
                    onChange={
                        features.compactRows && editable
                            ? (nextValue) => handleChange(item.key, nextValue)
                            : undefined
                    }
                />
            ))}
        </div>
    )
}
```

- [ ] **Step 2: Route `surface="playground"` through compact rows**

In `TestcaseDataEditor.tsx`, import `TestcaseCompactRows`:

```typescript
import {TestcaseCompactRows} from "./TestcaseCompactRows"
```

Then insert before the `return` statement:

```typescript
if (resolvedFeatures.compactRows) {
    return (
        <div className={className}>
            {resolvedFeatures.rootViewMode && (
                <DrillInRootToolbar
                    label={title}
                    viewMode={rootViewMode}
                    onViewModeChange={setRootViewMode}
                    onCollapseAll={() => setCollapseSignal((signal) => signal + 1)}
                    onCopy={onCopy}
                    enableFormView={false}
                />
            )}
            <TestcaseCompactRows
                value={resolvedValue}
                columns={columns}
                mode={mode}
                rootViewMode={rootViewMode}
                features={resolvedFeatures}
                onChange={editable ? onChange : undefined}
            />
        </div>
    )
}
```

- [ ] **Step 3: Verify TypeScript and lint**

Run:

```bash
cd web/packages/agenta-entity-ui && pnpm types:check
cd ../../ && pnpm lint-fix
```

Expected: entity-ui type check passes and repo lint fix completes.

- [ ] **Step 4: Commit**

```bash
git add web/packages/agenta-entity-ui/src/testcase/TestcaseCompactRows.tsx web/packages/agenta-entity-ui/src/testcase/TestcaseDataEditor.tsx
git commit -m "feat(entity-ui): add compact testcase rows surface"
```

---

## Task 4: Export the Shared Editor

**Files:**
- Modify: `web/packages/agenta-entity-ui/src/testcase/index.ts`
- Modify: `web/packages/agenta-entity-ui/src/index.ts`

- [ ] **Step 1: Export from testcase subpath**

Update `web/packages/agenta-entity-ui/src/testcase/index.ts`:

```typescript
/**
 * Testcase UI Components
 *
 * Reusable UI components for testcase entity display and selection.
 */

export {TestcaseTable, type TestcaseTableProps} from "./TestcaseTable"
export {default as TestcaseDrawer} from "./TestcaseDrawer"
export type {TestcaseDrawerContentRenderProps, TestcaseDrawerProps} from "./TestcaseDrawer"
export {TestcaseDataEditor} from "./TestcaseDataEditor"
export type {
    TestcaseDataEditorColumn,
    TestcaseDataEditorFeatures,
    TestcaseDataEditorMode,
    TestcaseDataEditorProps,
    TestcaseDataEditorSurface,
} from "./TestcaseDataEditor.types"
```

- [ ] **Step 2: Export from package root**

Add to `web/packages/agenta-entity-ui/src/index.ts` near the existing testcase exports:

```typescript
export {
    TestcaseDataEditor,
    type TestcaseDataEditorColumn,
    type TestcaseDataEditorFeatures,
    type TestcaseDataEditorMode,
    type TestcaseDataEditorProps,
    type TestcaseDataEditorSurface,
} from "./testcase"
```

- [ ] **Step 3: Verify package exports**

Run:

```bash
cd web/packages/agenta-entity-ui && pnpm types:check
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/packages/agenta-entity-ui/src/testcase/index.ts web/packages/agenta-entity-ui/src/index.ts
git commit -m "feat(entity-ui): export testcase data editor"
```

---

## Task 5: Migrate Testset Drawer Content to `TestcaseDataEditor`

**Files:**
- Modify: `web/packages/agenta-entity-ui/src/testcase/TestcaseDrawer.tsx`
- Modify: `web/oss/src/components/SharedDrawers/TestcaseDrawer/index.tsx`
- Modify: `web/oss/src/components/TestcasesTableNew/components/TestcaseEditDrawer/index.tsx`

- [ ] **Step 1: Move root toolbar ownership out of the drawer shell**

In `web/packages/agenta-entity-ui/src/testcase/TestcaseDrawer.tsx`, remove the parent-owned root toolbar state and JSX:

```typescript
// Remove these state values:
const [rootViewMode, setRootViewMode] = useState<RootViewMode>("text")
const [collapseSignal, setCollapseSignal] = useState(0)

// Remove this handler:
const handleCollapseAll = useCallback(() => {
    setCollapseSignal((signal) => signal + 1)
}, [])

// Remove the <DrillInRootToolbar ... /> block from the drawer body.
```

Update `TestcaseDrawerContentRenderProps` so the shell still exposes copy behavior but not toolbar state:

```typescript
export interface TestcaseDrawerContentRenderProps {
    editMode: EditMode
    onEditModeChange: (mode: EditMode) => void
    initialPath: string[]
    onPathChange: (path: string[]) => void
    onCopyTestcase: () => void
}
```

Update the `renderContent` call:

```typescript
renderContent({
    editMode,
    onEditModeChange: setEditMode,
    initialPath: drillInPath,
    onPathChange: setDrillInPath,
    onCopyTestcase: handleCopyTestcase,
})
```

After this step, `TestcaseDrawer` remains shell-only: title, navigation, add-to-queue, footer, save/apply actions, and session restore.

- [ ] **Step 2: Replace `EntityDualViewEditor` import with `TestcaseDataEditor`**

Remove:

```typescript
import {TypeChip} from "@agenta/ui/type-chip"
import {EntityDualViewEditor, type PropertyType} from "@/oss/components/DrillInView"
```

Add:

```typescript
import {TestcaseDataEditor, type TestcaseDataEditorColumn} from "@agenta/entity-ui/testcase"
import {type PropertyType} from "@agenta/ui/drill-in"
import {useAtomValue, useSetAtom} from "jotai"
```

Also add `useMemo` to the React import if it is not already present:

```typescript
import {forwardRef, useCallback, useImperativeHandle, useMemo, useState} from "react"
```

- [ ] **Step 3: Pass copy callback through the shared drawer adapter**

In `web/oss/src/components/SharedDrawers/TestcaseDrawer/index.tsx`, update the render callback destructuring:

```typescript
({
    editMode,
    onEditModeChange,
    initialPath,
    onPathChange,
    onCopyTestcase,
}: TestcaseDrawerContentRenderProps): ReactNode => (
```

Pass it into `TestcaseEditDrawerContent`:

```tsx
<TestcaseEditDrawerContent
    key={testcaseId}
    testcaseId={testcaseId!}
    columns={columns}
    isNewRow={isNewRow}
    onClose={onClose}
    editMode={editMode}
    onEditModeChange={onEditModeChange}
    initialPath={initialPath}
    onPathChange={onPathChange}
    onCopyTestcase={onCopyTestcase}
/>
```

- [ ] **Step 4: Read and update testcase data directly**

Add `onCopyTestcase` to `TestcaseEditDrawerContentProps`:

```typescript
onCopyTestcase?: () => void
```

Destructure it from props, then before `return`, add:

```typescript
const testcaseData = useAtomValue(testcase.selectors.data(testcaseId)) as Record<string, unknown> | null
const dispatch = useSetAtom(testcase.controller(testcaseId))

const editorValue = useMemo(() => {
    if (!testcaseData) return {}
    const values: Record<string, unknown> = {}
    for (const column of columns) {
        values[column.key] = testcaseData[column.key] ?? ""
    }
    return values
}, [testcaseData, columns])

const editorColumns = useMemo<TestcaseDataEditorColumn[]>(
    () =>
        columns.map((column) => ({
            key: column.key,
            name: column.name,
            label: column.label ?? column.name ?? column.key,
            pathMode: "direct",
        })),
    [columns],
)

const handleEditorChange = useCallback(
    (nextValue: Record<string, unknown>) => {
        dispatch({type: "update", changes: nextValue})
    },
    [dispatch],
)
```

If `Column` does not expose `label` or `name`, use:

```typescript
label: String(column.name ?? column.key)
```

- [ ] **Step 5: Render `TestcaseDataEditor`**

Replace the `EntityDualViewEditor` block with:

```tsx
<TestcaseDataEditor
    value={editorValue}
    columns={editorColumns}
    onChange={handleEditorChange}
    mode="edit"
    surface="drawer"
    title="Testcase Data"
    initialPath={initialPath}
    onPathChange={onPathChange}
    onCopy={onCopyTestcase}
    features={{
        typeChips: true,
        rootViewMode: true,
        compactRows: false,
        columnMapping: false,
    }}
    getDefaultValueForType={getDefaultValueForType}
/>
```

Keep the existing new-row green banner above the editor.

- [ ] **Step 6: Remove now-unused variables**

Remove:

```typescript
const entityWithDrillIn = testcase as any
```

Remove unused imports for `Text`, `Typography`, `getViewOptions`, `TypeChip`, and `EntityDualViewEditor` if lint reports them.

- [ ] **Step 7: Verify**

Run:

```bash
cd web && pnpm lint-fix
cd packages/agenta-entity-ui && pnpm types:check
cd ../../ && pnpm --filter @agenta/oss types:check
```

Expected:
- lint passes.
- entity-ui type check passes.
- OSS type check may still fail on existing unrelated errors; no errors should mention `TestcaseEditDrawer/index.tsx`.

- [ ] **Step 8: Commit**

```bash
git add web/packages/agenta-entity-ui/src/testcase/TestcaseDrawer.tsx web/oss/src/components/SharedDrawers/TestcaseDrawer/index.tsx web/oss/src/components/TestcasesTableNew/components/TestcaseEditDrawer/index.tsx
git commit -m "refactor(frontend): use shared testcase data editor in drawer"
```

---

## Task 6: Migrate Playground Testcase Editor to Shared Editor

**Files:**
- Modify: `web/oss/src/components/Playground/Components/PlaygroundTestcaseEditor.tsx`

- [ ] **Step 1: Import shared editor**

Add:

```typescript
import {TestcaseDataEditor, type TestcaseDataEditorColumn} from "@agenta/entity-ui/testcase"
```

Keep `SyncStateTag`, `AddPropertyForm`, and the outer collapsible section only if the playground still needs that shell. The field rows should move to `TestcaseDataEditor`.

- [ ] **Step 2: Build editor columns from existing playground metadata**

After `existingColumns`, add:

```typescript
const editorColumns = useMemo<TestcaseDataEditorColumn[]>(
    () =>
        existingColumns.map((column) => ({
            key: column.key,
            label: column.label ?? column.name ?? column.key,
            name: column.name,
            type: schemaMap[column.key]?.type,
            schema: schemaMap[column.key]?.schema,
            pathMode: "direct",
        })),
    [existingColumns, schemaMap],
)
```

- [ ] **Step 3: Replace custom row rendering with shared editor**

Inside the expanded fields body, replace the `existingColumns.map(...)` branch with:

```tsx
<TestcaseDataEditor
    value={entityData?.data ?? {}}
    columns={editorColumns}
    onChange={(nextValue) => updateTestcase(testcaseId, {data: nextValue})}
    mode="edit"
    surface="playground"
    title="Testcase Data"
    features={{
        typeChips: true,
        rootViewMode: true,
        compactRows: true,
        columnMapping: false,
    }}
/>
```

Keep the suggested-columns section for prompt-referenced variables that are not yet present. That section is playground-specific and should remain in the playground wrapper.

The compact editor must preserve schema-aware editing:

- `type: "number" | "integer"` renders `InputNumber`.
- `type: "boolean"` renders `Switch`.
- `type: "object" | "array"` renders JSON editor.
- unknown `null` values render as read-only until a column type exists.
- dotted prompt variable names are direct keys by default via `pathMode: "direct"`.

- [ ] **Step 4: Remove obsolete local components and imports**

Remove if unused after the replacement:

```typescript
VariableControlAdapter
NestedFieldEditor
getPortSubPaths
fieldView
hasNestedColumns
ListBullets
TreeStructure
```

Keep JSON mode if the playground shell still needs a full JSON editor. If JSON mode stays, it should remain wrapper-specific and use the same `entityData?.data` object.

- [ ] **Step 5: Verify**

Run:

```bash
cd web && pnpm lint-fix
cd packages/agenta-entity-ui && pnpm types:check
cd ../../ && pnpm --filter @agenta/oss types:check
```

Expected:
- lint passes.
- entity-ui type check passes.
- no OSS type errors mention `PlaygroundTestcaseEditor.tsx`.

- [ ] **Step 6: Commit**

```bash
git add web/oss/src/components/Playground/Components/PlaygroundTestcaseEditor.tsx
git commit -m "refactor(frontend): use shared testcase data editor in playground"
```

---

## Task 7: Read-Only Mode Pass

**Files:**
- Modify: `web/packages/agenta-entity-ui/src/testcase/TestcaseDataEditor.tsx`
- Modify: any call site that needs read-only display, starting with playground/testset preview if applicable

- [ ] **Step 1: Enforce read-only behavior in the shared editor**

In `TestcaseDataEditor.tsx`, verify these props derive from `editable`:

```tsx
editable={editable}
showAddControls={editable}
showDeleteControls={editable && !columns?.length}
columnOptions={resolvedFeatures.columnMapping && editable ? columnOptions : undefined}
mappedPaths={resolvedFeatures.columnMapping && editable ? mappedPaths : undefined}
onMapToColumn={resolvedFeatures.columnMapping && editable ? onMapToColumn : undefined}
onUnmap={resolvedFeatures.columnMapping && editable ? onUnmap : undefined}
```

If any edit-only control is still visible in `mode="view"`, gate it with `editable`.

- [ ] **Step 2: Add one read-only usage**

For a read-only testcase preview surface, use:

```tsx
<TestcaseDataEditor
    value={previewData}
    columns={previewColumns}
    mode="view"
    surface="inline"
    title="Testcase Data"
    features={{
        typeChips: true,
        rootViewMode: true,
    }}
/>
```

If there is no immediate read-only call site in this branch, add a small Storybook/design-mockup usage only if the repository already has a nearby pattern for it. Otherwise verify by temporarily switching one local call site during manual QA and revert that temporary switch before commit.

- [ ] **Step 3: Verify**

Run:

```bash
cd web && pnpm lint-fix
cd packages/agenta-entity-ui && pnpm types:check
```

Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add web/packages/agenta-entity-ui/src/testcase/TestcaseDataEditor.tsx
git commit -m "feat(entity-ui): support read-only testcase data editor mode"
```

---

## Task 8: Cleanup Old Duplication

**Files:**
- Modify: `web/oss/src/components/DrillInView/EntityDualViewEditor.tsx`
- Modify: `web/oss/src/components/TestcasesTableNew/components/TestcaseEditDrawer/index.tsx`
- Modify: `web/oss/src/components/Playground/Components/PlaygroundTestcaseEditor.tsx`

- [ ] **Step 1: Keep `EntityDualViewEditor` generic**

Do not delete `EntityDualViewEditor`. Other surfaces may still use it. Remove only testcase-specific imports or props if they became unused because testcase drawer/playground no longer imports it.

- [ ] **Step 2: Remove dead testcase drawer wiring**

Search:

```bash
rg "rootViewMode|collapseSignal|getFieldTypeChip|enableFieldViewModes" web/oss/src/components/TestcasesTableNew web/oss/src/components/SharedDrawers/TestcaseDrawer web/packages/agenta-entity-ui/src/testcase
```

Expected after cleanup:
- `rootViewMode` and `collapseSignal` are internal to `TestcaseDataEditor` unless the drawer shell still needs to control them.
- `getFieldTypeChip` is not manually wired from the testcase drawer content.
- `enableFieldViewModes` is not manually configured at testcase drawer call sites.

- [ ] **Step 3: Verify final state**

Run:

```bash
cd web && pnpm lint-fix
cd packages/agenta-entity-ui && pnpm types:check
cd ../../ && pnpm --filter @agenta/ui types:check
cd ../../ && pnpm --filter @agenta/oss types:check
```

Expected:
- lint passes.
- `@agenta/entity-ui` type check passes.
- `@agenta/ui` type check passes.
- OSS type check may fail on existing unrelated errors; no errors should mention files changed in this plan.

- [ ] **Step 4: Commit**

```bash
git add web/packages/agenta-entity-ui/src/testcase web/oss/src/components/TestcasesTableNew/components/TestcaseEditDrawer/index.tsx web/oss/src/components/Playground/Components/PlaygroundTestcaseEditor.tsx web/oss/src/components/SharedDrawers/TestcaseDrawer/index.tsx web/oss/src/components/DrillInView/EntityDualViewEditor.tsx
git commit -m "chore(frontend): clean up testcase editor duplication"
```

---

## Manual QA Checklist

- [ ] Open a testset table row drawer.
- [ ] Confirm field name appears before `TypeChip`.
- [ ] Confirm the root view mode dropdown changes field rendering without collapsing the editor.
- [ ] Confirm collapse-all can be followed by manually expanding a field.
- [ ] Confirm edit mode can add/delete fields where allowed.
- [ ] Confirm read-only mode hides add/delete/map/edit controls.
- [ ] Open playground testcase editor.
- [ ] Confirm it uses the same type chips and view mode vocabulary.
- [ ] Confirm compact rows render without overflowing the playground panel.
- [ ] Confirm editing a primitive playground variable updates testcase data.
- [ ] Confirm suggested prompt variables still appear and can still be promoted.
- [ ] Open the playground testset preview create-mode drawer.
- [ ] Confirm it uses the same shared editor behavior as the testset table drawer.

---

## Risks and Guardrails

- **State adapters differ.** Testset table drawer edits flattened testcase rows; playground edits `testcase.data`. Keep `TestcaseDataEditor` on `value/onChange` only so it does not import either state system.
- **Compact rows are playground-specific.** Keep the compact row layout inside `@agenta/entity-ui`, but keep prompt suggestion logic in playground because it depends on prompt variables.
- **Do not enable broad feature flags.** Prefer `mode` and `surface` defaults. Use `features` only for true optional behavior.
- **Do not remove `EntityDualViewEditor`.** It remains useful for non-testcase entity drill-in surfaces.
- **OSS type check has existing unrelated failures.** Treat changed-file errors as blockers; document unrelated failures separately.
