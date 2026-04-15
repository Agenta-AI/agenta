# Dynamic Tabs via `buildTabs` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static `tabs?: TabDefinition[]` field on `HierarchyLevel` with a `buildTabs(items) => TabDefinition[]` function so that the `PopoverCascaderVariant` derives tabs dynamically from loaded data — only showing tabs for categories that have items.

**Architecture:** Four files need changes in order: (1) the core `HierarchyLevel` type, (2) the adapter-level `LevelOverride` interface and its merge helper, (3) the workflow revision adapter's `grandparentOverrides` interface and pass-through, and (4) the `PopoverCascaderVariant` component that swaps static tab reading for a `useMemo` call. A fifth file wires the evaluator-specific `buildTabs` logic in `useEnrichedEvaluatorOnlyAdapter`.

**Tech Stack:** TypeScript, React (useMemo, useState, useCallback), Jotai, Ant Design Tabs

---

## File Map

| File | Change |
|---|---|
| `web/packages/agenta-entity-ui/src/selection/types.ts` | Replace `tabs?: TabDefinition[]` with `buildTabs?: (items: T[]) => TabDefinition[]` on `HierarchyLevel` |
| `web/packages/agenta-entity-ui/src/selection/adapters/createAdapterFromRelations.ts` | Same replacement on `LevelOverride`; update `applyOverrides` pass-through |
| `web/packages/agenta-entity-ui/src/selection/adapters/workflowRevisionRelationAdapter.ts` | Update `grandparentOverrides` interface; update the skipVariantLevel pass-through |
| `web/packages/agenta-entity-ui/src/selection/components/UnifiedEntityPicker/variants/PopoverCascaderVariant.tsx` | Swap static `rootLevel?.tabs` for `useMemo(() => rootLevel?.buildTabs?.(rootItems))` |
| `web/packages/agenta-entity-ui/src/selection/adapters/useEnrichedEvaluatorAdapter.ts` | Replace hardcoded `tabs: [...]` with `buildTabs: (entities) => {...}` closure |

---

## Task 1: Update `HierarchyLevel` type

**Files:**
- Modify: `web/packages/agenta-entity-ui/src/selection/types.ts:282-288`

- [ ] **Step 1: Replace the `tabs` field with `buildTabs`**

In `types.ts`, find lines 282–288 (the JSDoc + `tabs?: TabDefinition[]` line) and replace:

```typescript
// Before (lines 282-288):
    /**
     * Optional tab definitions for filtering items by group.
     * When provided, the component renders tabs above the item list.
     * Each tab filters items by `getGroupKey` match. The "all" key shows all items grouped.
     * Requires `getGroupKey` to be defined for meaningful filtering.
     */
    tabs?: TabDefinition[]

// After:
    /**
     * Optional function that derives tab definitions from loaded items.
     * Called after items load — only shows tabs for groups that actually have data.
     * Each tab filters items by `getGroupKey` match. The "all" key shows all items grouped.
     * Requires `getGroupKey` to be defined for meaningful filtering.
     */
    buildTabs?: (items: T[]) => TabDefinition[]
```

- [ ] **Step 2: Type-check**

```bash
cd web/packages/agenta-entity-ui && pnpm types:check 2>&1 | head -40
```

Expected: Errors for `tabs` usages in other files (those get fixed in subsequent tasks). No errors inside `types.ts` itself.

---

## Task 2: Update `LevelOverride` in `createAdapterFromRelations.ts`

**Files:**
- Modify: `web/packages/agenta-entity-ui/src/selection/adapters/createAdapterFromRelations.ts:87` (interface)
- Modify: `web/packages/agenta-entity-ui/src/selection/adapters/createAdapterFromRelations.ts:235` (applyOverrides)

- [ ] **Step 1: Replace `tabs` in the `LevelOverride` interface**

Find line ~87 and replace:

```typescript
// Before:
    /** Tab definitions for filtering items by group */
    tabs?: import("../types").TabDefinition[]

// After:
    /** Function to derive tab definitions from loaded items */
    buildTabs?: (items: T[]) => import("../types").TabDefinition[]
```

- [ ] **Step 2: Update `applyOverrides` pass-through**

Find line ~235 (inside the `applyOverrides` function) and replace:

```typescript
// Before:
        tabs: overrides.tabs ?? baseLevel.tabs,

// After:
        buildTabs: overrides.buildTabs ?? baseLevel.buildTabs,
```

- [ ] **Step 3: Type-check**

```bash
cd web/packages/agenta-entity-ui && pnpm types:check 2>&1 | head -40
```

Expected: Remaining errors only in `workflowRevisionRelationAdapter.ts` and `useEnrichedEvaluatorAdapter.ts` and `PopoverCascaderVariant.tsx` — the files we haven't fixed yet.

