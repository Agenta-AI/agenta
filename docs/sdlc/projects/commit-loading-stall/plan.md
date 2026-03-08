# Plan

## Phase 0 - Define success criteria
- The UI should stop showing commit loading when the server commit succeeds.
- The UI should never wait without a timeout. If state does not settle, the modal should still close and the UI should recover in the background.
- After commit, the initiating UI should point at the new revision.
  - Playground flow: update `selectedVariantsAtom` when committing a selected revision.
  - Variant drawer flow: update the `revisionId` query param (and drawer state) to the new revision.

## Phase 1 - Map all commit flows
- Commit from the main playground (selected revision).
- Commit from the variant drawer (revision may not be in `selectedVariantsAtom`).
- Commit as a new variant (branch).
- Commit with "Deploy after commit" enabled.

For each flow, record:
- Which ID is the input (revision id vs parent variant id).
- Which ID is the output (new revision id, and sometimes new variant id).
- Which UI state must update (playground selection, drawer URL, or both).

## Phase 2 - Explain why it can feel slow
- Confirm that `selectedVariantsAtom` is localStorage backed selection state. It does not refresh from the API.
- Measure time spent in each step of the commit flow:
  - Commit request itself.
  - Query invalidation and refetch (`invalidatePlaygroundQueriesAtom`).
  - Polling for the newest revision (`waitForNewRevisionAfterMutationAtom`).

## Phase 3 - Fix design (first principles)
### Choose the right completion signal
- Primary signal: the commit mutation resolves successfully.
- Optional secondary signal: the new revision becomes visible in the revisions list. Only wait for this within a short time budget.
- Do not gate modal close on `selectedVariantsAtom`. Selection is view state, not commit state.

### Make state settle work asynchronous
- Close the modal as soon as the commit is persisted (and deployment finishes if selected).
- Continue query invalidation and UI updates in the background.
- If the UI cannot determine the new revision id quickly, close anyway and show a success message that versions are refreshing.

### Keep the initiating context in sync
- If commit starts from the variant drawer, update the drawer URL to the new revision id on success.
- If commit starts from the playground selection, swap the selected revision to the new revision id.

### Reduce unnecessary waiting
- Avoid awaiting a full refetch of multiple queries in the commit path.
- If we need a new revision id, prefer a targeted fetch for that variant's revisions and pick the newest.
- If the backend can return the new revision id in the commit response, use it and skip polling.

## Phase 4 - Implementation and validation
- Update `CommitVariantChangesModal` so it always clears loading based on mutation completion (with a timeout fallback).
- Update the variant drawer commit entry point so it navigates to the new revision id after commit.
- Reduce or remove blocking waits on query refetch.
- Validate these scenarios:
  - Commit from the playground (selected revision).
  - Commit from the variant drawer (non selected revision).
  - Commit in comparison view (multiple selected revisions).
  - Commit as a new variant.
  - Commit with deploy after commit enabled.
