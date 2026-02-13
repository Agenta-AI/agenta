# Research

## What the UI currently waits on
The commit modal keeps showing a loading state after a successful commit because it waits for a client side selection update.

In `web/oss/src/components/Playground/Components/Modals/CommitVariantChangesModal/index.tsx`, the modal:
- Sets `isMutating=true` when you click Commit.
- Runs the commit mutation.
- Sets `waitForRevisionId` to the new revision id.
- Closes only when `selectedVariantsAtom` contains `waitForRevisionId`.

If that selection update never happens, `isMutating` stays true and the modal keeps loading.

## Why `selectedVariantsAtom` does not "refresh"
`selectedVariantsAtom` is not server data. It is local UI state.

It is stored in localStorage under `agenta_selected_revisions_v2` and is scoped per app.
This means it only changes when the UI explicitly sets it.

Refs: `web/oss/src/components/Playground/state/atoms/core.ts`.

## Why the modal can hang even when the API is fast
The wait condition uses selection state, not commit state.

`saveVariantMutationAtom` updates `selectedVariantsAtom` by mapping existing selected ids.
This only changes selection when the committed revision id was already selected.

If you commit a revision that is not currently selected, the mutation can succeed but selection stays unchanged.
The modal then waits forever for an update that will never occur.

Refs: `web/oss/src/components/Playground/state/atoms/variantCrud.ts`.

There is also a second source of slowness.
Even in the normal path, the mutation may spend time waiting for the revisions list to refresh.
It invalidates and refetches several TanStack Query keys, then polls for a new revision id with a 10 to 15 second timeout.

Refs: `web/oss/src/components/Playground/state/atoms/queries.ts`.

## Entry points where selection can differ
- Commit modal is used in the variant drawer header, which can target a revision that is not in selectedVariantsAtom.
- When committing from that drawer, the modal waits on playground selection even though the drawer selection is independent.
Refs: `web/oss/src/components/VariantsComponents/Drawers/VariantDrawer/assets/VariantDrawerTitle/index.tsx`, `web/oss/src/components/Playground/Components/Modals/CommitVariantChangesModal/assets/CommitVariantChangesButton/index.tsx`.

## Hypothesis
- The loading "eternity" occurs when committing a revision not currently in selectedVariantsAtom, leaving the commit modal waiting forever for a selection update that never happens.
- A secondary delay can come from the waitForNewRevisionAfterMutationAtom timeout (10-15s), even when API calls return quickly.

## What could break if we close the modal earlier
Closing the modal on mutation success is safer than waiting on selection, but it can change timing.

These are the main risks:
- The UI can keep showing the old revision for a short time, because the revisions list refetch can lag.
- The drawer can stay pointed at the old revision if we do not update the `revisionId` URL param.
- The playground can stay pointed at the old revision if we do not swap the selected revision id.
- The user can click Commit again if the dirty state does not clear quickly enough.
- Deploy after commit needs a stable revision id. If we close before we have it, we need to ensure the deploy call uses the correct id.

Mitigations:
- Update the initiating context pointer (drawer URL or playground selection) on success.
- Add a bounded settle wait (short timeout) when we want to avoid UI flicker.
- Show a toast when we close before the revisions list catches up.
