# Inline Evaluator Creation in Evaluation Modals

## Overview

This document outlines the plan to simplify the evaluator creation flow during evaluation setup. Currently, creating a new evaluator while setting up an evaluation requires navigating away from the evaluation modal, causing loss of context. This feature enables inline evaluator creation through a drawer component without leaving the evaluation flow.

**Prerequisites**: Before working on any task in this plan, read `/AGENTS.md` thoroughly. It contains critical requirements for:
- State management (Jotai atoms, avoiding prop drilling)
- Data fetching patterns (atomWithQuery)
- Component architecture (modular design, high cohesion, low coupling)
- Styling (Tailwind CSS preferred)
- Import aliases (@/oss/*, @agenta/oss/src/*)

---

## Goals

1. **Context Preservation**: Users stay in the evaluation modal while creating evaluators
2. **Progressive Disclosure**: Collapsed drawer shows configuration; expanded shows testing
3. **Reusability**: Components work for both automatic and human evaluation flows
4. **Best Practices**: Follow AGENTS.md guidelines for atoms, state, and architecture

---

## Current State

### User Flow (Current - Problematic)

```
Evaluation Modal → Click "Create new" → Navigate to /evaluators page
→ Select evaluator type → Navigate to /evaluators/configure/[id]
→ Configure & test → Commit → Navigate back to evaluation modal
→ Lost context, must re-select options
```

### User Flow (Target)

```
Evaluation Modal → Click "Create new" → Dropdown shows evaluator types
→ Select type → Drawer opens with configuration form
→ Optionally expand to see testing area → Commit
→ Evaluator auto-selected in modal → Continue evaluation setup
```

---

## Key Files Involved

### Evaluation Modal Components

| File | Purpose | Relevance |
|------|---------|-----------|
| `web/oss/src/components/pages/evaluations/NewEvaluation/index.tsx` | Main evaluation modal wrapper | Entry point, renders drawer |
| `web/oss/src/components/pages/evaluations/NewEvaluation/Components/NewEvaluationModalContent.tsx` | Modal content with sections | Contains evaluator selection section |
| `web/oss/src/components/pages/evaluations/NewEvaluation/Components/SelectEvaluatorSection/SelectEvaluatorSection.tsx` | Evaluator selection with "Create new" button | **Modify**: Add dropdown here |
| `web/oss/src/components/pages/evaluations/NewEvaluation/types.ts` | TypeScript types | May need new types |

### Evaluator Playground Components

| File | Purpose | Lines | Props |
|------|---------|-------|-------|
| `web/oss/src/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator/index.tsx` | Main playground component | 545 | 18 props |
| `web/oss/src/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator/DebugSection.tsx` | Test evaluator section | 1076 | 13 props |
| `web/oss/src/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator/DynamicFormField.tsx` | Form field renderer | - | - |
| `web/oss/src/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator/AdvancedSettings.tsx` | Collapsed advanced settings | - | - |
| `web/oss/src/components/Evaluators/components/ConfigureEvaluator/index.tsx` | Page wrapper for playground | 176 | - |

### Evaluator Template Selection

| File | Purpose |
|------|---------|
| `web/oss/src/components/Evaluators/components/SelectEvaluatorModal/assets/SelectEvaluatorModalContent/index.tsx` | Tab-filtered evaluator type list |
| `web/oss/src/state/evaluators/atoms.ts` | Evaluator-related atoms |

### Drawer Components

| File | Purpose |
|------|---------|
| `web/oss/src/components/GenericDrawer/index.tsx` | Expandable drawer with Splitter |
| `web/oss/src/components/GenericDrawer/types.d.ts` | Drawer props interface |
| `web/oss/src/components/EnhancedUIs/Drawer/index.tsx` | Base enhanced drawer |

### State Management

| File | Purpose |
|------|---------|
| `web/oss/src/state/evaluators/atoms.ts` | `evaluatorConfigsQueryAtomFamily`, `evaluatorsQueryAtomFamily`, `nonArchivedEvaluatorsAtom` |
| `web/oss/src/lib/hooks/useFetchEvaluatorsData/index.ts` | SWR-based fetching hook (legacy) |

---

## Architecture Overview

### Component Hierarchy

```
NewEvaluationModal
├── NewEvaluationModalContent
│   ├── SelectAppSection
│   ├── SelectVariantSection
│   ├── SelectTestsetSection
│   ├── SelectEvaluatorSection
│   │   ├── Evaluator Table
│   │   └── EvaluatorTemplateDropdown (NEW) ← Opens drawer
│   └── AdvancedSettings
└── CreateEvaluatorDrawer (NEW)
    ├── EvaluatorConfigPanel (uses atoms, renders ConfigureEvaluator)
    └── EvaluatorTestPanel (uses atoms, renders DebugSection) [expandable]
```

### State Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Evaluator Playground Atoms                  │
│                  (NEW - shared by page & drawer)            │
├─────────────────────────────────────────────────────────────┤
│ Core State:                                                 │
│   selectedEvaluatorAtom      - Current evaluator template   │
│   editModeAtom               - Edit vs create mode          │
│   editEvalValuesAtom         - Existing config being edited │
│   cloneModeAtom              - Clone mode flag              │
│                                                             │
│ Form State:                                                 │
│   evaluatorFormAtom          - Form instance reference      │
│   formValuesAtom             - Current form values          │
│                                                             │
│ Test Section State:                                         │
│   selectedTestcaseAtom       - Testcase for testing         │
│   selectedVariantAtom        - Variant for testing          │
│   selectedTestsetIdAtom      - Testset ID                   │
│   traceTreeAtom              - Trace output from variant    │
│                                                             │
│ Query Atoms:                                                │
│   testsetsQueryAtom          - Available testsets           │
│   variantsQueryAtom          - Available variants           │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                  Drawer-Specific Atoms                       │
│                  (NEW - only for drawer context)            │
├─────────────────────────────────────────────────────────────┤
│   createEvaluatorDrawerAtom  - {isOpen, isExpanded, ...}    │
│   onEvaluatorCreatedAtom     - Callback when committed      │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Tasks

### Checkpoint 1: Evaluator Template Dropdown in Modal

**Goal**: Add dropdown to select evaluator type when clicking "Create new" in SelectEvaluatorSection.

**Context**: This replaces the current behavior that navigates to `/evaluators` page. For automatic evaluations, show a dropdown with available evaluator types. For human evaluations, we may directly open the drawer with a predefined human evaluator type.

**Files to Modify**:
- `web/oss/src/components/pages/evaluations/NewEvaluation/Components/SelectEvaluatorSection/SelectEvaluatorSection.tsx`

**Files to Create**:
- `web/oss/src/components/pages/evaluations/NewEvaluation/Components/SelectEvaluatorSection/EvaluatorTemplateDropdown.tsx`

**High-Level Solution**:

1. Create `EvaluatorTemplateDropdown` component that:
   - Reuses filtering logic from `SelectEvaluatorModalContent`
   - Displays evaluator types in a dropdown panel with tabs (All, AI/LLM, Similarity, etc.)
   - Accepts `onSelect: (evaluator: Evaluator) => void` callback
   - Uses `nonArchivedEvaluatorsAtom` for evaluator list

2. Modify `SelectEvaluatorSection`:
   - Replace the "Create new" `<Button>` with `<Dropdown>` that renders `EvaluatorTemplateDropdown`
   - When evaluator type is selected, open the drawer (Checkpoint 4)
   - For human evaluations, consider different UX (direct drawer open or simplified dropdown)

**Acceptance Criteria**:
- Clicking "Create new" shows dropdown with evaluator types
- Dropdown has tab filtering like the evaluator registry page
- Selecting a type closes dropdown and triggers callback
- Works for both auto and human evaluation modals

---

### Checkpoint 2: Refactor Evaluator Playground to Use Atoms

**Goal**: Replace the 18+ props in ConfigureEvaluator and 13 props in DebugSection with Jotai atoms.

**Context**: This is the largest task. Currently, `ConfigureEvaluator` receives props like `selectedVariant`, `setSelectedVariant`, `selectedTestcase`, `setSelectedTestcase`, etc. These need to become atoms so both the standalone page and the drawer can use the same component.

**Why This Matters**: Without this refactor, we'd need to create wrapper components that bridge atoms to props, duplicating state management logic and making the code harder to maintain.

**Files to Create**:
- `web/oss/src/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator/state/atoms.ts`

**Files to Modify**:
- `web/oss/src/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator/index.tsx`
- `web/oss/src/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator/DebugSection.tsx`
- `web/oss/src/components/Evaluators/components/ConfigureEvaluator/index.tsx` (page wrapper)

**High-Level Solution**:

1. **Design Atoms** (create `state/atoms.ts`):

```typescript
// Core evaluator state
export const playgroundEvaluatorAtom = atom<Evaluator | null>(null)
export const playgroundEditModeAtom = atom(false)
export const playgroundEditValuesAtom = atom<EvaluatorConfig | null>(null)
export const playgroundCloneModeAtom = atom(false)

// Form state - needs to be shared between config and test panels
export const playgroundFormRefAtom = atom<FormInstance | null>(null)

// Test section state
export const playgroundSelectedTestcaseAtom = atom<{testcase: Record<string, any> | null}>({
    testcase: null,
})
export const playgroundSelectedVariantAtom = atom<Variant | null>(null)
export const playgroundSelectedTestsetIdAtom = atom<string>("")
export const playgroundTraceTreeAtom = atom<{trace: Record<string, any> | string | null}>({
    trace: null,
})

// Reset atom - clears all state when leaving playground
export const resetPlaygroundStateAtom = atom(null, (get, set) => {
    set(playgroundEvaluatorAtom, null)
    set(playgroundEditModeAtom, false)
    set(playgroundEditValuesAtom, null)
    set(playgroundCloneModeAtom, false)
    set(playgroundFormRefAtom, null)
    set(playgroundSelectedTestcaseAtom, {testcase: null})
    set(playgroundSelectedVariantAtom, null)
    set(playgroundSelectedTestsetIdAtom, "")
    set(playgroundTraceTreeAtom, {trace: null})
})
```

2. **Refactor ConfigureEvaluator**:
   - Remove props that become atoms
   - Keep props that are truly external: `onSuccess`, `onCancel`/`onClose`, `appId`
   - Use `useAtom` / `useAtomValue` / `useSetAtom` for state
   - Add optional `containerClassName` prop for height flexibility

3. **Refactor DebugSection**:
   - Remove props: `selectedTestcase`, `setSelectedTestcase`, `selectedVariant`, `setSelectedVariant`, `traceTree`, `setTraceTree`, `selectedTestset`, `setSelectedTestset`, `form`
   - Keep props: `selectedEvaluator`, `debugEvaluator`
   - Read form from `playgroundFormRefAtom`

4. **Update ConfigureEvaluatorPage**:
   - Initialize atoms on mount (set evaluator, edit mode, etc.)
   - Reset atoms on unmount via `resetPlaygroundStateAtom`
   - Pass minimal props to ConfigureEvaluator

**Acceptance Criteria**:
- ConfigureEvaluator works identically on the standalone page
- Props reduced from 18 to ~3-4 (onSuccess, onClose, appId, containerClassName)
- DebugSection props reduced from 13 to ~2 (selectedEvaluator, debugEvaluator)
- All state managed via atoms
- No regressions in existing functionality

---

### Checkpoint 3: Create Evaluator Drawer Component

**Goal**: Build the drawer shell that will host the evaluator playground.

**Context**: This drawer opens when user selects an evaluator type from the dropdown. It uses `GenericDrawer` which already supports expand/collapse via Splitter panels.

**Files to Create**:
- `web/oss/src/components/pages/evaluations/NewEvaluation/Components/CreateEvaluatorDrawer/index.tsx`
- `web/oss/src/components/pages/evaluations/NewEvaluation/Components/CreateEvaluatorDrawer/types.ts`
- `web/oss/src/components/pages/evaluations/NewEvaluation/state/createEvaluatorDrawer.ts`

**High-Level Solution**:

1. **Create drawer atoms** (`state/createEvaluatorDrawer.ts`):

```typescript
import {atom} from "jotai"
import {atomWithReset, RESET} from "jotai/utils"

interface CreateEvaluatorDrawerState {
    isOpen: boolean
    isExpanded: boolean
}

export const createEvaluatorDrawerAtom = atomWithReset<CreateEvaluatorDrawerState>({
    isOpen: false,
    isExpanded: false,
})

// Callback stored separately to avoid serialization issues
export const onEvaluatorCreatedCallbackAtom = atom<((configId: string) => void) | null>(null)

// Action atoms
export const openCreateEvaluatorDrawerAtom = atom(
    null,
    (get, set, payload: {evaluator: Evaluator; onCreated?: (id: string) => void}) => {
        // Initialize playground atoms
        set(playgroundEvaluatorAtom, payload.evaluator)
        set(playgroundEditModeAtom, false)
        set(playgroundEditValuesAtom, null)
        set(onEvaluatorCreatedCallbackAtom, payload.onCreated ?? null)

        // Open drawer
        set(createEvaluatorDrawerAtom, {isOpen: true, isExpanded: false})
    }
)

export const closeCreateEvaluatorDrawerAtom = atom(null, (get, set) => {
    set(createEvaluatorDrawerAtom, RESET)
    set(resetPlaygroundStateAtom) // Clean up playground state
    set(onEvaluatorCreatedCallbackAtom, null)
})

export const toggleDrawerExpandedAtom = atom(null, (get, set) => {
    const current = get(createEvaluatorDrawerAtom)
    set(createEvaluatorDrawerAtom, {...current, isExpanded: !current.isExpanded})
})
```

2. **Create drawer component**:
   - Use `GenericDrawer` with `expandable` prop
   - `mainContent`: Renders refactored `ConfigureEvaluator` (just the left config panel)
   - `extraContent`: When expanded, renders `DebugSection` (test panel)
   - Handle commit callback: refetch evaluator configs, call `onEvaluatorCreated`, close drawer

**Acceptance Criteria**:
- Drawer opens/closes correctly
- Expand/collapse toggles test section visibility
- Drawer state managed via atoms
- Drawer can be opened from SelectEvaluatorSection (integration in Checkpoint 5)

---

### Checkpoint 4: Integrate ConfigureEvaluator into Drawer

**Goal**: Render the refactored ConfigureEvaluator inside the drawer.

**Context**: After Checkpoint 2, ConfigureEvaluator uses atoms. Now we render it inside the drawer, adapting layout for drawer context.

**Files to Modify**:
- `web/oss/src/components/pages/evaluations/NewEvaluation/Components/CreateEvaluatorDrawer/index.tsx`

**High-Level Solution**:

1. The drawer's `mainContent` renders ConfigureEvaluator with:
   - `containerClassName="h-full"` (override the `h-[calc(100vh-84px)]`)
   - `onSuccess` callback that triggers commit flow
   - `onClose` callback that closes drawer

2. The drawer's `extraContent` (when expanded) renders DebugSection:
   - Reads evaluator from `playgroundEvaluatorAtom`
   - All other state comes from atoms

3. Handle the commit flow:
   ```typescript
   const handleCommit = async (configId: string) => {
       // Refresh evaluator configs list
       await queryClient.invalidateQueries({queryKey: ["evaluator-configs"]})

       // Call the callback to select new evaluator
       const onCreated = get(onEvaluatorCreatedCallbackAtom)
       onCreated?.(configId)

       // Close drawer
       set(closeCreateEvaluatorDrawerAtom)
   }
   ```

**Acceptance Criteria**:
- ConfigureEvaluator renders correctly in drawer
- Layout adapts to drawer dimensions
- Commit flow works: creates evaluator, refreshes list, calls callback, closes drawer
- Test section appears when drawer is expanded

---

### Checkpoint 5: Full Integration

**Goal**: Connect all pieces: dropdown → drawer → evaluator created → selected in modal.

**Files to Modify**:
- `web/oss/src/components/pages/evaluations/NewEvaluation/Components/SelectEvaluatorSection/SelectEvaluatorSection.tsx`
- `web/oss/src/components/pages/evaluations/NewEvaluation/Components/NewEvaluationModalInner.tsx`

**High-Level Solution**:

1. **Modify SelectEvaluatorSection**:
   ```typescript
   const openDrawer = useSetAtom(openCreateEvaluatorDrawerAtom)

   const handleSelectTemplate = (evaluator: Evaluator) => {
       openDrawer({
           evaluator,
           onCreated: (configId) => {
               setSelectedEvalConfigs(prev => [...prev, configId])
           }
       })
   }
   ```

2. **Render drawer in modal**:
   - Add `<CreateEvaluatorDrawer />` to `NewEvaluationModalInner`
   - Drawer reads its state from atoms, so no props needed

3. **Handle both evaluation types**:
   - Auto evaluation: Show dropdown with all evaluator types
   - Human evaluation: May show filtered dropdown or different UX

**Acceptance Criteria**:
- Full flow works: Create new → Select type → Configure → Commit → Evaluator selected
- Works for automatic evaluations
- Works for human evaluations
- No context lost during flow

---

### Checkpoint 6: Testing and Polish

**Goal**: Ensure feature works correctly and handles edge cases.

**Tasks**:
1. Test complete flow for automatic evaluation
2. Test complete flow for human evaluation
3. Test editing existing evaluator (if supported)
4. Test expand/collapse drawer functionality
5. Verify evaluator configs refresh after commit
6. Test error handling (failed commit, validation errors)
7. Ensure no regressions on standalone evaluator playground page
8. Run `pnpm lint-fix` and fix any issues

**Acceptance Criteria**:
- All flows work without errors
- No console warnings or errors
- Lint passes
- No regressions

---

## File Structure Summary

### New Files

```
web/oss/src/components/pages/evaluations/
├── NewEvaluation/
│   ├── Components/
│   │   ├── CreateEvaluatorDrawer/
│   │   │   ├── index.tsx
│   │   │   └── types.ts
│   │   └── SelectEvaluatorSection/
│   │       └── EvaluatorTemplateDropdown.tsx   (NEW)
│   └── state/
│       └── createEvaluatorDrawer.ts            (NEW)
└── autoEvaluation/
    └── EvaluatorsModal/
        └── ConfigureEvaluator/
            └── state/
                └── atoms.ts                     (NEW)
```

### Modified Files

```
web/oss/src/components/pages/evaluations/
├── NewEvaluation/
│   ├── Components/
│   │   ├── SelectEvaluatorSection/
│   │   │   └── SelectEvaluatorSection.tsx      (MODIFY)
│   │   └── NewEvaluationModalInner.tsx         (MODIFY)
└── autoEvaluation/
    └── EvaluatorsModal/
        └── ConfigureEvaluator/
            ├── index.tsx                        (MODIFY - refactor to atoms)
            └── DebugSection.tsx                 (MODIFY - refactor to atoms)

web/oss/src/components/Evaluators/
└── components/
    └── ConfigureEvaluator/
        └── index.tsx                            (MODIFY - use atoms)
```

---

## Important Considerations

### Following AGENTS.md

1. **State Management**: Use Jotai atoms to avoid prop drilling. See `AGENTS.md` section on "Avoiding Prop Drilling"

2. **Data Fetching**: Use `atomWithQuery` for any new data fetching needs. Avoid SWR for new code.

3. **Styling**: Use Tailwind CSS. Avoid CSS-in-JS unless necessary for complex Ant Design overrides.

4. **Component Architecture**:
   - High cohesion, low coupling
   - Components fetch their own data via atoms
   - Pass IDs, not entire data structures

5. **Import Aliases**: Use `@/oss/*` for shared utilities and state.

### Reusability Requirements

- **Auto vs Human Evaluation**: Both flows should use the same drawer and ConfigureEvaluator component
- **Page vs Drawer**: ConfigureEvaluator must work in both the standalone page and the drawer context
- **Template Selection**: The dropdown component should be reusable if needed elsewhere

### Performance

- Use `useMemo` for expensive computations in the dropdown filtering
- Avoid inline functions in render for list items
- Consider lazy loading the drawer content

---

## Questions to Resolve

1. **Human Evaluation UX**: Should human evaluation show the same dropdown, or a simplified flow since there may be fewer human evaluator types?

2. **Edit Mode**: Should the drawer support editing existing evaluators, or only creating new ones?

3. **Drawer Width**: What are the ideal widths for collapsed (config only) vs expanded (config + test) states?

4. **Form Persistence**: If user closes drawer without committing, should we save form state as draft?

---

## Success Metrics

1. Zero navigations away from evaluation modal during evaluator creation
2. ConfigureEvaluator prop count reduced from 18 to ≤4
3. DebugSection prop count reduced from 13 to ≤3
4. No regressions on standalone evaluator playground page
5. Full flow works for both auto and human evaluations
