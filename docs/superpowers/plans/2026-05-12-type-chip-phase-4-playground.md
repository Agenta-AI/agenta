# Type Chip — Phase 4: Playground Compact Variable List

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the playground's per-variable textarea with a compact row list (~26px per row): field name + `TypeChip` + truncated value preview + expand chevron. Primitive rows morph to an inline editor on click. Structured rows expand to a JSON preview inline (or a full drill-in body when `enableNestedVariableRendering` is true).

**Architecture:** All changes are in `PlaygroundTestcaseEditor.tsx`. `TypeChip` and `DrillInRootToolbar` are imported from the packages built in Phases 1–3. A new `CompactVariableRow` sub-component handles the row layout. The `enableNestedVariableRendering` flag is a prop (default false) that controls whether structured rows expand into the full drill-in or a plain JSON preview.

**Tech Stack:** React, TypeScript, `@agenta/ui/type-chip`, `@agenta/ui/drill-in`, Jotai (for testcase molecule reads)

**Spec:** `docs/superpowers/specs/2026-05-12-type-chip-system-design.md` — Phase 4 section

**Mockup source:** `web/apps/design-mockups/src/components/proposed/PlaygroundExecutionItemCompact.tsx`

**Prerequisite:** Phases 1–3 must be merged. `TypeChip`, `DrillInRootToolbar`, and `getViewOptions` must be available.

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Modify | `web/oss/src/components/Playground/Components/PlaygroundTestcaseEditor.tsx` | Replace textarea inputs with compact rows + TypeChip; add `enableNestedVariableRendering` prop |

---

## Task 1: Add `enableNestedVariableRendering` prop + `CompactVariableRow`

**Files:**
- Modify: `web/oss/src/components/Playground/Components/PlaygroundTestcaseEditor.tsx`

- [ ] **Add imports** at the top of the file (after existing imports):

```typescript
import {useState, useCallback} from "react"
import {CaretDown, CaretRight} from "@phosphor-icons/react"
import {TypeChip} from "@agenta/ui/type-chip"
import {DrillInRootToolbar, getViewOptions, type RootViewMode} from "@agenta/ui/drill-in"
import {JsonEditorWithLocalState} from "@agenta/ui/drill-in"
```

- [ ] **Add `enableNestedVariableRendering` and `enableRenderHints` and `enableStateChips` to the component's props type** — find the existing props interface for `PlaygroundTestcaseEditor` and add:

```typescript
/** Compact row list with TypeChip. Default: false (shows existing textarea UX). */
enableCompactVariableList?: boolean
/** When true, structured rows expand to full DrillInRootToolbar + drill-in body. Default: false. */
enableNestedVariableRendering?: boolean
/** Show Axis 2 render-hint chips alongside the type chip. Default: false. */
enableRenderHints?: boolean
/** Show Axis 3 state/correctness chips. Default: false. */
enableStateChips?: boolean
```

- [ ] **Add `CompactVariableRow` component** — add this as a module-level component in the same file, above the main `PlaygroundTestcaseEditor` export:

```typescript
interface CompactVariableRowProps {
    name: string
    value: unknown
    editable?: boolean
    enableNestedVariableRendering?: boolean
    onChange?: (value: unknown) => void
}

function CompactVariableRow({
    name,
    value,
    editable,
    enableNestedVariableRendering,
    onChange,
}: CompactVariableRowProps) {
    const [expanded, setExpanded] = useState(false)
    const [viewMode, setViewMode] = useState<RootViewMode>("text")

    const isPrimitive =
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"

    const isStructured = !isPrimitive

    // Truncated preview — max 60 chars of JSON or string value
    const preview = (() => {
        if (value === null) return "null"
        if (typeof value === "string") return value.length > 60 ? value.slice(0, 60) + "…" : value
        if (typeof value === "number" || typeof value === "boolean") return String(value)
        const json = JSON.stringify(value)
        return json.length > 60 ? json.slice(0, 60) + "…" : json
    })()

    return (
        <div
            style={{
                borderBottom: "1px solid rgba(5,23,41,0.06)",
            }}
        >
            {/* Row header — always visible */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 12px",
                    minHeight: 32,
                    cursor: "pointer",
                    background: expanded ? "rgba(5,23,41,0.02)" : "transparent",
                }}
                onClick={() => setExpanded((e) => !e)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        setExpanded((prev) => !prev)
                    }
                }}
            >
                <span style={{color: "rgba(5,23,41,0.35)", flexShrink: 0, display: "flex"}}>
                    {expanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
                </span>
                <span
                    style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: "#051729",
                        flexShrink: 0,
                    }}
                >
                    {name}
                </span>
                <TypeChip value={value} />
                {!expanded && (
                    <span
                        style={{
                            fontSize: 12,
                            color: "rgba(5,23,41,0.45)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            flex: 1,
                            minWidth: 0,
                            fontFamily: isPrimitive
                                ? "inherit"
                                : "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                        }}
                    >
                        {preview}
                    </span>
                )}
            </div>

            {/* Expanded body */}
            {expanded && (
                <div style={{padding: "0 12px 8px"}}>
                    {isPrimitive && editable ? (
                        // Primitive: inline editor
                        <input
                            type="text"
                            value={String(value ?? "")}
                            onChange={(e) => onChange?.(e.target.value)}
                            autoFocus
                            style={{
                                width: "100%",
                                fontSize: 12,
                                padding: "4px 8px",
                                border: "1px solid rgba(5,23,41,0.18)",
                                borderRadius: 4,
                                outline: "none",
                                fontFamily: "inherit",
                            }}
                        />
                    ) : isStructured && enableNestedVariableRendering ? (
                        // Structured + flag on: full drill-in body with toolbar
                        <>
                            <DrillInRootToolbar
                                label={name}
                                viewMode={viewMode}
                                onViewModeChange={setViewMode}
                                enableFormView={false}
                            />
                            {/* Render JSON editor for now — full drill-in mounting
                                deferred until the drill-in adapter is wired */}
                            <pre
                                style={{
                                    fontSize: 11,
                                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                                    color: "#051729",
                                    background: "rgba(5,23,41,0.02)",
                                    borderRadius: 4,
                                    padding: 8,
                                    margin: 0,
                                    overflowX: "auto",
                                    whiteSpace: "pre-wrap",
                                    wordBreak: "break-all",
                                }}
                            >
                                {JSON.stringify(value, null, 2)}
                            </pre>
                        </>
                    ) : (
                        // Structured + flag off (default): plain JSON preview
                        <pre
                            style={{
                                fontSize: 11,
                                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                                color: "#051729",
                                background: "rgba(5,23,41,0.02)",
                                borderRadius: 4,
                                padding: 8,
                                margin: 0,
                                overflowX: "auto",
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-all",
                            }}
                        >
                            {JSON.stringify(value, null, 2)}
                        </pre>
                    )}
                </div>
            )}
        </div>
    )
}
```

