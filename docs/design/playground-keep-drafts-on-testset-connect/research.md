# Research

All paths relative to repo root. Line numbers as of 2026-06-09 on
`gitbutler/workspace`.

## 1. How a trace becomes playground rows

Entry point: the "Playground" button in the trace drawer.

- `web/oss/src/components/SharedDrawers/TraceDrawer/components/TraceContent/components/TraceTypeHeader/index.tsx`
  - Button at lines 220-231, handler `handleOpenInPlayground` at 130-189.
  - Writes `openTraceInPlaygroundAtom`
    (`web/oss/src/components/SharedDrawers/TraceDrawer/store/openInPlayground.ts:18-23`),
    which delegates to `playgroundController.actions.openFromTrace`.
  - If the trace resolves to an app revision, navigates to
    `/app/{appId}/playground?revisions={entityId}`.

Transformation: `openFromTraceAtom` in
`web/packages/agenta-playground/src/state/controllers/playgroundController.ts:1114-1651`.

- Extracts inputs/outputs/parameters from the span, resolves app or evaluator
  references, then inserts the row via
  `loadableController.actions.setRows(loadableId, [{id: "trace-input-0", data}])`
  (lines 1310, 1360, 1405, 1563 for the four span variants).

Important detail: `setRowsAtom`
(`web/packages/agenta-entities/src/loadable/controller.ts:747-768`) **ignores
the passed row id**. It deletes existing molecule entities and calls
`testcaseMolecule.actions.add({data})`, which assigns a fresh local id
(`new-...`). So trace-derived rows are plain local testcase entities,
indistinguishable from manually created rows. There is no "from trace" marker
in state. This matches the user's framing: the fix must treat trace rows and
manual rows identically.

After this flow the playground loadable is in **local mode**:
`loadableState.connectedSourceId == null`, `connectedTestsetAtom` holds
`{id: null, name: "<generated local name>"}`.

## 2. How "Connect test set" works and where rows get destroyed

UI: `web/oss/src/components/Playground/Components/TestsetDropdown/index.tsx`.

Menu when **not connected** (lines 457-474):

```ts
{key: "connect", label: "Connect test set", onClick: () => setSelectionModalMode("load")}
```

No guard of any kind. Compare the **connected** menu's "Change test set"
(`handleChangeTestset`, lines 367-385), which checks `hasLocalChanges` and
routes through `TestsetDisconnectConfirmModal` (Save & load / Discard & load /
Cancel) before opening the selection modal.

Selection modal: `TestsetSelectionModal` in
`web/packages/agenta-playground-ui/src/components/TestsetSelectionModal/`
("load" mode). On confirm, `handleLoadConfirm` (TestsetDropdown lines 245-277)
runs:

- `importMode === "import"` (only set in edit mode for a different revision):
  `playgroundController.actions.importTestcases` adds rows without touching
  the connection.
- Otherwise (the connect path): `playgroundController.actions.connectToTestset`.

`connectToTestsetAtom`
(`web/packages/agenta-playground/src/state/controllers/playgroundController.ts:535-597`)
normalizes rows, applies the chat single-row gate, then calls
`loadableController.actions.connectToSource`.

**The destruction happens here.** `connectToSourceAtom`
(`web/packages/agenta-entities/src/loadable/controller.ts:935-986`):

```ts
// Clear local entities before connecting to a new source
// This ensures Replace mode fully replaces existing data
set(clearNewEntityIdsAtom)
set(clearDeletedIdsAtom)
set(resetTestcaseIdsAtom)
```

Local draft rows (trace-derived or manual) are cleared, then the test set rows
are written into the query cache and draft atoms. Nothing captures the old
rows first.

## 3. Why the existing guard never fires

`hasLocalChanges` resolves to `connectedHasLocalChangesAtomFamily`
(`web/packages/agenta-entities/src/loadable/controller.ts:441-476`):

```ts
// Not connected - no "local changes" concept
if (!state.connectedSourceId) {
    return false
}
```

So in local mode the selector is `false` **by design**, regardless of how many
draft rows exist. Even if the not-connected menu item routed through
`handleChangeTestset`, the guard would not trigger. Two independent gaps:

1. The not-connected "Connect test set" path has no guard wiring.
2. The dirty-detection selector excludes local mode.

## 4. Building blocks that already implement the desired end state

The user's expected flow ("test set loaded, playground rows added on top as
temporary rows, then sync back") is already expressible with existing actions:

- `importRowsAtom`
  (`web/packages/agenta-entities/src/loadable/controller.ts:671-742`): adds
  testcases as **new local entities without changing the connection**. New
  entities land in `newEntityIdsAtom`.
- Once connected, any entries in `newEntityIdsAtom` make
  `hasLocalChanges === true` (controller.ts:451-455), which enables the
  "Sync changes" menu item (TestsetDropdown line 478-482).
