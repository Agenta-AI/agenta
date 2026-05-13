# Type Chip — Phase 3: Testcase Drawer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the ProposalV2 drill-in direction on the testcase drawer: remove the Fields/JSON toggle from the main chrome header, add `DrillInRootToolbar` as a sub-header (label + filter + collapse-all + view-mode select + copy), add a `typeChip` slot to `DrillInFieldHeader`, and wire per-field "View as ▾" dropdowns driven by `getViewOptions`.

**Architecture:** `DrillInRootToolbar` is a new reusable component in `@agenta/ui/drill-in`. `DrillInUIContext` gains a `featureFlags.enableFormView` field so `JsonObjectField` can opt into the rail-style form view without prop drilling. The drawer shell (`TestcaseDrawer.tsx` in `@agenta/entity-ui`) owns the chrome changes: removing the Fields/JSON toggle, mounting `DrillInRootToolbar`, and adding `rootViewMode` to `TestcaseDrawerContentRenderProps`. The OSS content renderer (`TestcaseEditDrawer/index.tsx`) receives `rootViewMode` via render props and wires `typeChip` + per-field "View as" into `DrillInFieldHeader`.

**Tech Stack:** React, TypeScript, `@agenta/ui/drill-in`, `@agenta/ui/type-chip`, Ant Design (Select for view-mode dropdown)

**Spec:** `docs/superpowers/specs/2026-05-12-type-chip-system-design.md` — Phase 3 section

**Mockup sources:**
- `web/apps/design-mockups/src/components/proposed/ProposalV2DrillIn.tsx` — per-field section structure
- `web/apps/design-mockups/src/components/proposed/ProposalV2ViewTypeSelect.tsx` — view type select
- `web/apps/design-mockups/src/components/proposed/ProposedDrillIn.tsx` — root toolbar chrome (filter, collapse-all, view-mode, copy icons)
- `web/apps/design-mockups/src/pages/solutions-drill-in.tsx` — Row 2 (ProposalV2 paired with status quo)

**Prerequisite:** Phase 1+2 plan must be merged. `@agenta/ui/type-chip` and `getViewOptions` must be available.

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Modify | `web/packages/agenta-ui/src/drill-in/context/DrillInUIContext.tsx` | Add `featureFlags?: { enableFormView?: boolean }` to `DrillInUIComponents` |
| Create | `web/packages/agenta-ui/src/drill-in/core/DrillInRootToolbar.tsx` | Sub-header: label + filter + collapse-all + view-mode select + copy |
| Modify | `web/packages/agenta-ui/src/drill-in/index.ts` | Export `DrillInRootToolbar` |
| Modify | `web/packages/agenta-ui/src/drill-in/core/DrillInFieldHeader.tsx` | Add `typeChip?: ReactNode` slot |
| Modify | `web/packages/agenta-ui/src/drill-in/FieldRenderers/JsonObjectField.tsx` | Rail-style form view, gated behind `featureFlags.enableFormView` |
| Modify | `web/packages/agenta-entity-ui/src/testcase/TestcaseDrawer.tsx` | Remove Fields/JSON toggle from chrome, add `rootViewMode` state, mount `DrillInRootToolbar`, extend `TestcaseDrawerContentRenderProps` |
| Modify | `web/oss/src/components/TestcasesTableNew/components/TestcaseEditDrawer/index.tsx` | Consume `rootViewMode` from render props, pass `typeChip` + per-field view options to `DrillInFieldHeader` |

---

## Task 1: Add `featureFlags` to `DrillInUIContext`

**Files:**
- Modify: `web/packages/agenta-ui/src/drill-in/context/DrillInUIContext.tsx`

- [ ] **Add `featureFlags` to the `DrillInUIComponents` interface** — insert after the existing `tryParsePartialJson` field:

```typescript
/**
 * Feature flags for opt-in drill-in behaviours.
 * Injected via DrillInUIProvider so any component in the tree
 * can read them via useDrillInUI() without prop drilling.
 */
featureFlags?: {
    /** When true, Form is available as a view-mode option for object fields.
     *  Default false — ships hidden until the rail renderer is validated. */
    enableFormView?: boolean
}
```

- [ ] **Verify TypeScript compiles**

```bash
cd web && pnpm --filter @agenta/ui types:check
```

Expected: no errors

- [ ] **Commit**

```bash
git add web/packages/agenta-ui/src/drill-in/context/DrillInUIContext.tsx
git commit -m "feat(@agenta/ui): add featureFlags.enableFormView to DrillInUIContext"
```