- [ ] **Verify TypeScript compiles + lint**

```bash
cd web && pnpm lint-fix
```

Expected: no errors

- [ ] **Commit**

```bash
git add web/oss/src/components/Playground/Components/PlaygroundTestcaseEditor.tsx
git commit -m "feat(playground): add CompactVariableRow with TypeChip to PlaygroundTestcaseEditor"
```

---

## Task 2: Wire `CompactVariableRow` into the variable list render path

**Files:**
- Modify: `web/oss/src/components/Playground/Components/PlaygroundTestcaseEditor.tsx`

- [ ] **Find the section that renders variable rows** — search for the `schemaKeys.map(...)` or similar loop in `PlaygroundTestcaseEditor` that renders each input variable. It currently renders an antd `Input` or textarea per variable.

- [ ] **Replace the variable render with `CompactVariableRow` when `enableCompactVariableList` is true** — wrap the existing render in a conditional:

```tsx
{enableCompactVariableList ? (
    <div
        style={{
            border: "1px solid rgba(5,23,41,0.08)",
            borderRadius: 6,
            overflow: "hidden",
        }}
    >
        {schemaKeys.map((key) => {
            const cellValue = /* existing logic to get cell value for this key */
            return (
                <CompactVariableRow
                    key={key}
                    name={key}
                    value={cellValue}
                    editable={/* existing editable check */}
                    enableNestedVariableRendering={enableNestedVariableRendering}
                    onChange={(next) => {
                        /* existing setCellValue logic */
                        setCellValue({testcaseId, key, value: next})
                    }}
                />
            )
        })}
    </div>
) : (
    /* existing variable list JSX — unchanged */
    {schemaKeys.map((key) => (
        /* existing render */
    ))}
)}
```

The existing `setCellValue` dispatch and `testcaseCellValue` selector remain unchanged — only the presentation layer changes.

- [ ] **Verify TypeScript compiles + lint**

```bash
cd web && pnpm lint-fix
```

- [ ] **Visual verification** — open the playground in the browser with `enableCompactVariableList` temporarily hardcoded to `true` in the component (revert after verifying):

Expected:
- Each input variable shows as a compact row (~32px)
- Row: caret chevron + field name + TypeChip + truncated value preview
- Click a primitive row → caret flips, inline text input appears below
- Click a structured row (object/array) → caret flips, JSON preview appears below
- Changing a primitive value in the inline editor calls `setCellValue`
- No regressions when `enableCompactVariableList` is false (existing UX unchanged)

- [ ] **Revert the hardcoded `true`** after visual verification:

```typescript
// Change back to:
enableCompactVariableList={enableCompactVariableList ?? false}
```

- [ ] **Commit**

```bash
git add web/oss/src/components/Playground/Components/PlaygroundTestcaseEditor.tsx
git commit -m "feat(playground): wire CompactVariableRow into variable list, flag-gated"
```

---

## Task 3: Final lint + PR prep

- [ ] **Full lint-fix**

```bash
cd web && pnpm lint-fix
```

- [ ] **TypeScript check**

```bash
cd web && pnpm --filter @agenta/ui types:check
```

- [ ] **End-to-end visual check with flag enabled** — temporarily set `enableCompactVariableList={true}` in the parent that mounts `PlaygroundTestcaseEditor` and verify in the browser:
  1. Compact rows visible for all input variables
  2. TypeChip correct per variable type (`[string]` for country, `[object]` for geo, etc.)
  3. Primitive variable click → inline editor appears, value saves correctly
  4. Object/array variable click → JSON preview renders
  5. When `enableNestedVariableRendering={true}`, structured rows show `DrillInRootToolbar` above the JSON preview
  6. Resetting flag to false restores the original textarea UX

- [ ] **Revert flag to false** in the parent after verification

- [ ] **Final commit**

```bash
git add web/oss/src/components/Playground/Components/PlaygroundTestcaseEditor.tsx
git commit -m "chore(playground): ensure enableCompactVariableList defaults to false for prod"
```
