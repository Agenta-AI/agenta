/**
 * Legacy Entity Bridge — Side Effects Only
 *
 * Registers playground-specific orchestration with the entity layer:
 * 1. App ID scoping for local draft storage
 * 2. Commit callbacks (query invalidation, selection swap, chat history duplication)
 * 3. Create-variant callbacks (selection update, chat history, URL sync)
 * 4. Delete-revision callbacks (query invalidation)
 * 5. RunnableBridge registration with playground package
 *
 * This module has no exports — import it for side effects only:
 * ```typescript
 * import "@/oss/state/newPlayground/legacyEntityBridge"
 * ```
 */

import {
    legacyAppRevisionMolecule,
    registerAppIdAtom,
    registerCommitCallbacks,
    registerCreateVariantCallbacks,
    registerDeleteRevisionCallbacks,
    type CommitRevisionResult,
    type CommitRevisionParams,
    type CreateVariantResult,
    type CreateVariantParams,
    type DeleteRevisionResult,
} from "@agenta/entities/legacyAppRevision"
import {runnableBridge} from "@agenta/entities/runnable"
import {isLocalDraftId} from "@agenta/entities/shared"
import {
    setOnSelectionChangeCallback,
    setRunnableBridge,
    playgroundController,
} from "@agenta/playground"
import {atom, getDefaultStore} from "jotai"

import {drawerVariantIdAtom} from "@/oss/components/VariantsComponents/Drawers/VariantDrawer/store/variantDrawerStore"
import {selectedAppIdAtom} from "@/oss/state/app/selectors/app"
import {writePlaygroundSelectionToQuery} from "@/oss/state/url/playground"

// ============================================================================
// APP ID REGISTRATION FOR LOCAL DRAFTS
// Wire up app scoping for local draft storage
// ============================================================================

// Register the app ID atom with the entities package to enable app-scoped local drafts
// This must be called before any local draft operations
registerAppIdAtom(selectedAppIdAtom as ReturnType<typeof atom<string | null>>)

// ============================================================================
// RUNNABLE BRIDGE REGISTRATION
// Wire the configured runnableBridge into the playground package
// ============================================================================

console.log("[legacyEntityBridge] registering runnableBridge with playground")
setRunnableBridge(runnableBridge)

// ============================================================================
// SELECTION CHANGE CALLBACK
// OSS-specific side-effects when playground selection changes
// ============================================================================

setOnSelectionChangeCallback((entityIds, removed) => {
    // Sync selection to URL
    void writePlaygroundSelectionToQuery(entityIds)

    // Keep drawer selection consistent
    const store = getDefaultStore()
    const currentDrawerId = store.get(drawerVariantIdAtom)
    if (!currentDrawerId || !entityIds.includes(currentDrawerId)) {
        store.set(drawerVariantIdAtom, entityIds[0] ?? null)
    }

    // Clean up local draft data for removed entities
    for (const id of removed) {
        if (isLocalDraftId(id)) {
            legacyAppRevisionMolecule.set.discard(id)
        }
    }
})

// ============================================================================
// COMMIT CALLBACKS
// Wire playground-specific orchestration into entity's commit flow
// ============================================================================

registerCommitCallbacks({
    onQueryInvalidate: async () => {
        await getDefaultStore().set(playgroundController.actions.invalidateQueries)
    },
    onNewRevision: async (result: CommitRevisionResult, params: CommitRevisionParams) => {
        const store = getDefaultStore()
        const {newRevisionId} = result
        const {revisionId} = params

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
// CREATE VARIANT CALLBACKS
// Wire playground-specific orchestration into entity's create-variant flow
// ============================================================================

registerCreateVariantCallbacks({
    onQueryInvalidate: async () => {
        await getDefaultStore().set(playgroundController.actions.invalidateQueries)
    },
    onNewVariant: async (result: CreateVariantResult, _params: CreateVariantParams) => {
        const store = getDefaultStore()
        const {newRevisionId, baseRevisionId} = result

        // Duplicate session responses from the base revision
        store.set(playgroundController.actions.duplicateSessionResponses, {
            sourceRevisionId: baseRevisionId,
            targetRevisionId: newRevisionId,
        })

        // Replace selection with the new revision
        const updatedVariants = [newRevisionId]
        store.set(playgroundController.actions.setEntityIds, updatedVariants)
        void writePlaygroundSelectionToQuery(updatedVariants)
    },
})

// ============================================================================
// DELETE REVISION CALLBACKS
// Wire playground-specific orchestration into entity's delete-revision flow
// ============================================================================

registerDeleteRevisionCallbacks({
    onQueryInvalidate: async () => {
        await getDefaultStore().set(playgroundController.actions.invalidateQueries)
    },
    onRevisionDeleted: async (result: DeleteRevisionResult) => {
        const store = getDefaultStore()
        const {revisionId} = result

        // Remove the deleted revision from the selection
        const currentIds = store.get(playgroundController.selectors.entityIds())
        const updatedIds = currentIds.filter((id) => id !== revisionId)

        if (updatedIds.length > 0) {
            store.set(playgroundController.actions.setEntityIds, updatedIds)
            void writePlaygroundSelectionToQuery(updatedIds)
        }
    },
})
