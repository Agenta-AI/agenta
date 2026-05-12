# TestcaseDrawer → @agenta/entity-ui Package Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `TestcaseEditDrawer` from `web/oss/src/components/TestcasesTableNew/components/` into the `@agenta/entity-ui` workspace package (`web/packages/agenta-entity-ui/src/testcase/`), so it lives alongside `TestcaseTable` and is importable as `@agenta/entity-ui/testcase`.

**Architecture:** The drawer component is split into two layers. The *shell* (visual chrome, session state, edit mode, drill-in path, loading/error display, title, footer) moves to `@agenta/entity-ui`. Entity-specific data (testcase atoms, dispatch) is **injected via props** from an OSS adapter. The field editor content (`TestcaseEditDrawerContent` with `EntityDualViewEditor`) is injected via a `renderContent` render prop — it stays in OSS for now, keeping this migration atomic. `EnhancedDrawer` (currently duplicated between OSS and `agenta-playground-ui`) moves to `@agenta/ui` first, since entity-ui depends on @agenta/ui.

**Tech Stack:** TypeScript, React, Ant Design (`antd` peer dep already on entity-ui), `@phosphor-icons/react` (already in entity-ui deps), `@agenta/ui` (already a dep of entity-ui).

---

## Investigation Findings

Before reading this plan, here is what the codebase investigation revealed:

| Concern | Finding |
|---|---|
| `EnhancedDrawer` | Only in OSS + playground-ui (duplicated). Not in @agenta/ui yet. Needs to move there. |
| `copyToClipboard` | Already in `@agenta/ui` (main export). OSS drawer uses it with `false` (no toast) — package version has no toast, no regression. |
| `Column` type | In `@agenta/entities/src/testcase/core/types.ts`, exported from `@agenta/entities/testcase`. |
| `FlattenedTestcase` | OSS-only type. Drawer shell uses it only for opaque JSON clone → use `unknown` generic `<TData>`. |
| `testcaseMolecule` | In `@agenta/entities/testcase`. Used only in OSS adapter, not in the shell. |
| `EntityDualViewEditor` | Component in OSS `DrillInView/`. Props interface already in `@agenta/ui/drill-in/coreTypes.ts`. The component stays in OSS, injected via `renderContent`. |
| `AddToQueuePopover` | `@agenta/annotation-ui` — platform-specific. Injected via `renderAddToQueue` render prop. |
| entity-ui peer deps | `antd`, `jotai`, `@phosphor-icons/react` are all already peer deps. ✓ |
| `DataType`, `detectDataType`, etc. | Already in `@agenta/ui/drill-in` and re-exported from `@agenta/entity-ui/drill-in`. The OSS `fieldUtils.ts` is a historical duplicate. |

---

## File Map

### Phase 1: Add EnhancedDrawer to @agenta/ui

| Action | Path |
|---|---|
| Create | `web/packages/agenta-ui/src/drawer/EnhancedDrawer.tsx` |
| Create | `web/packages/agenta-ui/src/drawer/index.ts` |
| Modify | `web/packages/agenta-ui/package.json` — add `"./drawer"` export entry |

### Phase 2: TestcaseDrawer shell in @agenta/entity-ui

| Action | Path |
|---|---|
| Create | `web/packages/agenta-entity-ui/src/testcase/TestcaseDrawer.tsx` |
| Modify | `web/packages/agenta-entity-ui/src/testcase/index.ts` — add export |

### Phase 3: OSS adapter wires entity state → shell

| Action | Path |
|---|---|
| Create | `web/oss/src/components/SharedDrawers/TestcaseDrawer/index.tsx` |

### Phase 4: Backward compat + consumer updates

| Action | Path |
|---|---|
| Replace | `web/oss/src/components/TestcasesTableNew/components/TestcaseEditDrawer.tsx` → re-export shim |
| Modify | `web/oss/src/components/TestcasesTableNew/index.tsx:30` — update import |
| Modify | `web/oss/src/components/Playground/Components/TestsetDropdown/TestsetPreviewPanelWrapper.tsx:23` — update import |

