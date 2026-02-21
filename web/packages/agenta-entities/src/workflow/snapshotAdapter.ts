/**
 * Workflow Snapshot Adapter
 *
 * Implements the RunnableSnapshotAdapter interface for Workflow entities.
 * This adapter is registered with the snapshot adapter registry at import time.
 */

import {getDefaultStore} from "jotai/vanilla"
import {z} from "zod"

import {
    snapshotAdapterRegistry,
    type RunnableSnapshotAdapter,
    type RunnableDraftPatch,
    type BuildDraftPatchResult,
} from "../runnable/snapshotAdapter"
import {isLocalDraftId} from "../shared"

import {
    workflowDraftAtomFamily,
    updateWorkflowDraftAtom,
    workflowLocalServerDataAtomFamily,
    workflowServerDataSelectorFamily,
    workflowEntityAtomFamily,
    createLocalDraftFromWorkflowRevision,
} from "./state/store"

// ============================================================================
// PATCH VALIDATION SCHEMA
// ============================================================================

/**
 * Zod schema for validating Workflow draft patches.
 */
const workflowPatchSchema = z.object({
    parameters: z.record(z.string(), z.unknown()),
})

// ============================================================================
// ADAPTER IMPLEMENTATION
// ============================================================================

/**
 * Snapshot adapter for Workflow entities.
 *
 * Provides snapshot operations (build/apply patch, draft detection) for
 * the workflow entity type.
 */
export const workflowSnapshotAdapter: RunnableSnapshotAdapter = {
    type: "workflow",

    buildDraftPatch(revisionId: string): BuildDraftPatchResult {
        const store = getDefaultStore()

        // For local drafts, edits may be baked into the clone (no draft atom).
        // Use the full entity data as the effective current state.
        const isLocal = isLocalDraftId(revisionId)
        if (!isLocal) {
            const draft = store.get(workflowDraftAtomFamily(revisionId))
            if (!draft) {
                return {hasDraft: false, patch: null, sourceRevisionId: revisionId}
            }
        }

        // Get effective current parameters from the entity (clone + draft overlay)
        const entityData = store.get(workflowEntityAtomFamily(revisionId))
        const entityParams = (entityData?.data?.parameters as Record<string, unknown>) ?? {}

        // Compare with source server data to detect actual changes.
        // workflowServerDataSelectorFamily redirects local drafts to the
        // source entity's live server data automatically.
        const serverData = store.get(workflowServerDataSelectorFamily(revisionId))
        const serverParams = (serverData?.data?.parameters as Record<string, unknown>) ?? {}

        const hasChanges = JSON.stringify(entityParams) !== JSON.stringify(serverParams)
        if (!hasChanges) {
            return {hasDraft: false, patch: null, sourceRevisionId: revisionId}
        }

        return {
            hasDraft: true,
            patch: {parameters: entityParams},
            sourceRevisionId: revisionId,
        }
    },

    applyDraftPatch(revisionId: string, patch: RunnableDraftPatch): boolean {
        const parseResult = workflowPatchSchema.safeParse(patch)
        if (!parseResult.success) {
            console.warn(
                "[WorkflowSnapshotAdapter] Invalid patch format:",
                parseResult.error.message,
            )
            return false
        }

        // Empty patch means "no changes" — skip writing to avoid overwriting
        // existing parameters with an empty object during draft merge.
        const isEmptyPatch =
            !parseResult.data.parameters ||
            Object.keys(parseResult.data.parameters).length === 0

        if (isEmptyPatch) {
            return true
        }

        const store = getDefaultStore()
        store.set(updateWorkflowDraftAtom, revisionId, {
            data: {parameters: parseResult.data.parameters},
        })
        return true
    },

    getDraft(revisionId: string): unknown | null {
        const store = getDefaultStore()
        return store.get(workflowDraftAtomFamily(revisionId)) ?? null
    },

    isLocalDraftId(id: string): boolean {
        if (!isLocalDraftId(id)) return false
        // Check if this local draft belongs to the workflow module
        const store = getDefaultStore()
        return store.get(workflowLocalServerDataAtomFamily(id)) !== null
    },

    extractSourceId(draftId: string): string | null {
        if (!isLocalDraftId(draftId)) return null
        const store = getDefaultStore()
        const localData = store.get(workflowLocalServerDataAtomFamily(draftId)) as
            | (Record<string, unknown> & {_sourceRevisionId?: string})
            | null
        return localData?._sourceRevisionId ?? null
    },

    createLocalDraftWithPatch(sourceRevisionId: string, patch: RunnableDraftPatch): string | null {
        const parseResult = workflowPatchSchema.safeParse(patch)
        if (!parseResult.success) {
            console.warn(
                "[WorkflowSnapshotAdapter] Invalid patch format for createLocalDraftWithPatch:",
                parseResult.error.message,
            )
            return null
        }

        try {
            const localDraftId = createLocalDraftFromWorkflowRevision(sourceRevisionId)

            if (!localDraftId) {
                return null
            }

            // Only apply the draft overlay if the patch has actual parameter changes.
            // An empty patch ({parameters: {}}) means "no changes from source" — the
            // local clone already has the full source data, so setting an empty draft
            // would overwrite the cloned parameters during merge.
            const isEmptyPatch =
                !parseResult.data.parameters ||
                Object.keys(parseResult.data.parameters).length === 0

            if (!isEmptyPatch) {
                const store = getDefaultStore()
                store.set(updateWorkflowDraftAtom, localDraftId, {
                    data: {parameters: parseResult.data.parameters},
                })
            }

            return localDraftId
        } catch (error) {
            console.error(
                "[WorkflowSnapshotAdapter] Failed to create local draft with patch:",
                error,
            )
            return null
        }
    },
}

// ============================================================================
// AUTO-REGISTRATION
// ============================================================================

// Register adapter when this module is imported
snapshotAdapterRegistry.register(workflowSnapshotAdapter)
