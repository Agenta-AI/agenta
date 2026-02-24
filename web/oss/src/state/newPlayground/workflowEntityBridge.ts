/**
 * Workflow Entity Bridge — Side Effects Only
 *
 * Registers workflow-specific CRUD callbacks with the playground:
 * 1. Commit callbacks (query invalidation, selection swap)
 * 2. Archive callbacks (query invalidation, selection cleanup)
 *
 * This module coexists with legacyEntityBridge.ts — the existing
 * selection change callback handles both entity types since
 * writePlaygroundSelectionToQuery is entity-agnostic and
 * isLocalDraftId guards prevent workflow IDs from being discarded.
 *
 * This module has no exports — import it for side effects only:
 * ```typescript
 * import "@/oss/state/newPlayground/workflowEntityBridge"
 * ```
 */

import {
    registerWorkflowCommitCallbacks,
    registerWorkflowArchiveCallbacks,
    type WorkflowCommitResult,
    type WorkflowArchiveResult,
} from "@agenta/entities/workflow"
import {playgroundController} from "@agenta/playground"
import {getDefaultStore} from "jotai"

import {routerAppNavigationAtom} from "@/oss/state/app"
import {writePlaygroundSelectionToQuery} from "@/oss/state/url/playground"

// ============================================================================
// COMMIT CALLBACKS
// Wire playground-specific orchestration into workflow's commit flow
// ============================================================================

registerWorkflowCommitCallbacks({
    onQueryInvalidate: async () => {
        await getDefaultStore().set(playgroundController.actions.invalidateQueries)
    },
    onNewRevision: async (result: WorkflowCommitResult) => {
        const store = getDefaultStore()
        const {revisionId, newRevisionId} = result

        // Use the controller's switchEntity action which handles:
        // 1. Swapping the entity ID in the selection
        // 2. Duplicating chat history
        // 3. Notifying the selection change callback (URL sync, drawer state)
        store.set(playgroundController.actions.switchEntity, {
            currentEntityId: revisionId,
            newEntityId: newRevisionId,
        })
    },
})

// ============================================================================
// ARCHIVE CALLBACKS
// Wire playground-specific orchestration into workflow's archive flow
// ============================================================================

registerWorkflowArchiveCallbacks({
    onQueryInvalidate: async () => {
        await getDefaultStore().set(playgroundController.actions.invalidateQueries)
    },
    onRevisionDeleted: async (result: WorkflowArchiveResult) => {
        const store = getDefaultStore()
        const {revisionId} = result

        // Remove the archived revision from the selection
        const currentIds = store.get(playgroundController.selectors.entityIds())
        const updatedIds = currentIds.filter((id) => id !== revisionId)

        if (updatedIds.length > 0) {
            store.set(playgroundController.actions.setEntityIds, updatedIds)
            void writePlaygroundSelectionToQuery(updatedIds)
        } else {
            // All entities deleted — navigate back to apps list
            store.set(playgroundController.actions.setEntityIds, [])
            store.set(routerAppNavigationAtom, null)
        }
    },
})