---

## Task 1: Add EnhancedDrawer to @agenta/ui

**Files:**
- Create: `web/packages/agenta-ui/src/drawer/EnhancedDrawer.tsx`
- Create: `web/packages/agenta-ui/src/drawer/index.ts`
- Modify: `web/packages/agenta-ui/package.json`

- [ ] **Step 1.1: Create EnhancedDrawer.tsx**

Create `web/packages/agenta-ui/src/drawer/EnhancedDrawer.tsx` with this content (unified from the two identical copies already in the repo):

```tsx
import {useEffect, useMemo, useState} from "react"

import {Drawer, type DrawerProps} from "antd"

export interface EnhancedDrawerProps extends DrawerProps {
    children: React.ReactNode
    closeOnLayoutClick?: boolean
}

const EnhancedDrawer = ({
    children,
    closeOnLayoutClick = true,
    width,
    styles,
    afterOpenChange: externalAfterOpenChange,
    ...props
}: EnhancedDrawerProps) => {
    const {open: isVisible, onClose, mask} = props
    const [shouldRender, setShouldRender] = useState(!!isVisible)

    const drawerStyles = useMemo(() => {
        if (!width) return styles
        const s = styles as Record<string, unknown> | undefined
        return {
            ...s,
            wrapper: {
                ...(s?.wrapper as React.CSSProperties | undefined),
                width,
            },
        }
    }, [width, styles])

    const maskProps = useMemo(() => {
        if (mask === false) return false
        const maskObj = typeof mask === "object" ? mask : {}
        return {blur: false, ...maskObj}
    }, [mask])

    useEffect(() => {
        if (isVisible) {
            setShouldRender(true)
        }
    }, [isVisible])

    useEffect(() => {
        if (!shouldRender) return

        function handleClickOutside(event: MouseEvent) {
            if ((event.target as HTMLElement).closest(".variant-table-row")) {
                return
            } else if (closeOnLayoutClick && (event.target as HTMLElement).closest(".ant-layout")) {
                onClose?.({} as React.MouseEvent)
            }
        }

        document.addEventListener("click", handleClickOutside)
        return () => {
            document.removeEventListener("click", handleClickOutside)
        }
    }, [shouldRender, closeOnLayoutClick, onClose])

    const handleAfterOpenChange = (open: boolean) => {
        externalAfterOpenChange?.(open)
        if (!open) {
            setShouldRender(false)
        }
    }

    if (!shouldRender) return null

    return (
        <Drawer
            {...props}
            open={isVisible}
            afterOpenChange={handleAfterOpenChange}
            styles={drawerStyles}
            mask={maskProps}
        >
            {children}
        </Drawer>
    )
}

export default EnhancedDrawer
```

- [ ] **Step 1.2: Create drawer/index.ts**

Create `web/packages/agenta-ui/src/drawer/index.ts`:

```ts
export {default as EnhancedDrawer, type EnhancedDrawerProps} from "./EnhancedDrawer"
```

- [ ] **Step 1.3: Add export to @agenta/ui package.json**

In `web/packages/agenta-ui/package.json`, add to the `"exports"` object (after `"./drill-in"`):

```json
"./drawer": "./src/drawer/index.ts",
```

- [ ] **Step 1.4: Verify types compile**

```bash
cd web/packages/agenta-ui && pnpm types:check 2>&1 | head -30
```

Expected: 0 errors.

---

## Task 2: Create TestcaseDrawer shell in @agenta/entity-ui

**Files:**
- Create: `web/packages/agenta-entity-ui/src/testcase/TestcaseDrawer.tsx`
- Modify: `web/packages/agenta-entity-ui/src/testcase/index.ts`