---

## Task 2: `DrillInRootToolbar` component

**Files:**
- Create: `web/packages/agenta-ui/src/drill-in/core/DrillInRootToolbar.tsx`
- Modify: `web/packages/agenta-ui/src/drill-in/index.ts`

- [ ] **Create the component** — root toolbar that lives below the main chrome header in the testcase drawer and above the embedded drill-in body in the playground. Reference the root header section of `web/apps/design-mockups/src/components/proposed/ProposedDrillIn.tsx` for the icon set.

```typescript
// web/packages/agenta-ui/src/drill-in/core/DrillInRootToolbar.tsx

import {memo} from "react"
import {Copy, ArrowsInLineVertical, Funnel} from "@phosphor-icons/react"

export type RootViewMode = "text" | "markdown" | "json" | "yaml" | "form"

export interface DrillInRootToolbarProps {
    /** Testcase or variable-set label shown on the left */
    label: string
    /** Currently selected view mode */
    viewMode: RootViewMode
    /** Called when the user picks a new mode from the dropdown */
    onViewModeChange: (mode: RootViewMode) => void
    /** Called when the collapse-all button is clicked */
    onCollapseAll?: () => void
    /** Called when the filter button is clicked */
    onFilter?: () => void
    /** Called when the copy button is clicked */
    onCopy?: () => void
    /**
     * When false (default), "Form" is absent from the view-mode dropdown.
     * Flip to true in the DrillInUIProvider once the form renderer is stable.
     */
    enableFormView?: boolean

    // Slot components — allows OSS to inject Ant Design components without
    // making this package depend on antd directly.
    /** Select component for the view-mode dropdown. Falls back to native <select>. */
    Select?: React.ComponentType<{
        size?: "small"
        value: string
        options: {value: string; label: string}[]
        onChange: (v: string) => void
        style?: React.CSSProperties
        popupMatchSelectWidth?: boolean
    }>
    /** Tooltip component. Falls back to no-op. */
    Tooltip?: React.ComponentType<{title?: string; children: React.ReactNode}>
    /** Button component. Falls back to native <button>. */
    Button?: React.ComponentType<{
        type?: "text"
        size?: "small"
        icon?: React.ReactNode
        onClick?: () => void
        "aria-label"?: string
    }>
}

const BASE_OPTIONS: {value: RootViewMode; label: string}[] = [
    {value: "text", label: "Text"},
    {value: "markdown", label: "Markdown"},
    {value: "json", label: "JSON"},
    {value: "yaml", label: "YAML"},
]

const FORM_OPTION: {value: RootViewMode; label: string} = {value: "form", label: "Form"}

// Fallback implementations for when OSS doesn't inject Ant Design components
const NativeSelect = ({value, options, onChange, style}: DrillInRootToolbarProps["Select"] extends undefined ? never : React.ComponentProps<NonNullable<DrillInRootToolbarProps["Select"]>>) => (
    <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{fontSize: 12, borderRadius: 4, border: "1px solid rgba(5,23,41,0.15)", ...style}}
    >
        {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
        ))}
    </select>
)

const NoTooltip = ({children}: {title?: string; children: React.ReactNode}) => <>{children}</>

const NativeButton = ({icon, onClick, "aria-label": ariaLabel}: {
    type?: string
    size?: string
    icon?: React.ReactNode
    onClick?: () => void
    "aria-label"?: string
}) => (
    <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 24,
            height: 24,
            padding: 0,
            background: "transparent",
            border: "none",
            cursor: "pointer",
            borderRadius: 4,
            color: "rgba(5,23,41,0.45)",
        }}
    >
        {icon}
    </button>
)

export const DrillInRootToolbar = memo(function DrillInRootToolbar({
    label,
    viewMode,
    onViewModeChange,
    onCollapseAll,
    onFilter,
    onCopy,
    enableFormView = false,
    Select: SelectComp = NativeSelect as any,
    Tooltip: TooltipComp = NoTooltip,
    Button: ButtonComp = NativeButton as any,
}: DrillInRootToolbarProps) {
    const options = enableFormView ? [FORM_OPTION, ...BASE_OPTIONS] : BASE_OPTIONS

    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "6px 16px",
                borderBottom: "1px solid rgba(5,23,41,0.06)",
                background: "#fafafa",
                gap: 8,
                minHeight: 36,
            }}
        >
            <span
                style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#051729",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flex: 1,
                    minWidth: 0,
                }}
            >
                {label}
            </span>

            <div style={{display: "flex", alignItems: "center", gap: 4, flexShrink: 0}}>
                {onFilter && (
                    <TooltipComp title="Filter fields">
                        <ButtonComp
                            type="text"
                            size="small"
                            icon={<Funnel size={12} />}
                            onClick={onFilter}
                            aria-label="Filter fields"
                        />
                    </TooltipComp>
                )}
                {onCollapseAll && (
                    <TooltipComp title="Collapse all">
                        <ButtonComp
                            type="text"
                            size="small"
                            icon={<ArrowsInLineVertical size={12} />}
                            onClick={onCollapseAll}
                            aria-label="Collapse all fields"
                        />
                    </TooltipComp>
                )}
                <SelectComp
                    size="small"
                    value={viewMode}
                    options={options}
                    onChange={(v) => onViewModeChange(v as RootViewMode)}
                    style={{minWidth: 96}}
                    popupMatchSelectWidth={false}
                />
                {onCopy && (
                    <TooltipComp title="Copy testcase">
                        <ButtonComp
                            type="text"
                            size="small"
                            icon={<Copy size={12} />}
                            onClick={onCopy}
                            aria-label="Copy testcase"
                        />
                    </TooltipComp>
                )}
            </div>
        </div>
    )
})
```

