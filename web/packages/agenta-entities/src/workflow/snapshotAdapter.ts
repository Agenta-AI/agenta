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
        const draft = store.get(workflowDraftAtomFamily(revisionId))
        if (!draft) {
            return {hasDraft: false, patch: null, sourceRevisionId: revisionId}
        }
        return {
            hasDraft: true,
            patch: {
                parameters:
                    (draft as {data?: {parameters?: Record<string, unknown>}}).data?.parameters ??
                    {},
            },
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
}

// ============================================================================
// AUTO-REGISTRATION
// ============================================================================

// Register adapter when this module is imported
snapshotAdapterRegistry.register(workflowSnapshotAdapter)