This component is the moved shell of `TestcaseEditDrawer.tsx`. It has **no `@/oss/*` imports**. Entity data comes via props; field editor content comes via `renderContent`; the add-to-queue feature comes via `renderAddToQueue`.

- [ ] **Step 2.1: Create TestcaseDrawer.tsx**

Create `web/packages/agenta-entity-ui/src/testcase/TestcaseDrawer.tsx`:

```tsx
import {useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from "react"

import {CaretDoubleRight, CaretDown, CaretUp, Copy, ListChecks} from "@phosphor-icons/react"
import {Alert, Button, Dropdown, Segmented, Skeleton, Space, Tooltip} from "antd"

import {copyToClipboard} from "@agenta/ui"
import {EnhancedDrawer} from "@agenta/ui/drawer"

type EditMode = "fields" | "json"

export interface TestcaseDrawerContentRenderProps {
    editMode: EditMode
    onEditModeChange: (mode: EditMode) => void
    initialPath: string[]
    onPathChange: (path: string[]) => void
}

export interface TestcaseDrawerProps<TData = unknown> {
    open: boolean
    onClose: () => void
    testcaseId: string | null
    isNewRow: boolean
    afterOpenChange?: (open: boolean) => void
    onPrevious?: () => void
    onNext?: () => void
    hasPrevious?: boolean
    hasNext?: boolean
    testcaseNumber?: number
    onOpenCommitModal?: () => void
    onSaveTestset?: (params?: {
        testsetName?: string
        commitMessage?: string
    }) => Promise<string | null>
    isSavingTestset?: boolean
    // Entity data injected from outside
    testcaseData: TData | null
    isLoading: boolean
    isError: boolean
    errorMessage?: string
    isDirty: boolean
    onRestoreSessionStart: (data: TData) => void
    // Content injected from outside
    renderContent: (props: TestcaseDrawerContentRenderProps) => ReactNode
    // Optional: annotation queue feature — injected by platforms that support it
    renderAddToQueue?: (itemIds: string[]) => ReactNode
}

function TestcaseDrawer<TData = unknown>({
    open,
    onClose,
    testcaseId,
    isNewRow,
    afterOpenChange,
    onPrevious,
    onNext,
    hasPrevious = false,
    hasNext = false,
    testcaseNumber,
    onOpenCommitModal,
    onSaveTestset,
    isSavingTestset = false,
    testcaseData,
    isLoading,
    isError,
    errorMessage,
    isDirty,
    onRestoreSessionStart,
    renderContent,
    renderAddToQueue,
}: TestcaseDrawerProps<TData>) {
    // Capture draft state when drawer opens (for session-based cancel)
    const sessionStartDraftsRef = useRef<Map<string, TData>>(new Map())
    const sessionStartDraft = testcaseId
        ? (sessionStartDraftsRef.current.get(testcaseId) ?? null)
        : null

    const [editMode, setEditMode] = useState<EditMode>("fields")
    const [isIdCopied, setIsIdCopied] = useState(false)
    const [drillInPath, setDrillInPath] = useState<string[]>([])

    // Track which testcases were ever dirty during this session (enables save after revert)
    const [everDirtyIds, setEverDirtyIds] = useState<Set<string>>(new Set())

    useEffect(() => {
        if (open && testcaseId && isDirty) {
            setEverDirtyIds((prev) => {
                if (prev.has(testcaseId)) return prev
                const next = new Set(prev)
                next.add(testcaseId)
                return next
            })
        }
    }, [open, testcaseId, isDirty])

    useEffect(() => {
        if (!open) {
            setEverDirtyIds(new Set())
        }
    }, [open])

    const hasSessionDirty = everDirtyIds.size > 0

    useEffect(() => {
        if (open && testcaseId && testcaseData) {
            if (!sessionStartDraftsRef.current.has(testcaseId)) {
                sessionStartDraftsRef.current.set(
                    testcaseId,
                    JSON.parse(JSON.stringify(testcaseData)),
                )
            }
        } else if (!open) {
            sessionStartDraftsRef.current.clear()
            setDrillInPath([])
        }
    }, [open, testcaseId, testcaseData])

    const handleApply = useCallback(() => {
        onClose()
    }, [onClose])

    const handleOpenCommitModal = useCallback(() => {
        onOpenCommitModal?.()
    }, [onOpenCommitModal])

    const handleSaveTestset = useCallback(async () => {
        await onSaveTestset?.()
    }, [onSaveTestset])

    const handleCancel = useCallback(() => {
        if (testcaseId && sessionStartDraft) {
            onRestoreSessionStart(sessionStartDraft)
        }
        onClose()
    }, [testcaseId, sessionStartDraft, onRestoreSessionStart, onClose])

    const handleCopyId = useCallback(async () => {
        if (!testcaseId) return
        await copyToClipboard(testcaseId)
        setIsIdCopied(true)
        setTimeout(() => setIsIdCopied(false), 2000)
    }, [testcaseId])

    const queueItemIds = useMemo(
        () => (testcaseId && !isNewRow && !testcaseId.startsWith("new-") ? [testcaseId] : []),
        [testcaseId, isNewRow],
    )

    const title = useMemo(
        () => (
            <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-1">
                    <Button
                        type="text"
                        size="small"
                        icon={<CaretDoubleRight size={14} />}
                        onClick={handleCancel}
                    />
                    {(onPrevious || onNext) && (
                        <div className="flex items-center">
                            <Button
                                type="text"
                                size="small"
                                icon={<CaretUp size={14} />}
                                disabled={!hasPrevious}
                                onClick={onPrevious}
                            />
                            <Button
                                type="text"
                                size="small"
                                icon={<CaretDown size={14} />}
                                disabled={!hasNext}
                                onClick={onNext}
                            />
                        </div>
                    )}
                    <span className="font-medium text-sm">
                        {isNewRow ? "New Testcase" : `Testcase ${testcaseNumber ?? ""}`}
                    </span>
                    {isDirty && (
                        <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">
                            edited
                        </span>
                    )}
                    {testcaseId && !isNewRow && (
                        <Tooltip title={isIdCopied ? "Copied!" : "Copy ID"}>
                            <Button
                                type="text"
                                size="small"
                                icon={<Copy size={14} />}
                                onClick={handleCopyId}
                            />
                        </Tooltip>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {renderAddToQueue ? (
                        renderAddToQueue(queueItemIds)
                    ) : (
                        <Button
                            size="small"
                            icon={<ListChecks size={14} />}
                            disabled={true}
                        >
                            Add to queue
                        </Button>
                    )}
                    <Segmented
                        size="small"
                        value={editMode}
                        onChange={(value) => setEditMode(value as EditMode)}
                        options={[
                            {label: "Fields", value: "fields"},
                            {label: "JSON", value: "json"},
                        ]}
                    />
                </div>
            </div>
        ),
        [
            testcaseId,
            isNewRow,
            editMode,
            onPrevious,
            onNext,
            hasPrevious,
            hasNext,
            handleCopyId,
            isIdCopied,
            testcaseNumber,
            handleCancel,
            isDirty,
            queueItemIds,
            renderAddToQueue,
        ],
    )

    return (
        <EnhancedDrawer
            title={title}
            open={open}
            onClose={handleCancel}
            size="large"
            closeIcon={null}
            closeOnLayoutClick={false}
            afterOpenChange={afterOpenChange}
            destroyOnHidden
            styles={{
                body: {padding: "0px"},
                footer: {padding: "12px 24px", display: "flex", justifyContent: "flex-end"},
            }}
            footer={
                <div className="w-full flex items-center justify-end gap-3">
                    <Button onClick={handleCancel}>Cancel</Button>
                    <Space.Compact>
                        <Button
                            type="primary"
                            onClick={handleApply}
                            disabled={!hasSessionDirty}
                            loading={isSavingTestset}
                        >
                            Apply and Continue Editing
                        </Button>
                        <Dropdown
                            placement="topRight"
                            menu={{
                                items: [
                                    ...(onOpenCommitModal
                                        ? [
                                              {
                                                  key: "commit",
                                                  label: "Apply and Commit Changes",
                                                  onClick: handleOpenCommitModal,
                                                  disabled: !hasSessionDirty,
                                              },
                                          ]
                                        : []),
                                    ...(onSaveTestset
                                        ? [
                                              {
                                                  key: "save",
                                                  label: "Apply and Save Testset",
                                                  onClick: handleSaveTestset,
                                                  disabled: !hasSessionDirty,
                                              },
                                          ]
                                        : []),
                                ],
                            }}
                        >
                            <Button
                                type="primary"
                                icon={<CaretUp size={14} />}
                                disabled={
                                    !hasSessionDirty || (!onOpenCommitModal && !onSaveTestset)
                                }
                            />
                        </Dropdown>
                    </Space.Compact>
                </div>
            }
        >
            {open && testcaseId && (
                <>
                    {isLoading && (
                        <div className="p-6 space-y-4">
                            <Skeleton active paragraph={{rows: 8}} />
                        </div>
                    )}
                    {isError && (
                        <div className="p-6">
                            <Alert
                                type="error"
                                message="Failed to load testcase"
                                description={errorMessage ?? "Unknown error"}
                                showIcon
                            />
                        </div>
                    )}
                    {testcaseData &&
                        renderContent({
                            editMode,
                            onEditModeChange: setEditMode,
                            initialPath: drillInPath,
                            onPathChange: setDrillInPath,
                        })}
                </>
            )}
        </EnhancedDrawer>
    )
}

export default TestcaseDrawer
```

