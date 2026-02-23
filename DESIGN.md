# Playground Testset Sync - UI Design

## Testset Button States

### State 1: Connected to Local Testset (Default)

```
┌─────────────────────┐
│  ⊜ Testset    ▼    │    -> In the location of Testset we are going to display the selected testset name
└─────────────────────┘
        │
        ▼
┌──────────────────────────┐
│ 🔗 Connect testset       │  → Opens TestsetSelectionModal (load mode)
└──────────────────────────┘
```

### State 2: Connected to API-backed Testset

```
┌──────────────────────────┐
│  ⊜ <testset_name>   ▼   │
└──────────────────────────┘
        │
        ▼
┌──────────────────────────┐
│ <Testset_name>    #V     │  ← Name + version badge
│ Testcases:    1/100 sel  │  ← Selection count
├──────────────────────────┤
│ ↻ Sync changes           │  → Opens SyncTestsetModal (disabled when no changes)
├──────────────────────────┤
│ ☰ Manage testcases       │  → Opens TestsetSelectionModal (edit mode) — add more from same testset (It should open with selected testset and testcases on that are selected, we can select testcases from another testset but that will not count as testset connect, adds testcases without changing connection)
├──────────────────────────┤
│ ⇄ Change testset         │  → Opens TestsetSelectionModal (load mode) — changes connected testset
├──────────────────────────┤
│ ⟲ Disconnect             │  (red) → Restores to local testset, preserves existing testcases
└──────────────────────────┘
```

---

## User Flow Diagram

```
┌─────────────────┐
│  Testset ▼      │
│  (Local)        │
└────────┬────────┘
         │
         │ Click "Connect testset"
         ▼
┌─────────────────────────────────────────────────────────┐
│                  TestsetSelectionModal (load mode)      │
│  ┌─────────────────┐  ┌───────────────────────────────┐ │
│  │ Testset List    │  │  Testcase Preview Table       │ │
│  │ <Testset name>  │  │  ☐ Country  | correct_answer  │ │
│  │ <Testset name>  │  │  ☐ Nauru    | The capital...  │ │
│  │ <Testset name>► │  │  ☑ Tuvalu   | The capital...  │ │
│  │ ...             │  │  ☐ Brunei   | The capital...  │ │
│  └─────────────────┘  └───────────────────────────────┘ │
│                                                         │
│  Create a new testset             [Cancel]  [Connect ▶] │
└─────────────────────────────────────────────────────────┘
         │
         │ Click "Connect"
         ▼
┌─────────────────────────────────────────────────────────┐
│  Playground with Connected Testset                      │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  ▼ ⊜ Test case 1                          [Run]  │   │
│  │  ┌─────────────────────────────────────────────┐ │   │
│  │  │ inputs                                      │ │   │
│  │  │ something                                   │ │   │
│  │  └─────────────────────────────────────────────┘ │   │
│  │  [+ Test case]                                   │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
         │
         │ User edits/adds/hides testcases
         ▼
┌─────────────────────────────────────────────────────────┐
│  Playground with Edited Testcases                     │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  ▼ ⊜ Test case 1  [Edited]              [Run]    │   │
│  │  ┌─────────────────────────────────────────────┐ │   │
│  │  │ inputs                                      │ │   │
│  │  │ It could be mark as Edited/hidden/new     │ │   │
│  │  └─────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  ▼ ⊜ Test case 2  [New]                   [Run]  │   │ -> Note: we should only display the new tag when we coonect api-served testset
│  │  ┌─────────────────────────────────────────────┐ │   │
│  │  │ inputs                                      │ │   │
│  │  │ Enter a value                               │ │   │
│  │  └─────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
         │
         │ Click "Sync changes"
         ▼
┌─────────────────────────────────────────────────────────┐
│  Commit Changes  (EntityCommitModal)                     │
│  ┌───────────────────────────────────────────────────┐  │
│  │  ● Commit changes      ○ Save as new testset      │  │
│  └───────────────────────────────────────────────────┘  │
│  Version v3 → v4  ·  3 Edited, 2 new, 1 hidden        │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Changes preview + diff view                      │  │
│  ├───────────────────────────────────────────────────┤  │
│  │  Commit message: [________________________]       │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  [Cancel]                                    [Commit ▶] │
└─────────────────────────────────────────────────────────┘
         │
         ├─── Mode: "Commit" → Sends diff as new revision
         │
         └─── Mode: "Save as new" → Shows name input, creates new testset
```

---

