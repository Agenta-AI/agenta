# Playground Testset Sync Feature - Implementation Plan

## Overview

Enable bidirectional sync between Playground and Test Sets with explicit user confirmation and diff view.

---

## Key Architectural Principles

### 1. Always Connected to a Testset
- Playground is **always** connected to either a **local testset** or an **API-backed testset**
- When user "disconnects" from API-backed testset, connection restores to local testset

### 2. Testcases Are Never Removed
- Testcases are **hidden** (filtered from `displayRowIds`), not deleted from loadable
- The `hiddenTestcaseIds` mechanism already exists in loadableController
- "Delete row" → hide from display, but data remains in testcaseMolecule
- Sync modal shows hidden testcases as "to be removed" from synced testset

### 3. No New Atoms/UIs in OSS Layer — Use Packages Only
- ❌ DO NOT create `oss/src/state/playground/syncTestset.ts`
- ❌ DO NOT use legacy OSS playground components
- ✅ Use `TestsetSelectionModal` from `@agenta/playground-ui` (entity-aware, supports `load`, `edit`, `save` modes)
- ✅ Extend existing APIs in `@agenta/entities` and `@agenta/playground` packages if required
- All new UI components go in packages (`@agenta/ui`, `@agenta/playground-ui`), not in `oss/src/`

### 4. Shared Components in Packages
- `@agenta/ui` - presentational components (SyncStateTag)
- `@agenta/entity-ui` - components with entity APIs (entity-aware modals)
- Components should be reusable across OSS/EE

### 5. Avoid React Side Effects
- State coordination via **reducers**, not UI-triggered effects
- Goal: playground should be runnable without UI
- Leads to less flaky interactions

### 6. Commit vs SaveNew Are Different Flows
- **Commit**: Sends a **diff** (only changed/new/hidden rows) to create a new revision of the connected testset
- **SaveNew**: Creates entirely new testset with all current data

### 7. Output Mappings Don't Dirty Testcases
- Running executions and applying output mappings should **NOT** mark testcases as dirty
- Output values are displayed as a visual preview only — they don't create drafts
- When the user explicitly commits/syncs, the applied output-mapped values are **snapshot at commit time** and included in the commit diff
- This prevents confusing "unsaved changes" indicators from appearing just because the user ran executions
- Note: This preserves feature parity with production's "add to testset" action which saves output responses

### 8. Manage Testcases Can Add From Other Testsets
- "Manage testcases" opens with the currently connected testset and its selected testcases
- User can browse other testsets and select testcases from them
- Selected testcases from other testsets are appended to the playground as new rows
- **Connection stays with the original testset** — testcases from other testsets are treated as "new" (not from the connected source)
- To switch connected testsets, user must use "Change testset" (which opens `TestsetSelectionModal` in `load` mode)

### 9. URL State Must Include Loadable Reference
- Playground URL state should contain the loadable reference (connected testset info)
- Follow the same pattern as URL snapshots implemented for app revisions
- For local entities, include enough info to recreate the entity from URL state (deeplinking)
- Reference: existing URL snapshot implementation for app revisions in `@agenta/playground`

---

## MVP User Flow

```
1. User connects to testset (always connected to local by default)
2. User modifies testcases (edit, add, hide)
3. User clicks "Sync changes" button
4. System shows Sync Modal with table of all changes
5. User can deselect rows in the table to exclude from sync
6. User chooses:
   a) "Commit Changes" → new revision of connected testset (sends diff: only changed/new/hidden rows, including output-mapped values)
   b) "Save as New" → creates new testset with current data
```

---

## Existing Infrastructure (Use, Don't Duplicate)

### Already Implemented in Packages

| Feature | Location | Notes |
|---------|----------|-------|
| **TestsetSelectionModal** | `@agenta/playground-ui` | Supports `load`, `edit`, `save` modes |
| **Import/Replace modes** | `TestsetImportMode` type | `replace` = connect, `import` = add to local |
| **Selection draft** | `testcase.actions.initSelectionDraft`, etc. | Entity-layer selection state |
| **Connect to testset** | `playgroundController.actions.connectToTestset` | Compound action |
| **Disconnect & reset** | `playgroundController.actions.disconnectAndResetToLocal` | Restores local testset |
| **Commit changes** | `loadableController.actions.commitChanges` | Commits to connected revision |
| **Save as new** | `loadableController.actions.saveAsNewTestset` | Creates new testset |
| **Discard changes** | `loadableController.actions.discardChanges` | Reverts to server data |
| **Has local changes** | `loadableController.selectors.hasLocalChanges` | Dirty detection |
| **Hidden testcase IDs** | `loadableState.hiddenTestcaseIds` | UI-only filter |
| **useBoundCommit hook** | `@agenta/entity-ui` | Opens commit modal |
| **useTestsetHandlers** | `@agenta/playground-ui` | Handles all testset operations |