- [ ] **Step 2.2: Update testcase/index.ts to export TestcaseDrawer**

In `web/packages/agenta-entity-ui/src/testcase/index.ts`, add after the existing export:

```ts
export {default as TestcaseDrawer} from "./TestcaseDrawer"
export type {TestcaseDrawerProps, TestcaseDrawerContentRenderProps} from "./TestcaseDrawer"
```

- [ ] **Step 2.3: Verify entity-ui types compile**

```bash
cd web/packages/agenta-entity-ui && pnpm types:check 2>&1 | head -30
```

Expected: 0 errors. If `antd` peer dep resolution fails, ensure the workspace root has antd installed.

---

## Task 3: Create OSS adapter

**Files:**
- Create: `web/oss/src/components/SharedDrawers/TestcaseDrawer/index.tsx`

This adapter reads from the testcase Jotai atoms and connects them to the packaged `TestcaseDrawer` props. It also provides the `renderContent` and `renderAddToQueue` render props — the entity-coupled content that stays in OSS.

- [ ] **Step 3.1: Create the OSS adapter**

Create `web/oss/src/components/SharedDrawers/TestcaseDrawer/index.tsx`:

```tsx
import {useCallback, type ReactNode} from "react"

import dynamic from "next/dynamic"
import {useAtomValue, useSetAtom} from "jotai"

import {TestcaseDrawer, type TestcaseDrawerContentRenderProps} from "@agenta/entity-ui/testcase"
import {ListChecks} from "@phosphor-icons/react"
import {Button} from "antd"

import {testcase} from "@/oss/state/entities/testcase"
import type {Column} from "@/oss/state/entities/testcase/columnState"

import TestcaseEditDrawerContent from "@/oss/components/TestcasesTableNew/components/TestcaseEditDrawer/index"

const AddToQueuePopover = dynamic(
    () => import("@agenta/annotation-ui/add-to-queue").then((m) => m.default),
    {ssr: false},
)

interface TestcaseEditDrawerProps {
    open: boolean
    onClose: () => void
    testcaseId: string | null
    columns: Column[]
    isNewRow: boolean
    afterOpenChange?: (open: boolean) => void
    onPrevious?: () => void
    onNext?: () => void
    hasPrevious?: boolean
    hasNext?: boolean
    testcaseNumber?: number
    onOpenCommitModal?: () => void
    onSaveTestset?: (params?: {
        testsetName?: string
        commitMessage?: string
    }) => Promise<string | null>
    isSavingTestset?: boolean
}

const TestcaseEditDrawer = ({
    testcaseId,
    columns,
    isNewRow,
    ...rest
}: TestcaseEditDrawerProps) => {
    const testcaseData = useAtomValue(testcase.selectors.data(testcaseId || ""))
    const queryState = useAtomValue(testcase.selectors.query(testcaseId || ""))
    const isDirty = useAtomValue(testcase.selectors.isDirty(testcaseId || ""))
    const dispatch = useSetAtom(testcase.controller(testcaseId || ""))

    const handleRestoreSessionStart = useCallback(
        (data: unknown) => {
            dispatch({type: "update", changes: data as any})
        },
        [dispatch],
    )

    const renderContent = useCallback(
        ({editMode, onEditModeChange, initialPath, onPathChange}: TestcaseDrawerContentRenderProps): ReactNode => (
            <TestcaseEditDrawerContent
                key={testcaseId}
                testcaseId={testcaseId!}
                columns={columns}
                isNewRow={isNewRow}
                onClose={rest.onClose}
                editMode={editMode}
                onEditModeChange={onEditModeChange}
                initialPath={initialPath}
                onPathChange={onPathChange}
            />
        ),
        [testcaseId, columns, isNewRow, rest.onClose],
    )

    const renderAddToQueue = useCallback(
        (itemIds: string[]) => (
            <AddToQueuePopover
                itemType="testcases"
                itemIds={itemIds}
                disabled={itemIds.length === 0}
            >
                <Button
                    size="small"
                    icon={<ListChecks size={14} />}
                    disabled={itemIds.length === 0}
                >
                    Add to queue
                </Button>
            </AddToQueuePopover>
        ),
        [],
    )

    return (
        <TestcaseDrawer
            {...rest}
            testcaseId={testcaseId}
            isNewRow={isNewRow}
            testcaseData={testcaseData}
            isLoading={queryState.isPending}
            isError={queryState.isError}
            errorMessage={queryState.error?.message}
            isDirty={isDirty}
            onRestoreSessionStart={handleRestoreSessionStart}
            renderContent={renderContent}
            renderAddToQueue={renderAddToQueue}
        />
    )
}

export default TestcaseEditDrawer
```

