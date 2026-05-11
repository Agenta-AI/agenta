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

## Progress Summary

### ✅ Checkpoint 2: COMPLETED - Refactor Evaluator Playground to Use Atoms

**Status**: Fully implemented and tested.

**What was done**:

1. **Created atoms** (`web/oss/src/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator/state/atoms.ts`):
   - `playgroundSessionAtom` - Unique session ID for cache invalidation
   - `playgroundEvaluatorAtom` - Current evaluator template
   - `playgroundIsEditModeAtom` - Edit vs create mode
   - `playgroundIsCloneModeAtom` - Clone mode flag
   - `playgroundEditValuesAtom` - Existing config being edited
   - `playgroundFormRefAtom` - Form instance reference
   - `playgroundSelectedVariantAtom` - Variant for testing
   - `playgroundSelectedTestsetIdAtom` - Testset ID
   - `playgroundSelectedTestcaseAtom` - Testcase for testing
   - `playgroundTraceTreeAtom` - Trace output from variant run
   - `initPlaygroundAtom` - Action to initialize all state
   - `resetPlaygroundAtom` - Action to clear all state
   - `commitPlaygroundAtom` - Action to save and update state

2. **Refactored ConfigureEvaluator** (`index.tsx`):
   - **Before**: 18+ props
   - **After**: 3 props (`onClose`, `onSuccess`, `containerClassName`)
   - Reads all state from atoms
   - Removed debug console.logs
   - Removed `@ts-nocheck`

3. **Refactored DebugSection** (`DebugSection.tsx`):
   - **Before**: 3 props (`testsets`, `variants`, `debugEvaluator`)
   - **After**: 0 props - fully self-sufficient
   - Fetches testsets via `useTestsetsData()`
   - Fetches variants via `useAppVariantRevisions(defaultAppId)`
   - Reads/writes state from atoms
   - Removed debug console.logs
   - Removed `@ts-nocheck`
   - Fixed Ant Design `Dropdown.Button` deprecation - now uses `Space.Compact` + `Dropdown` + `Button`

4. **Updated EvaluatorsModal** (`EvaluatorsModal.tsx`):
   - Removed unused state: `selectedTestcase`, `selectedVariant`, `selectedTestset`
   - Removed unused imports: `groupVariantsByParent`, `useStatelessVariants`, `Variant`, `useTestsetsData`
   - Added `initPlaygroundAtom` and `resetPlaygroundAtom` for atom lifecycle
   - Initializes atoms when evaluator is selected
   - Resets atoms when modal closes
   - Removed `@ts-nocheck`

5. **Updated ConfigureEvaluatorPage** (`web/oss/src/components/Evaluators/components/ConfigureEvaluator/index.tsx`):
   - Simplified to only pass `onClose` and `onSuccess` to ConfigureEvaluator

**Key Architecture Decisions**:

1. **Singleton atoms**: Only one evaluator playground can be active at a time (page OR drawer, not both)
2. **Self-sufficient DebugSection**: Fetches its own data, making it reusable in any context
3. **initPlaygroundAtom pattern**: Supports both modal and page contexts with different initialization params:
   ```typescript
   // From modal (EvaluatorsModal)
   initPlayground({
       evaluator: selectedEvaluator,
       editMode,
       cloneMode: cloneConfig,
       editValues: editEvalEditValues,
   })

   // From page (ConfigureEvaluatorPage)
   initPlayground({
       evaluator: evaluator as Evaluator,
       existingConfig: existingConfig ?? undefined,
       mode: existingConfig ? "edit" : "create",
   })
   ```

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

### Evaluator Playground Components (REFACTORED ✅)

| File | Purpose | Props (After Refactor) |
|------|---------|------------------------|
| `web/oss/src/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator/index.tsx` | Main playground component | 3 props: `onClose`, `onSuccess`, `containerClassName?` |
| `web/oss/src/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator/DebugSection.tsx` | Test evaluator section | 0 props - self-sufficient |
| `web/oss/src/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator/state/atoms.ts` | **NEW** - Jotai atoms for playground state | N/A |
| `web/oss/src/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator/DynamicFormField.tsx` | Form field renderer | - |
| `web/oss/src/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator/AdvancedSettings.tsx` | Collapsed advanced settings | - |
| `web/oss/src/components/Evaluators/components/ConfigureEvaluator/index.tsx` | Page wrapper for playground | - |

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
| `web/oss/src/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator/state/atoms.ts` | **NEW** - Playground atoms |
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