### Key Selectors Already Available

```typescript
// From loadableController.selectors
loadableController.selectors.hasLocalChanges(loadableId)  // boolean
loadableController.selectors.displayRowIds(loadableId)    // visible IDs only
loadableController.selectors.allRowsIncludingHidden(loadableId) // all IDs
loadableController.selectors.newColumnKeys(loadableId)    // newly added columns

// From testcaseMolecule
testcaseMolecule.atoms.displayRowIds          // all display IDs
testcaseMolecule.atoms.newIds                 // IDs starting with "new-"
testcaseMolecule.atoms.deletedIds             // soft-deleted IDs
testcaseMolecule.selectors.serverData(id)     // original server data
testcaseMolecule.data(id)                     // merged data (server + draft)
testcaseMolecule.atoms.isDirty(id)            // has local changes
```

---

## What Needs to Be Added/Extended

### 1. Bug Fixes in Loadable Controller

**Location:** `@agenta/entities/loadable` (in `controller.ts`)

These are fixes to existing actions, not new abstractions:

- **`commitChanges`**: Before commit, move hidden testcase IDs from `hiddenTestcaseIds` to `testcaseMolecule.deletedIds` (soft-delete). The existing `saveTestsetAtom` already handles `deletedEntityIds` in its `TestsetRevisionDelta.deleted` field.
- **`saveAsNewTestset`**: Extend to collect all visible testcases (new + modified + unmodified), not just `newIds`.

### 2. SyncStateTag Component

**Location:** `@agenta/ui` (presentational)

```tsx
interface SyncStateTagProps {
  syncState: 'unmodified' | 'modified' | 'new' | 'hidden'
}

// Simple tag that shows colored badge based on state
// No entity dependencies - pure presentational
```

### 3. Sync State Derivation (Inline, Not a Formal Selector)

Sync state per testcase is a simple inline derivation — no new selector needed:

```typescript
// Derive in the component that renders the tag:
const syncState = hiddenTestcaseIds.has(id)
  ? 'hidden'
  : newIds.has(id)
    ? 'new'
    : isDirty(id)
      ? 'modified'
      : 'unmodified'
```

Reads from existing atoms: `loadableState.hiddenTestcaseIds`, `testcaseMolecule.atoms.newIds`, `testcaseMolecule.atoms.isDirty(id)`.

### 4. Commit / Save As New — Extending EntityCommitModal

Use `EntityCommitModal` from `@agenta/entity-ui`. It already provides version info, changes summary, diff view, commit message, and error/loading states.

**Extension needed:** Add "Save as new testset" mode:
- `commitModes` — Radio: "Commit changes" / "Save as new testset"
- `renderModeContent` — When "Save as new" is selected, shows a testset name input (hides diff/version info)
- `onSubmit` — Routes to `commitChanges` or `saveAsNewTestset` based on selected mode
- `submitLabel` — Dynamic: "Commit" or "Save" based on mode

Wire via `useBoundCommit` from the "Sync changes" menu item.

---

## Implementation Blockers

These must be resolved before or during implementation:

### Blocker 1: `hiddenTestcaseIds` Are NOT Excluded From Commits

**Current behavior:** `commitChangesAtom` calls `saveTestsetAtom` which reads ALL testcase IDs — hidden rows are committed to the new revision. `hiddenTestcaseIds` is purely a UI display filter.

**Required behavior:** The sync modal shows hidden rows as "to be removed." The commit diff must exclude them.

**Fix:** Before commit, move hidden testcase IDs from `hiddenTestcaseIds` to `testcaseMolecule.deletedIds` (soft-delete). The existing `saveTestsetAtom` already handles `deletedEntityIds` in its `TestsetRevisionDelta.deleted` field.

### Blocker 2: `saveAsNewTestset` Only Saves New IDs

**Current behavior:** `saveAsNewTestsetAtom` only saves entities in `testcaseMolecule.newIds` — not modified server entities or unmodified ones.