---

## Task 4: Backward compat + consumer updates

**Files:**
- Modify: `web/oss/src/components/TestcasesTableNew/components/TestcaseEditDrawer.tsx`
- Modify: `web/oss/src/components/TestcasesTableNew/index.tsx:30`
- Modify: `web/oss/src/components/Playground/Components/TestsetDropdown/TestsetPreviewPanelWrapper.tsx:23`

- [ ] **Step 4.1: Convert TestcaseEditDrawer.tsx to re-export shim**

Replace the entire content of `web/oss/src/components/TestcasesTableNew/components/TestcaseEditDrawer.tsx` with:

```ts
// Re-export from canonical location in SharedDrawers
export {default} from "@/oss/components/SharedDrawers/TestcaseDrawer"
```

- [ ] **Step 4.2: Update TestcasesTableNew/index.tsx import**

At line 30, change:

```ts
// OLD
import TestcaseEditDrawer from "./components/TestcaseEditDrawer"
```

to:

```ts
// NEW
import TestcaseEditDrawer from "@/oss/components/SharedDrawers/TestcaseDrawer"
```

- [ ] **Step 4.3: Update TestsetPreviewPanelWrapper.tsx import**

At line 23, change:

```ts
// OLD
import TestcaseEditDrawer from "@/oss/components/TestcasesTableNew/components/TestcaseEditDrawer"
```