---

## Task 3: Update `workflowRevisionRelationAdapter.ts`

**Files:**
- Modify: `web/packages/agenta-entity-ui/src/selection/adapters/workflowRevisionRelationAdapter.ts:294-299` (interface)
- Modify: `web/packages/agenta-entity-ui/src/selection/adapters/workflowRevisionRelationAdapter.ts:480` (pass-through)

- [ ] **Step 1: Update `grandparentOverrides` interface**

Find the `grandparentOverrides` block in `CreateWorkflowRevisionAdapterOptions` (around line 294) and replace the `tabs` field:

```typescript
// Before:
        tabs?: import("../types").TabDefinition[]

// After:
        buildTabs?: (items: unknown[]) => import("../types").TabDefinition[]
```

The full updated `grandparentOverrides` block should look like:

```typescript
    grandparentOverrides?: {
        getLabelNode?: (entity: unknown) => React.ReactNode
        getGroupKey?: (entity: unknown) => string | null | undefined
        getGroupLabel?: (key: string) => string
        buildTabs?: (items: unknown[]) => import("../types").TabDefinition[]
    }
```

- [ ] **Step 2: Update the skipVariantLevel pass-through**

In the `skipVariantLevel && !workflowId && !workflowIdAtom` branch (around line 467–518), inside `createTwoLevelAdapter`'s `parentOverrides`, find:

```typescript
// Before:
                tabs: grandparentOverrides.tabs,

// After:
                buildTabs: grandparentOverrides.buildTabs,
```

The full `parentOverrides` block in that branch should look like:

```typescript
            parentOverrides: {
                getId: (entity: unknown) => (entity as {id: string}).id,
                getLabel: getWorkflowDisplayName,
                getLabelNode: grandparentOverrides.getLabelNode ?? renderWorkflowLabelNode,
                hasChildren: true,
                isSelectable: false,
                getGroupKey: grandparentOverrides.getGroupKey,
                getGroupLabel: grandparentOverrides.getGroupLabel,
                buildTabs: grandparentOverrides.buildTabs,
            },
```

- [ ] **Step 3: Type-check**

```bash
cd web/packages/agenta-entity-ui && pnpm types:check 2>&1 | head -40
```

Expected: Remaining errors only in `useEnrichedEvaluatorAdapter.ts` and `PopoverCascaderVariant.tsx`.

---

## Task 4: Update `PopoverCascaderVariant.tsx`

**Files:**
- Modify: `web/packages/agenta-entity-ui/src/selection/components/UnifiedEntityPicker/variants/PopoverCascaderVariant.tsx:362-365` (tab state)
- Modify: `web/packages/agenta-entity-ui/src/selection/components/UnifiedEntityPicker/variants/PopoverCascaderVariant.tsx` (add dynamic tabs memo after rootItems)
- Modify: `web/packages/agenta-entity-ui/src/selection/components/UnifiedEntityPicker/variants/PopoverCascaderVariant.tsx:536-547` (handleOpenChange)

- [ ] **Step 1: Remove static tab reading and simplify initial state**

Find lines 362–364:
```typescript
    // Tab state (driven by adapter's rootLevel.tabs)
    const tabs = rootLevel?.tabs
    const [activeTabKey, setActiveTabKey] = useState<string>(tabs?.[0]?.key ?? "all")
```

Replace with just the state (no static read):
```typescript
    // Active tab state — always starts on "all", reset on close
    const [activeTabKey, setActiveTabKey] = useState<string>("all")
```

- [ ] **Step 2: Add dynamic `tabs` derivation after `rootItems` is fetched**

Find lines 367–372 (the `useLevelData` call for root items):
```typescript
    // Fetch root items
    const {items: rootItems, query: rootQuery} = useLevelData({
        levelConfig: rootLevel,
        parentId: null,
        isEnabled: true,
    })
```

Immediately **after** this block, insert:
```typescript

    // Derive tabs dynamically from loaded items (adapter provides buildTabs function)
    const tabs = useMemo(
        () => rootLevel?.buildTabs?.(rootItems) ?? null,
        [rootItems, rootLevel],
    )
```

- [ ] **Step 3: Fix `handleOpenChange` reset and dependency array**

Find the `handleOpenChange` callback (around lines 536–547):
```typescript
    const handleOpenChange = useCallback(
        (newOpen: boolean) => {
            setOpen(newOpen)
            if (!newOpen) {
                setSearchTerm("")
                setSelectedRootId(null)
                setSelectedRootEntity(null)
                setActiveTabKey(tabs?.[0]?.key ?? "all")
            }
        },
        [tabs],
    )
```