**Required behavior:** "Save as New" should create a testset with ALL current data (new + modified + unmodified).

**Fix:** Extend `saveAsNewTestsetAtom` to collect all visible testcases (both new and server entities), not just `newIds`.

### Blocker 3: `SingleLayout` Needs SyncStateTag Injection Point

**Current behavior:** Row headers in `SingleLayout.tsx` (`@agenta/playground-ui`) have a `CollapsibleGroupHeader` with "Test case N" label, but no slot for a sync state tag.

**Fix options:**
- Add `renderSyncStateTag?: (props: {rowId: string, loadableId: string}) => ReactNode` slot to `PlaygroundUIProviders`. OSS layer implements the concrete component.

### Legacy Seam: Two Testset Connection Systems

The older `connectedTestsetAtom` (in `@agenta/playground` atoms) and the newer `loadableStateAtomFamily.connectedSourceId` (in `@agenta/entities/loadable`) track connections separately. **Use the loadable system exclusively.** The old atom is a legacy seam.

---

## Implementation Approach

### Phase 1: Fix Blockers + Extend EntityCommitModal

1. **Fix** `commitChanges`: Before commit, soft-delete hidden testcase IDs so they appear in `TestsetRevisionDelta.deleted`
2. **Fix** `saveAsNewTestset`: Extend to save all current data (new + modified + unmodified), not just `newIds`
3. **Extend** `EntityCommitModal`: Add "Save as new testset" mode via `commitModes` radio + `renderModeContent` (testset name input when save-as-new is selected) + `onSubmit` routing + dynamic `submitLabel`

### Phase 2: UI Components + Wiring

1. `SyncStateTag` in `@agenta/ui` (presentational, with `dismissible` prop for discard)
2. Add `renderSyncStateTag` slot to `PlaygroundUIProviders` context
3. Wire `SyncStateTag` into `SingleLayout.tsx` row headers via the new slot (sync state derived inline from existing atoms)
4. Add testset dropdown menu items (Sync changes, Manage testcases, Change testset, Disconnect)
5. Wire "Sync changes" via `useBoundCommit` — opens `EntityCommitModal` with `commitModes`, `renderModeContent`, `onSubmit`, `submitLabel`

### Phase 3: URL State Integration

1. Extend playground URL snapshot to include loadable reference (connected testset ID, revision, name)
2. Follow existing app revision URL snapshot pattern
3. Support deeplinking — for local entities, include enough info to recreate from URL state

---

## Files to Modify

| Package | File | Change |
|---------|------|--------|
| `@agenta/entities/loadable` | `controller.ts` | **Fix** `commitChanges`: soft-delete hidden IDs before commit |
| `@agenta/entities/loadable` | `controller.ts` | **Fix** `saveAsNewTestset`: save all data, not just `newIds` |
| `@agenta/entity-ui` | `modals/commit/components/EntityCommitModal.tsx` | **Extend** with `commitModes` support for "Save as new" mode (radio toggle, name input via `renderModeContent`, dynamic `submitLabel`) |
| `@agenta/ui` | `components/SyncStateTag/` | **NEW** - Presentational tag with `dismissible` prop |
| `@agenta/playground-ui` | `context/PlaygroundUIContext.tsx` | Add `renderSyncStateTag` slot to `PlaygroundUIProviders` |
| `@agenta/playground-ui` | `components/ExecutionItems/assets/ExecutionRow/SingleLayout.tsx` | Wire `SyncStateTag` into row header via provider slot |
| `@agenta/playground-ui` | Testset dropdown component | Add menu items (Sync changes, Manage testcases, Change testset, Disconnect) |
| `@agenta/playground` | `state/snapshot/snapshotSchema.ts` | Extend schema v2 with loadable reference |
| `@agenta/playground` | `state/snapshot/snapshotCodec.ts` | Serialize/deserialize loadable state |

---

## Reference: PlaygroundTest POC

**Location:** `web/oss/src/components/PlaygroundTest/index.tsx` (main branch)

Key patterns:
- Uses `EntitySelectorProvider` wrapper
- Injects OSS-specific components via `PlaygroundUIProvider`
- Dynamic imports for modals

---

## Out of Scope

### Column Mismatch Warning
- Adapt existing column-vs-inputPorts comparison logic into `TestsetSelectionModal` in `@agenta/playground-ui`
- Warn users when testset columns don't match the app's expected inputs during connection
