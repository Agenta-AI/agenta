# Plan

## Proposed UX

User is in local mode with meaningful draft rows (from a trace or manual
entry) and connects a test set:

1. User opens Test set dropdown > "Connect test set", picks a test set and
   test cases, clicks "Load Selected".
2. New modal appears (only when meaningful draft rows exist):

   - Title: `Keep your draft test cases?`
   - Body: `Your playground has {n} draft test case{s} that are not part of
     "{testsetName}". Keep them to add them to the loaded test set as unsaved
     rows. You can review them and sync them to the test set afterwards.`
   - Buttons:
     - `Keep and add` (primary): connect, then append the captured draft rows
       as unsaved additions.
     - `Discard` (default, danger styling): today's replace behavior.
     - `Cancel`: back to the playground unchanged (selection modal already
       closed; acceptable for v1).

3. After "Keep and add": the table shows the test set rows plus the draft
   rows. `hasLocalChanges` is true, so the dropdown shows "Sync changes".
   Committing creates a new test set revision that includes the kept rows.
   This is the existing commit flow, unchanged.

Copy is a draft. Final copy review against the writing-style guidelines (no
em dashes, active voice, short sentences) before merge.

## Implementation phases

### Phase 1: state layer (packages)

1. **`hasMeaningfulLocalRows` selector** in the loadable controller
   (`web/packages/agenta-entities/src/loadable/controller.ts`), exposed via
   `loadableController.selectors`. True when the loadable is in local mode and
   at least one display row's data has a non-empty value (trim strings, skip
   system fields). This intentionally stays separate from `hasLocalChanges`,
   whose "false when not connected" contract other features depend on.
2. **`connectToTestsetKeepingLocalRows` compound action** in
   `playgroundController`
   (`web/packages/agenta-playground/src/state/controllers/playgroundController.ts`):
   - Capture current local rows: `displayRowIds` + `testcaseMolecule` data,
     filtered to meaningful rows.
   - Call existing `connectToTestsetAtom` with the selected test set rows.
   - Call existing `importTestcasesAtom` with the captured rows.
   - Chat mode: do not offer keep (the caller skips the prompt); the action
     can still guard defensively by falling back to plain connect.
   Orchestration lives in the package so it is unit-testable and the app layer
   stays thin (per `agenta-package-practices`).

### Phase 2: app layer (modal + wiring)

3. **Keep/discard modal** in
   `web/oss/src/components/Playground/Components/Modals/`. Either:
   - extend `TestsetDisconnectConfirmModal` with a new intent
     (`"keep-local-rows"`) and per-intent buttons, or
   - add a sibling `KeepDraftRowsModal` using `EnhancedModal` from
     `@agenta/ui`, with a small state atom like the disconnect modal's.
   Recommendation: a sibling modal. The disconnect modal's Save/Discard
   semantics differ enough that overloading it would muddy both.
4. **Wire `handleLoadConfirm`** in
   `web/oss/src/components/Playground/Components/TestsetDropdown/index.tsx`:
   in the connect branch (not `importMode === "import"`), when
   `hasMeaningfulLocalRows && !isChatPlayground`, stash the pending payload in
   the modal atom and open the modal instead of connecting immediately.
   Modal "Keep and add" calls `connectToTestsetKeepingLocalRows`; "Discard"
   calls `connectToTestset` as today.
5. **Wire `handleCreateAndLoad`** the same way (Create & Load currently wipes
   draft rows into a brand-new empty test set, the worst case of this bug).

### Phase 3: QA and polish

6. Package unit tests (in `tests/unit/` per package practices):
   - capture + connect + import leaves test set rows plus kept rows, kept rows
     in `newEntityIdsAtom`, `hasLocalChanges` true.
   - empty initial row does not count as meaningful.
   - chat mode falls back to plain connect.
7. Manual QA on the dev stack (debug-local-deployment skill):
   - trace > playground > connect test set > keep > sync changes > verify the
     new revision contains the trace row.
   - same with manual rows; same with Discard; same with Create & Load.
   - trace row whose input keys do not match the test set columns (expect
     "(new)" column behavior, no crash).
8. `pnpm lint-fix` in `web`, copy review.

## Decisions (confirmed with Mahmoud, 2026-06-09)

1. **Modal placement**: prompt after the selection modal confirm. Decided:
   modal.
2. **Chat mode**: show a warning modal ("Replace the current conversation?")
   instead of the keep option, since the chat playground loads one test case
   at a time. Decided: warning modal.
3. **Connected-mode "Change test set"**: the existing Save/Discard guard
   stays as is for v1.
4. **UX and copy**: delegated. Final copy: title "Keep your draft test
   cases?", buttons Cancel / "Discard drafts" (danger) / "Keep and load"
   (primary). Chat variant: title "Replace the current conversation?",
   buttons Cancel / "Load and replace" (primary, danger). "Keep and load" is
   the emphasized button because it is the safe, non-destructive action.

## Risks

- `connectToSource` clears entity state; if capture happens after, data is
  gone. The compound action owns the ordering, and a unit test pins it.
- Imported rows with mismatched columns surface as "(new)" columns on commit.
  Acceptable, but QA item 7 verifies it.
- The selection modal's preselect logic in load mode assumes a clean slate;
  importing afterwards does not touch selection drafts, so no conflict is
  expected. Verify during QA.