to:

```ts
// NEW
import TestcaseEditDrawer from "@/oss/components/SharedDrawers/TestcaseDrawer"
```

---

## Task 5: Verify

- [ ] **Step 5.1: Type-check the entire web workspace**

```bash
cd web && pnpm tsc --noEmit 2>&1 | head -60
```

Expected: 0 errors. If errors appear, they will name the broken file and line — fix before continuing.

- [ ] **Step 5.2: Run lint-fix**

```bash
cd web && pnpm lint-fix 2>&1 | tail -20
```

Expected: no new errors. Auto-fixable issues are fixed in-place.

- [ ] **Step 5.3: Confirm no direct imports of the old buried path remain**

```bash
grep -r "TestcasesTableNew/components/TestcaseEditDrawer\"" \
  web/oss/src web/ee/src --include="*.ts" --include="*.tsx" \
  | grep -v "re-export\|backward\|TestcaseEditDrawer\." \
  | grep -v components/TestcaseEditDrawer/
```

Expected: zero results from non-shim files. Only the `TestcaseEditDrawer.tsx` shim itself should appear.

---

## Self-Review

**Spec coverage:**
- [x] `EnhancedDrawer` added to `@agenta/ui/drawer` (new subpath export)
- [x] `TestcaseDrawer` shell created in `@agenta/entity-ui/src/testcase/` with no `@/oss/*` imports
- [x] All session state logic (`sessionStartDraftsRef`, `everDirtyIds`, `drillInPath`) preserved in shell
- [x] Entity data injected via props (`testcaseData`, `isDirty`, `isLoading`, `isError`)
- [x] Content injected via `renderContent` render prop
- [x] `AddToQueuePopover` injected via `renderAddToQueue` render prop
- [x] OSS adapter created at `SharedDrawers/TestcaseDrawer/`
- [x] Old `TestcaseEditDrawer.tsx` converted to re-export shim (backward compat)
- [x] Both direct consumers updated
- [x] Verification steps included