- [ ] **Export from drill-in index** — add to the "CORE COMPONENTS" section in `web/packages/agenta-ui/src/drill-in/index.ts`:

```typescript
export {DrillInRootToolbar} from "./core/DrillInRootToolbar"
export type {DrillInRootToolbarProps, RootViewMode} from "./core/DrillInRootToolbar"
```

- [ ] **Verify TypeScript compiles**

```bash
cd web && pnpm --filter @agenta/ui types:check
```

Expected: no errors

- [ ] **Commit**

```bash
git add web/packages/agenta-ui/src/drill-in/core/DrillInRootToolbar.tsx \
        web/packages/agenta-ui/src/drill-in/index.ts
git commit -m "feat(@agenta/ui): add DrillInRootToolbar component"
```

---

## Task 3: `typeChip` slot on `DrillInFieldHeader`

**Files:**
- Modify: `web/packages/agenta-ui/src/drill-in/core/DrillInFieldHeader.tsx`

- [ ] **Add `typeChip` to `DrillInFieldHeaderProps`** — insert after the existing `showCollapseToggle` prop:

```typescript
/**
 * Optional chip rendered between the collapse toggle and the field name.
 * Pass <TypeChip value={fieldValue} /> for Axis 1 (always on).
 * When ChipConversionPopover is added later, wrap TypeChip in the popover
 * and pass the result here — no changes to DrillInFieldHeader required.
 */
typeChip?: React.ReactNode
```

- [ ] **Render `typeChip` in the JSX** — find the left side of the header (the `<div className="flex items-center gap-2">` block around line 449) and insert `typeChip` between the collapse toggle button and the field name span:

```tsx
// Existing structure (simplified):
<div className="flex items-center gap-2">
    {shouldShowCollapse ? (
        <button ...>{caretIcon} <span>{name}</span></button>
    ) : (
        <span>{name}</span>
    )}
    {/* item count / mapped column indicators */}
</div>

// Updated: typeChip goes between the caret and the name.
// Change the button's content for the collapse case:
<button ...>
    {isCollapsed ? caretRightIcon : caretDownIcon}
</button>
{props.typeChip}   {/* ← insert here */}
<span ...>{name}</span>
```

The exact edit: in the `shouldShowCollapse` branch, the `<button>` currently contains both the caret AND `<span className="text-gray-700 font-medium">{name}</span>`. Split them: the button contains only the caret, and the name + typeChip live outside the button. This makes the chip not accidentally trigger the collapse toggle.

```tsx
{shouldShowCollapse ? (
    <>
        <button
            type="button"
            onClick={onToggleCollapse}
            className="flex items-center hover:text-gray-700 transition-colors bg-transparent border-none p-0 cursor-pointer"
        >
            {isCollapsed ? caretRightIcon : caretDownIcon}
        </button>
        {typeChip}
        <span className="text-gray-700 font-medium">{name}</span>
    </>
) : (
    <>
        {typeChip}
        <span className="text-gray-700 font-medium">{name}</span>
    </>
)}
```

- [ ] **Verify TypeScript compiles**