## Menu Actions Detail

### "Connect testset"
1. Opens `TestsetSelectionModal` in `load` mode
2. User selects testset and testcases
3. Click "Connect" → connects and loads testcases into playground rows
-> Make sure we are rendering the rows properly with selected number of testcases

### "Sync changes"
1. Triggers `useBoundCommit` — opens existing `EntityCommitModal`
2. Existing `revisionCommitContextAtom` computes changes summary and diff view
3. User enters commit message and confirms
4. Existing `loadableController.actions.commitChanges` handles the commit (sends diff as new revision)

### "Manage testcases"
1. Opens `TestsetSelectionModal` in `edit` mode
2. Opens with the currently connected testset pre-selected and its selected testcases shown
3. User can browse other testsets and select testcases from them
4. Selected testcases from other testsets are appended to the playground as new rows
5. **Connection stays with the original testset** — testcases from other testsets are treated as "new" (not from the connected source)

### "Disconnect"
1. Shows confirmation dialog
2. On confirm:
   - Restores connection to local testset
   - Preserves existing testcases in playground
   - Button reverts to "Testset" (local state)
   - Uses `playgroundController.actions.disconnectAndResetToLocal`

### "Change testset"
1. Opens `TestsetSelectionModal` in `load` mode
2. User selects new testset to connect
3. On confirm → changes connected testset (replaces previous connection)

---

## Sync State Tags on Rows

| State | Tag | Color | When Shown |
|-------|-----|-------|------------|
| **Edited** | "Edited" | `blue` | Testcase cell edited after connecting |
| **New** | "New" | `green` | Testcase added from playground (not from testset) |
| **Hidden** | (not shown on row) | — | Row hidden from UI, shown in sync modal as "to be removed" |
| **Unedited** | (no tag) | — | No changes since connecting |

**Notes:**
- Hidden testcases don't show a tag on the row (they're removed from display via `hiddenTestcaseIds`), but they appear as "Hidden" in the sync modal
- Output-mapped values do NOT trigger sync state tags — they are visual previews only, snapshot at commit time
- Tags use the `SyncStateTag` presentational component from `@agenta/ui`
- **Edited** tag shows a `×` close icon on hover (via `dismissible` prop) — clicking it discards changes for that testcase via `testcaseMolecule.actions.discard(id)`

---

## UI Components

### 1. SyncStateTag Component (Presentational)

**Package:** `@agenta/ui`

**Purpose:** Display sync state as colored Ant Design Tag — pure presentational, no entity dependencies

```tsx
interface SyncStateTagProps {
    syncState: 'Unedited' | 'Edited' | 'new' | 'hidden'
    /** When true, shows a close (×) icon on hover for discarding changes. Only relevant for 'Edited' state. */
    dismissible?: boolean
    /** Callback when the close icon is clicked. */
    onDismiss?: () => void
}
```

**Discard UX for Edited testcases:**
```
Default state:           Hover state (when dismissible=true):
┌──────────┐             ┌──────────┬───┐
│  Edited  │             │  Edited  │ × │   ← tooltip: "Discard changes"
└──────────┘             └──────────┴───┘
```

- The `×` close icon is **hidden by default** and only appears on hover
- Only enabled via `dismissible={true}` — caller controls when discard is available
- `onDismiss` calls `testcaseMolecule.actions.discard(id)` at the caller level
- Only applies to `Edited` state — `new` and `hidden` states don't show close icon

**Usage:** Caller derives `syncState` from entity selectors, passes it as a prop, and optionally enables discard.

---

### 2. Commit / Save As New — Extending EntityCommitModal

**Package:** `@agenta/entity-ui` (extend, not the legacy `CommitTestsetModal` from `oss/src/`)

> **Important:** The testset page's `CommitTestsetModal` (`oss/src/components/TestcasesTableNew/`) is a legacy standalone component using raw `antd Modal`. Do NOT reuse it. Use `EntityCommitModal` from `@agenta/entity-ui` instead — it's entity-aware and has extension points.

`EntityCommitModal` already provides version info, changes summary, diff view, commit message, and error/loading states. It also has a `commitModes` prop for radio toggles and `renderModeContent` for injecting custom content.

**Extension needed:** Add "Save as new testset" mode with a name input:

```
┌─────────────────────────────────────────────────────────┐
│  Commit Changes                                          │
│  ┌───────────────────────────────────────────────────┐  │
│  │  ● Commit changes      ○ Save as new testset      │  │  ← commitModes radio
│  └───────────────────────────────────────────────────┘  │
│                                                          │
│  --- When "Commit" selected: ---                         │
│  Version v1 → v2  ·  1 Edited                         │
│  [Changes preview + diff view]                           │
│  Commit message: [________________________]              │
│                                                          │
│  --- When "Save as new" selected: ---                    │
│  Testset name: [________________________]                │
│  (no diff view, no version info)                         │
│                                                          │
│  [Cancel]                         [Commit ▶ / Save ▶]   │
└─────────────────────────────────────────────────────────┘
```

**Extension points used:**
- `commitModes` — Radio: "Commit changes" / "Save as new testset"
- `renderModeContent` — When "Save as new" is selected, renders a testset name input
- `onSubmit` — Routes to `commitChanges` or `saveAsNewTestset` based on selected mode
- `submitLabel` — Dynamic: "Commit" or "Save" based on mode

**Wiring:** "Sync changes" menu item triggers `useBoundCommit` → opens `EntityCommitModal` with the above props.

---

### 3. TestsetSelectionModal Modes

**Package:** `@agenta/playground-ui` (already exists on main branch — entity-aware)

> **Important:** Use `TestsetSelectionModal` from `@agenta/playground-ui` — it uses entity-layer atoms (`testcaseMolecule.atoms.selectionDraft`), supports `TestsetImportMode` (`replace`/`import`), and takes `loadableId` as a prop.

Already supports `load`, `edit`, `save` modes. No new modal needed — reuse with appropriate mode:

| Action | Mode | Notes |
|--------|------|-------|
| Connect testset | `load` | Full testset selection + testcase preview (only available when on local testset) |
| Change testset | `load` | Same as connect (available when already connected — replaces current connection) |
| Manage testcases | `edit` | Opens with currently connected testset + selected testcases shown. User can browse other testsets and select testcases from them — those testcases are added to the playground but the **connection stays with the original testset**. Only the connected testset is used for commit. |

---

---

## State Dependencies

All state lives in packages — no new atoms in `oss/src/state/`.

| UI Component | Reads From | Writes To |
|--------------|------------|-----------|
| Testset dropdown button | `playgroundController.selectors.connectedTestset`, `loadableController.selectors.hasLocalChanges` | — |
| `SyncStateTag` | Pure prop `syncState` (caller derives inline from `isDirty`, `newIds`, `hiddenTestcaseIds`) | — |
| `EntityCommitModal` (sync) | Existing `revisionCommitContextAtom` via adapter | `loadableController.actions.commitChanges` (via `useBoundCommit`) |
| `TestsetSelectionModal` | `loadableController.selectors.displayRowIds` | `loadableController.actions.importRows` |
| Row header (`SingleLayout`) | `testcaseMolecule.atoms.isDirty`, `newIds`, `hiddenTestcaseIds` (via `renderSyncStateTag` slot) | `testcaseMolecule.actions.discard` (via SyncStateTag dismiss) |

---

## Implementation Order

Follows PLAN-2.md phases:

### Phase 1: Fix Blockers
1. **Fix** `commitChanges`: Before commit, move hidden testcase IDs to `testcaseMolecule.deletedIds` so they appear in `TestsetRevisionDelta.deleted`
2. **Fix** `saveAsNewTestset`: Extend to save all current data (new + Edited + Unedited), not just `newIds`

### Phase 2: UI Components + Wiring
- `SyncStateTag` in `@agenta/ui` (presentational, with `dismissible` prop)
- Add `renderSyncStateTag` slot to `PlaygroundUIProviders` context
- Wire `SyncStateTag` into `SingleLayout.tsx` row headers (sync state derived inline from existing atoms)
- Add testset dropdown menu items (Sync changes, Manage testcases, Change testset, Disconnect)
- Wire "Sync changes" via `useBoundCommit` — opens existing `EntityCommitModal`

### Phase 3: URL State Integration
- Extend playground URL snapshot schema (v2) to include loadable reference (connected testset ID, revision, name)
- Follow existing app revision URL snapshot pattern in `@agenta/playground`
- Support deeplinking for local entities

---

## Out of Scope

### Column Mismatch Warning
- Adapt the existing column-vs-inputPorts comparison logic into `TestsetSelectionModal` in `@agenta/playground-ui`
- During testset connection, compare testset columns against app's `inputPorts` and warn the user about mismatches
- Missing columns (app expects but testset doesn't have) → empty values
- Extra columns (testset has but app doesn't expect) → ignored


n - 01