### State Architecture (IMPLEMENTED ✅)

```
┌─────────────────────────────────────────────────────────────┐
│                  Evaluator Playground Atoms                  │
│     (web/oss/.../ConfigureEvaluator/state/atoms.ts)         │
├─────────────────────────────────────────────────────────────┤
│ Core State (atomWithReset for easy cleanup):                │
│   playgroundSessionAtom         - Session ID for invalidate │
│   playgroundEvaluatorAtom       - Current evaluator template│
│   playgroundIsEditModeAtom      - Edit vs create mode       │
│   playgroundIsCloneModeAtom     - Clone mode flag           │
│   playgroundEditValuesAtom      - Existing config values    │
│   playgroundFormRefAtom         - Form instance reference   │
│                                                             │
│ Test Section State:                                         │
│   playgroundSelectedVariantAtom - Variant for testing       │
│   playgroundSelectedTestsetIdAtom - Testset ID              │
│   playgroundSelectedTestcaseAtom - Testcase for testing     │
│   playgroundTraceTreeAtom       - Trace output from variant │
│                                                             │
│ Action Atoms:                                               │
│   initPlaygroundAtom            - Initialize all state      │
│   resetPlaygroundAtom           - Clear all state           │
│   commitPlaygroundAtom          - Save and update state     │
│                                                             │
│ Data Fetching (internal to DebugSection):                   │
│   useTestsetsData()             - Available testsets        │
│   useAppVariantRevisions()      - Available variants        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                  Drawer-Specific Atoms                       │
│                  (TO BE CREATED - Checkpoint 3)             │
├─────────────────────────────────────────────────────────────┤
│   createEvaluatorDrawerAtom     - {isOpen, isExpanded, ...} │
│   onEvaluatorCreatedAtom        - Callback when committed   │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Tasks

### Checkpoint 1: Evaluator Template Dropdown in Modal

**Goal**: Add dropdown to select evaluator type when clicking "Create new" in SelectEvaluatorSection.

**Status**: Not started

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

### ✅ Checkpoint 2: Refactor Evaluator Playground to Use Atoms (COMPLETED)

**Goal**: Replace the 18+ props in ConfigureEvaluator and 13 props in DebugSection with Jotai atoms.

**Status**: ✅ COMPLETED

**What was implemented**:

1. **Created atoms** (`state/atoms.ts`) with:
   - All core state atoms using `atomWithReset` for easy cleanup
   - Action atoms: `initPlaygroundAtom`, `resetPlaygroundAtom`, `commitPlaygroundAtom`

2. **Refactored ConfigureEvaluator**:
   - Props reduced from 18 to 3 (`onClose`, `onSuccess`, `containerClassName?`)
   - Reads all state from atoms
   - Removed `@ts-nocheck`

3. **Refactored DebugSection**:
   - Props reduced from 3 to 0 - fully self-sufficient
   - Fetches testsets via `useTestsetsData()`
   - Fetches variants via `useAppVariantRevisions()`
   - Fixed Ant Design deprecation: replaced `Dropdown.Button` with `Space.Compact` + `Dropdown` + `Button`
   - Removed `@ts-nocheck`

4. **Updated EvaluatorsModal**:
   - Uses `initPlaygroundAtom` to initialize state when evaluator selected
   - Uses `resetPlaygroundAtom` to clean up when modal closes
   - Removed unused state variables
   - Removed `@ts-nocheck`

5. **Updated ConfigureEvaluatorPage**:
   - Simplified props to just `onClose` and `onSuccess`

**Files Changed**:
- `web/oss/src/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator/state/atoms.ts` (CREATED)
- `web/oss/src/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator/index.tsx` (MODIFIED)
- `web/oss/src/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator/DebugSection.tsx` (MODIFIED)
- `web/oss/src/components/pages/evaluations/autoEvaluation/EvaluatorsModal/EvaluatorsModal.tsx` (MODIFIED)
- `web/oss/src/components/Evaluators/components/ConfigureEvaluator/index.tsx` (MODIFIED)

**Verification**:
- `pnpm lint-fix` passes with only pre-existing warnings
- No TypeScript errors in modified files
- Tested: Evaluator playground works on standalone page

---

### Checkpoint 3: Create Evaluator Drawer Component

**Goal**: Build the drawer shell that will host the evaluator playground.

**Status**: Not started

**Context**: This drawer opens when user selects an evaluator type from the dropdown. It uses `GenericDrawer` which already supports expand/collapse via Splitter panels.

**Important**: The playground atoms are already created (Checkpoint 2). The drawer just needs to:
1. Call `initPlaygroundAtom` when opening with the selected evaluator
2. Render `ConfigureEvaluator` (which reads from atoms)
3. Call `resetPlaygroundAtom` when closing

**Files to Create**:
- `web/oss/src/components/pages/evaluations/NewEvaluation/Components/CreateEvaluatorDrawer/index.tsx`
- `web/oss/src/components/pages/evaluations/NewEvaluation/Components/CreateEvaluatorDrawer/types.ts`
- `web/oss/src/components/pages/evaluations/NewEvaluation/state/createEvaluatorDrawer.ts`

**High-Level Solution**:

1. **Create drawer atoms** (`state/createEvaluatorDrawer.ts`):

```typescript
import {atom} from "jotai"
import {atomWithReset, RESET} from "jotai/utils"
import {
    initPlaygroundAtom,
    resetPlaygroundAtom,
    playgroundEvaluatorAtom,
} from "@/oss/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator/state/atoms"

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
        set(initPlaygroundAtom, {
            evaluator: payload.evaluator,
            editMode: false,
            cloneMode: false,
            editValues: null,
        })
        set(onEvaluatorCreatedCallbackAtom, payload.onCreated ?? null)

        // Open drawer
        set(createEvaluatorDrawerAtom, {isOpen: true, isExpanded: false})
    }
)

