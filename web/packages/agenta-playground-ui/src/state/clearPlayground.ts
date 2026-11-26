import {loadableController} from "@agenta/entities/loadable"
import {isLocalDraftId} from "@agenta/entities/shared"
import {clearChangesAtom} from "@agenta/entities/testset"
import {discardLocalServerDataAtom, workflowMolecule} from "@agenta/entities/workflow"
import {
    executionItemController,
    playgroundController,
    playgroundInitializedAtom,
} from "@agenta/playground"
import type {useStore} from "jotai"

/**
 * Clears what a playground page or the revision drawer set up: its runs, test set connection,
 * nodes and local copies. The agent session screen uses the same store, so none of these may
 * outlive the page.
 *
 * `keepEdits` keeps the unsaved edits of saved revisions, as the old playground does when its page
 * is left: they show again as a draft when the revision is opened again. Without it (the revision
 * drawer's Discard and close) those edits go too.
 */
export const clearPlayground = (
    store: ReturnType<typeof useStore>,
    {keepEdits = false}: {keepEdits?: boolean} = {},
) => {
    const nodes = store.get(playgroundController.selectors.nodes())
    const loadableId = store.get(playgroundController.selectors.loadableId())
    // Runs first: they are found through the selection that `resetAll` removes.
    store.set(executionItemController.actions.clearAll)
    // The test case store is shared with the test set editor: the connection and the
    // unsaved test case edits go with the page.
    if (loadableId) {
        store.set(clearChangesAtom)
        store.set(loadableController.actions.disconnect, loadableId)
    }
    store.set(playgroundController.actions.resetAll)
    store.set(playgroundInitializedAtom, false)
    // A local copy has no saved revision to come back to, so it always goes (the leave guard asks
    // first).
    for (const {entityId} of nodes) {
        if (isLocalDraftId(entityId)) store.set(discardLocalServerDataAtom, entityId)
        else if (!keepEdits) store.set(workflowMolecule.actions.discard, entityId)
    }
}