Replace with:
```typescript
    const handleOpenChange = useCallback(
        (newOpen: boolean) => {
            setOpen(newOpen)
            if (!newOpen) {
                setSearchTerm("")
                setSelectedRootId(null)
                setSelectedRootEntity(null)
                setActiveTabKey("all")
            }
        },
        [],
    )
```

- [ ] **Step 4: Type-check**

```bash
cd web/packages/agenta-entity-ui && pnpm types:check 2>&1 | head -40
```

Expected: Remaining errors only in `useEnrichedEvaluatorAdapter.ts` (the `tabs: [...]` still present).

---

## Task 5: Replace static tabs with `buildTabs` in the evaluator adapter

**Files:**
- Modify: `web/packages/agenta-entity-ui/src/selection/adapters/useEnrichedEvaluatorAdapter.ts:195-212` (grandparentOverrides in `useEnrichedEvaluatorOnlyAdapter`)

- [ ] **Step 1: Replace the static `tabs` array with `buildTabs`**

In `useEnrichedEvaluatorOnlyAdapter`, inside the `useMemo` that builds `options`, find the `grandparentOverrides` block (lines ~195–212):

```typescript
        grandparentOverrides: {
            getLabelNode,
            getGroupKey,
            getGroupLabel,
            tabs: [
                {key: "all", label: "All"},
                {key: "ai_llm", label: "AI / LLM"},
                {key: "classifiers", label: "Classifiers"},
                {key: "similarity", label: "Similarity"},
                {key: "custom", label: "Custom"},
            ],
        },
```

Replace with:

```typescript
        grandparentOverrides: {
            getLabelNode,
            getGroupKey,
            getGroupLabel,
            buildTabs: (entities: unknown[]) => {
                const ORDERED_CATEGORIES = ["ai_llm", "classifiers", "similarity", "custom"]
                const categorySeen = new Set<string>()
                for (const e of entities) {
                    const w = e as {id: string}
                    const key = evaluatorKeyMapRef.current.get(w.id)
                    const cat = key
                        ? templateCategoryMapRef.current.get(key) ?? "custom"
                        : "custom"
                    categorySeen.add(cat)
                }
                const result: {key: string; label: string}[] = [{key: "all", label: "All"}]
                for (const cat of ORDERED_CATEGORIES) {
                    if (categorySeen.has(cat)) {
                        result.push({key: cat, label: CATEGORY_LABELS[cat]})
                    }
                }
                return result
            },
        },
```

Note: `CATEGORY_LABELS` and `evaluatorKeyMapRef` / `templateCategoryMapRef` are already in scope — they are defined earlier in the same `useMemo` closure body.

- [ ] **Step 2: Type-check — expect zero errors**

```bash
cd web/packages/agenta-entity-ui && pnpm types:check 2>&1 | head -60
```

Expected: No errors.

---

## Task 6: Lint and verify

**Files:** All modified files above.

- [ ] **Step 1: Run lint-fix from web root**

```bash
cd web && pnpm lint-fix 2>&1 | tail -20
```

Expected: No unfixable lint errors.

- [ ] **Step 2: Final typecheck**

```bash
cd web/packages/agenta-entity-ui && pnpm types:check
```

Expected: Exit 0.

- [ ] **Step 3: Manual smoke-test checklist**

Open the playground evaluator connect popover (uses `useEnrichedEvaluatorOnlyAdapter` → `PopoverCascaderVariant`):

- [ ] Tabs appear only for categories that have evaluators (no empty "Classifiers" tab if no classifiers exist)
- [ ] "All" tab is always present and shows all evaluators
- [ ] Clicking a category tab filters the left panel to that category only
- [ ] Closing and reopening the popover resets to "All" tab
- [ ] Search still works within the active tab

- [ ] **Step 4: Commit**

```bash
cd /Users/ashrasfchowdury/Documents/company/agenta
git add \
  web/packages/agenta-entity-ui/src/selection/types.ts \
  web/packages/agenta-entity-ui/src/selection/adapters/createAdapterFromRelations.ts \
  web/packages/agenta-entity-ui/src/selection/adapters/workflowRevisionRelationAdapter.ts \
  web/packages/agenta-entity-ui/src/selection/components/UnifiedEntityPicker/variants/PopoverCascaderVariant.tsx \
  web/packages/agenta-entity-ui/src/selection/adapters/useEnrichedEvaluatorAdapter.ts
git commit -m "$(cat <<'EOF'
refactor(entity-ui): replace static tabs with dynamic buildTabs on HierarchyLevel

Tabs in PopoverCascaderVariant are now derived from loaded items via a
buildTabs(items) function on the adapter, so only categories with data
appear. Removes the hardcoded evaluator tab list from
useEnrichedEvaluatorOnlyAdapter.

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```