```bash
cd web && pnpm --filter @agenta/ui types:check
```

- [ ] **Commit**

```bash
git add web/packages/agenta-ui/src/drill-in/core/DrillInFieldHeader.tsx
git commit -m "feat(@agenta/ui): add typeChip slot to DrillInFieldHeader"
```

---

## Task 4: Form view rail style in `JsonObjectField` (flag-gated)

**Files:**
- Modify: `web/packages/agenta-ui/src/drill-in/FieldRenderers/JsonObjectField.tsx`

- [ ] **Read `featureFlags` from context** — add to the top of the component function body:

```typescript
import {useDrillInUI} from "../context/DrillInUIContext"

// Inside the component:
const {featureFlags} = useDrillInUI()
const enableFormView = featureFlags?.enableFormView ?? false
```

- [ ] **Apply rail style when form view is enabled** — find where the nested object children are wrapped in a card/container (look for the outer wrapper div). Add a conditional style:

```tsx
<div
    style={
        enableFormView
            ? {
                  paddingLeft: 16,
                  borderLeft: "2px solid rgba(5,23,41,0.10)",
                  marginLeft: 4,
              }
            : undefined
    }
>
    {/* existing children */}
</div>
```

- [ ] **Verify TypeScript compiles**

```bash
cd web && pnpm --filter @agenta/ui types:check
```

- [ ] **Commit**

```bash
git add web/packages/agenta-ui/src/drill-in/FieldRenderers/JsonObjectField.tsx
git commit -m "feat(@agenta/ui): add flag-gated rail-style form view to JsonObjectField"
```

---

## Task 5: Wire everything — shell + content

The drawer is now split across two layers:
- **Shell** (`@agenta/entity-ui` — `TestcaseDrawer.tsx`): chrome, nav, session state, view mode
- **Content** (OSS — `TestcaseEditDrawer/index.tsx`): field rendering, `DrillInFieldHeader`, TypeChip

The chrome changes (remove old toggle, add sub-header toolbar) go in the package shell. The TypeChip + per-field view mode wiring goes in the OSS content renderer, which receives state via `TestcaseDrawerContentRenderProps`.

---

### Task 5a: Update `TestcaseDrawer.tsx` (shell chrome)

**Files:**
- Modify: `web/packages/agenta-entity-ui/src/testcase/TestcaseDrawer.tsx`

- [ ] **Add imports**

```typescript
import {useState, useCallback} from "react"
import {Button, Select, Tooltip} from "antd"
import {DrillInRootToolbar, type RootViewMode} from "@agenta/ui/drill-in"
```

- [ ] **Extend `TestcaseDrawerContentRenderProps`** — add `rootViewMode` and the two state-management callbacks so the content renderer can read and override the mode:

```typescript
export interface TestcaseDrawerContentRenderProps {
    editMode: EditMode
    onEditModeChange: (mode: EditMode) => void
    initialPath: string[]
    onPathChange: (path: string[]) => void
    // Added for Phase 3:
    rootViewMode: RootViewMode
    fieldViewModes: Record<string, RootViewMode>
    onFieldViewModeChange: (fieldKey: string, mode: RootViewMode) => void
}
```

- [ ] **Add view-mode state** in the component function body:

```typescript
const [rootViewMode, setRootViewMode] = useState<RootViewMode>("text")
const [fieldViewModes, setFieldViewModes] = useState<Record<string, RootViewMode>>({})

const handleRootViewModeChange = useCallback((mode: RootViewMode) => {
    setRootViewMode(mode)
    setFieldViewModes({})
}, [])

const handleCollapseAll = useCallback(() => {
    setCollapseSignal((s) => s + 1)
}, [])
```

If `collapseSignal` state doesn't already exist, add it:

```typescript
const [collapseSignal, setCollapseSignal] = useState(0)
```

- [ ] **Remove the Fields/JSON `Segmented` toggle** from the chrome header — search for the `Segmented` or similar toggle in the header JSX and delete it. View mode is now controlled by `DrillInRootToolbar`.

- [ ] **Mount `DrillInRootToolbar` below the chrome header** — insert it just above the scrollable body:

```tsx
<DrillInRootToolbar
    label={testcaseLabel}
    viewMode={rootViewMode}
    onViewModeChange={handleRootViewModeChange}
    onCollapseAll={handleCollapseAll}
    onCopy={handleCopy}
    enableFormView={false}
    Select={Select}
    Tooltip={Tooltip}
    Button={Button}
/>
```