- "Sync changes" opens `EntityCommitModal` and calls `commitChangesAtom`
  (controller.ts:1087-1177), which commits via `saveTestsetAtom`, creates a
  new revision including the new rows, and reconnects to it.

So `connect, then import the captured rows` produces exactly: test set rows +
previous playground rows as unsaved additions + working "Sync changes" path.
No new persistence logic is needed.

Playground-level wrapper: `importTestcasesAtom`
(`web/packages/agenta-playground/src/state/controllers/playgroundController.ts:608-632`)
adds the chat-message seeding on top of `importRows`. Reuse it rather than
calling the loadable action directly.

Capture before connect: row data is readable via
`loadableController.selectors.displayRowIds(loadableId)` plus
`testcaseMolecule.get.data(id)` (the same pattern `handleLoadConfirm` already
uses for the selected test set rows). Capture must happen **before**
`connectToSource` runs, because it clears the entities.

Existing modal to model after (or extend):
`web/oss/src/components/Playground/Components/Modals/TestsetDisconnectConfirmModal/index.tsx`
with its state atom at `.../store/state.ts` (intents: "disconnect",
"change-testset").

## 5. Caveats and edge cases

### a. Fresh playgrounds seed one empty row

`addPrimaryNodeAtom`
(`web/packages/agenta-playground/src/state/controllers/playgroundController.ts:186-238`)
links the loadable and creates an initial empty row (unless
`skipInitialRow`). A naive "any local rows exist" check would prompt every
first-time connect. The detection must be "at least one local row whose data
contains a non-empty value" (trim strings, ignore system fields). Call this
`hasMeaningfulLocalRows` below.

### b. Chat mode single-row gate

`connectToTestsetAtom` (lines 553-568) and `importTestcasesAtom` (lines
613-617) both slice to one row in chat mode, deliberately (QA decision
2026-06-01, documented in the code). "Keep and add" in chat mode would either
exceed the gate or silently drop rows. v1 decision: skip the prompt in chat
mode and keep today's replace behavior there.

### c. Column mismatch between draft rows and the test set

A trace row's input keys may differ from the test set's columns. Imported
rows keep their own keys; the connected view filters columns at the view layer
(`connectedRowsAtomFamily`, see comment at controller.ts:922-924) and
`newColumnKeysAtomFamily` (controller.ts:486-520) marks columns "(new)". The
selection modal already surfaces compatibility warnings
(`SelectionSummary.tsx`). Behavior is acceptable for v1: mismatched keys show
as new columns and commit as such. Worth one manual QA pass with a trace whose
inputs do not match the test set schema.

### d. Where the prompt can hook in

`handleLoadConfirm` (TestsetDropdown lines 245-277) is the single funnel for
the connect decision in load mode. The "Create & Load" path
(`handleCreateAndLoad`, lines 309-348) also calls `connectToTestset` and
clears rows the same way; it creates an **empty** test set, so "keep" arguably
matters even more there (otherwise Create & Load from a trace produces an
empty playground). Include it.

### e. `TestsetSelectionPayload.importMode === "import"`

The import branch in `handleLoadConfirm` does not destroy rows, so the prompt
must only wrap the connect branch.

## 6. Reference: file map

| Concern | File | Lines |
|---|---|---|
| Trace drawer button | `web/oss/src/components/SharedDrawers/TraceDrawer/components/TraceContent/components/TraceTypeHeader/index.tsx` | 130-189, 220-231 |
| Trace transform | `web/packages/agenta-playground/src/state/controllers/playgroundController.ts` | 1114-1651 |
| Row clearing on connect | `web/packages/agenta-entities/src/loadable/controller.ts` | 935-986 |
| setRows (id not preserved) | `web/packages/agenta-entities/src/loadable/controller.ts` | 747-768 |
| Dirty detection (local mode excluded) | `web/packages/agenta-entities/src/loadable/controller.ts` | 441-476 |
| importRows | `web/packages/agenta-entities/src/loadable/controller.ts` | 671-742 |
| commitChanges (sync back) | `web/packages/agenta-entities/src/loadable/controller.ts` | 1087-1177 |
| connectToTestset + chat gate | `web/packages/agenta-playground/src/state/controllers/playgroundController.ts` | 535-597 |
| importTestcases wrapper | `web/packages/agenta-playground/src/state/controllers/playgroundController.ts` | 608-632 |
| Initial empty row | `web/packages/agenta-playground/src/state/controllers/playgroundController.ts` | 186-238 |
| Dropdown + confirm funnel | `web/oss/src/components/Playground/Components/TestsetDropdown/index.tsx` | 245-348, 367-385, 457-474 |
| Existing guard modal | `web/oss/src/components/Playground/Components/Modals/TestsetDisconnectConfirmModal/index.tsx` | all |
| Selection modal | `web/packages/agenta-playground-ui/src/components/TestsetSelectionModal/` | all |