export const closeCreateEvaluatorDrawerAtom = atom(null, (get, set) => {
    set(createEvaluatorDrawerAtom, RESET)
    set(resetPlaygroundAtom) // Clean up playground state
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

**Status**: Not started (depends on Checkpoint 3)

**Context**: After Checkpoint 2, ConfigureEvaluator uses atoms. Now we render it inside the drawer, adapting layout for drawer context.

**Files to Modify**:
- `web/oss/src/components/pages/evaluations/NewEvaluation/Components/CreateEvaluatorDrawer/index.tsx`

**High-Level Solution**:

1. The drawer's `mainContent` renders ConfigureEvaluator with:
   - `containerClassName="h-full"` (override the `h-[calc(100vh-84px)]`)
   - `onSuccess` callback that triggers commit flow
   - `onClose` callback that closes drawer

2. The drawer's `extraContent` (when expanded) renders DebugSection:
   - No props needed - reads from atoms
   - All state managed via atoms

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

**Status**: Not started (depends on Checkpoints 1, 3, 4)

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

**Status**: Not started (depends on Checkpoint 5)

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
                └── atoms.ts                     (CREATED ✅)
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
        ├── EvaluatorsModal.tsx                  (MODIFIED ✅)
        └── ConfigureEvaluator/
            ├── index.tsx                        (MODIFIED ✅)
            └── DebugSection.tsx                 (MODIFIED ✅)

web/oss/src/components/Evaluators/
└── components/
    └── ConfigureEvaluator/
        └── index.tsx                            (MODIFIED ✅)
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
- **Page vs Drawer**: ConfigureEvaluator must work in both the standalone page and the drawer context ✅
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

1. ✅ ConfigureEvaluator prop count reduced from 18 to 3
2. ✅ DebugSection prop count reduced from 13 to 0
3. ✅ No regressions on standalone evaluator playground page
4. ⏳ Zero navigations away from evaluation modal during evaluator creation
5. ⏳ Full flow works for both auto and human evaluations