**No UI changes:** The `TestcaseDrawer` shell contains identical markup and logic to the original `TestcaseEditDrawer.tsx`. The only behavioral difference: `renderAddToQueue` shows a disabled fallback button when not provided (instead of the real popover) — but the OSS adapter always provides it, so no user-visible change.

**Placeholder scan:** Every step shows exact file paths, exact before/after code. No "TBD" entries.

**Type consistency:** `TestcaseDrawerContentRenderProps` is defined in `TestcaseDrawer.tsx` (Task 2), imported in the OSS adapter (Task 3). `TestcaseDrawerProps<TData>` generic is consistent throughout.

---

## Notes for Follow-up

These are intentionally out of scope but worth noting:

1. **`@agenta/entity-ui` exports** — add `"./testcase"` is already in the package.json exports, so `TestcaseDrawer` becomes importable as `import {TestcaseDrawer} from "@agenta/entity-ui/testcase"` immediately.

2. **`EnhancedDrawer` consolidation** — `web/oss/src/components/EnhancedUIs/Drawer/` and `web/packages/agenta-playground-ui/src/components/FocusDrawer/components/EnhancedDrawer.tsx` are now duplicates of the new `@agenta/ui/drawer`. A follow-up can update OSS and playground-ui to import from `@agenta/ui/drawer` and delete the duplicates.

3. **`fieldUtils.ts` cleanup** — `NestedFieldEditor.tsx`, `TestcaseFieldRenderer.tsx`, and the OSS `DrillInView/` files import from `fieldUtils.ts`. The utility functions there (`detectDataType`, `isChatMessageObject`, etc.) are already re-exported from `@agenta/ui/drill-in`. A follow-up can replace `fieldUtils.ts` imports with `@agenta/ui/drill-in` and delete the OSS duplicate.