- [ ] **Pass new render props to `renderContent`** — in the `renderContent(...)` call site, add the new fields:

```typescript
renderContent({
    editMode,
    onEditModeChange: setEditMode,
    initialPath,
    onPathChange: setInitialPath,
    rootViewMode,
    fieldViewModes,
    onFieldViewModeChange: (key, mode) =>
        setFieldViewModes((prev) => ({...prev, [key]: mode})),
})
```

- [ ] **Verify TypeScript compiles**

```bash
cd web && pnpm --filter @agenta/entity-ui types:check 2>/dev/null || cd web && pnpm lint-fix
```

- [ ] **Commit**

```bash
git add web/packages/agenta-entity-ui/src/testcase/TestcaseDrawer.tsx
git commit -m "feat(@agenta/entity-ui): add DrillInRootToolbar sub-header and rootViewMode to TestcaseDrawer"
```

---

### Task 5b: Wire TypeChip + view mode in `TestcaseEditDrawer/index.tsx` (OSS content)

**Files:**
- Modify: `web/oss/src/components/TestcasesTableNew/components/TestcaseEditDrawer/index.tsx`

This is `TestcaseEditDrawerContent` — the content injected via `renderContent`. It now receives `rootViewMode`, `fieldViewModes`, `onFieldViewModeChange` from `TestcaseDrawerContentRenderProps`.

- [ ] **Add imports**

```typescript
import {getViewOptions, type RootViewMode} from "@agenta/ui/drill-in"
import {TypeChip} from "@agenta/ui/type-chip"
```

- [ ] **Destructure new render props** — update the component signature to receive the new fields:

```typescript
const TestcaseEditDrawerContent = forwardRef<
    TestcaseEditDrawerContentRef,
    TestcaseEditDrawerContentProps
>(({
    testcaseId,
    columns,
    isNewRow,
    onClose,
    editMode,
    onEditModeChange,
    initialPath,
    onPathChange,
    rootViewMode,          // ← new
    fieldViewModes,        // ← new
    onFieldViewModeChange, // ← new
}, ref) => {
```

- [ ] **Pass `typeChip` to each `DrillInFieldHeader`** — in the field renderer loop, add:

```tsx
<DrillInFieldHeader
    {/* ...existing props... */}
    typeChip={<TypeChip value={fieldValue} />}
/>
```

- [ ] **Wire per-field "View as ▾"** — add view mode props to each `DrillInFieldHeader`:

```tsx
<DrillInFieldHeader
    {/* ...existing props... */}
    typeChip={<TypeChip value={fieldValue} />}
    viewModeOptions={getViewOptions(fieldValue).map((o) => ({value: o.value, label: o.label}))}
    viewMode={fieldViewModes[fieldKey] ?? rootViewMode}
    onViewModeChange={(mode) => onFieldViewModeChange(fieldKey, mode as RootViewMode)}
/>
```

- [ ] **Verify TypeScript compiles + lint**

```bash
cd web && pnpm lint-fix
```

- [ ] **Visual verification** — open the testcase drawer in the browser:

Expected:
- Main chrome: navigation arrows, testcase title, Add to queue — no Fields/JSON toggle
- Sub-header: testcase label on left, filter + collapse + `[ Text ▾ ]` + copy on right
- Each field header: TypeChip between the caret and field name
- Changing root view mode resets all per-field overrides
- Per-field "View as ▾" shows options from `getViewOptions` for that value type

- [ ] **Commit**

```bash
git add web/oss/src/components/TestcasesTableNew/components/TestcaseEditDrawer/index.tsx
git commit -m "feat(testcase-drawer): wire TypeChip and per-field view mode in TestcaseEditDrawerContent"
```

---

## Task 6: Final lint + PR prep

- [ ] **Full lint-fix**

```bash
cd web && pnpm lint-fix
```

- [ ] **TypeScript check**

```bash
cd web && pnpm --filter @agenta/ui types:check
```

- [ ] **End-to-end visual check in the browser:**
  1. Open a testset → click a testcase row → drawer opens
  2. Sub-header shows testcase label + view mode dropdown
  3. Each field has `[string]` / `[object]` / `[null]` chip
  4. Switching root view mode to JSON renders the whole testcase as JSON
  5. Per-field "View as ▾" overrides only that field
  6. Collapse-all button collapses all expanded fields
  7. No regressions in the table (Phase 1+2 chips still visible on column headers)
