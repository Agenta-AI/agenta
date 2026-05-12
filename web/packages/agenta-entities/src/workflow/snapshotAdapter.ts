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
import {computeShallowDiff, applyShallowPatch} from "../runnable/snapshotDiff"
import {isLocalDraftId} from "../shared"

import type {Workflow} from "./core"
import {
    workflowDraftAtomFamily,
    updateWorkflowDraftAtom,
    workflowLocalServerDataAtomFamily,
    workflowServerDataSelectorFamily,
    workflowEntityAtomFamily,
    createLocalDraftFromWorkflowRevision,
    createEphemeralWorkflow,
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
/**
 * Check if a workflow entity is ephemeral (is_base flag).
 */
function isEphemeralWorkflow(entityId: string): boolean {
    const store = getDefaultStore()
    const entity = store.get(workflowEntityAtomFamily(entityId)) as Workflow | null
    return entity?.flags?.is_base ?? false
}

export const workflowSnapshotAdapter: RunnableSnapshotAdapter = {
    type: "workflow",

    /**
     * For ephemeral workflows (is_base), serialize the full entity inline.
     * For regular workflows, this returns null (handled via draft/commit path).
     */
    serializeEntity(entityId: string): Record<string, unknown> | null {
        if (!isEphemeralWorkflow(entityId)) return null

        const store = getDefaultStore()
        const entity = store.get(workflowEntityAtomFamily(entityId)) as Workflow | null
        if (!entity) return null

        const meta = entity.meta as Record<string, unknown> | null | undefined
        const isEvaluator = entity.flags?.is_evaluator === true
        return {
            label: entity.name ?? "Restored Entity",
            inputs: (meta?.inputs as Record<string, unknown>) ?? {},
            outputs: meta?.outputs ?? {},
            parameters: entity.data?.parameters ?? {},
            ...(meta?.sourceRef ? {sourceRef: meta.sourceRef} : {}),
            ...(isEvaluator ? {isEvaluator: true} : {}),
            ...(entity.data?.uri ? {uri: entity.data.uri} : {}),
            ...(meta?.envelope ? {envelope: meta.envelope} : {}),
        }
    },

    /**
     * Restore an ephemeral workflow from serialized snapshot data.
     */
    restoreEntity(data: Record<string, unknown>): string | null {
        const {id: entityId} = createEphemeralWorkflow({
            label: (data.label as string) ?? "Restored Entity",
            inputs: (data.inputs as Record<string, unknown>) ?? {},
            outputs: data.outputs ?? {},
            parameters: (data.parameters as Record<string, unknown>) ?? {},
            sourceRef: data.sourceRef as
                | {type: "application" | "evaluator"; id: string; slug?: string}
                | undefined,
            isEvaluator: data.isEvaluator === true,
            uri: typeof data.uri === "string" ? data.uri : undefined,
            envelope:
                data.envelope && typeof data.envelope === "object"
                    ? (data.envelope as Record<string, unknown>)
                    : undefined,
        })
        return entityId
    },

    buildDraftPatch(revisionId: string): BuildDraftPatchResult {
        const store = getDefaultStore()

        // Ephemeral workflows have no draft system — report no draft
        // (they're handled via serializeEntity/restoreEntity instead)
        if (isEphemeralWorkflow(revisionId)) {
            return {hasDraft: false, patch: null, sourceRevisionId: revisionId}
        }

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

        // Compute shallow diff — only include top-level keys that changed
        const diff = computeShallowDiff(entityParams, serverParams)
        if (!diff) {
            return {hasDraft: false, patch: null, sourceRevisionId: revisionId}
        }

        return {
            hasDraft: true,
            patch: {parameters: diff},
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
            !parseResult.data.parameters || Object.keys(parseResult.data.parameters).length === 0

        if (isEmptyPatch) {
            return true
        }

        const store = getDefaultStore()

        // Get server parameters as merge base, then shallow-merge the patch.
        // This handles both full-params patches (old format) and diff patches (new format).
        const serverData = store.get(workflowServerDataSelectorFamily(revisionId))
        const serverParams = (serverData?.data?.parameters as Record<string, unknown>) ?? {}
        const mergedParams = applyShallowPatch(serverParams, parseResult.data.parameters)

        store.set(updateWorkflowDraftAtom, revisionId, {
            data: {parameters: mergedParams},
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

                // Get the cloned server data as merge base, then shallow-merge the patch.
                const clonedData = store.get(workflowServerDataSelectorFamily(localDraftId))
                const clonedParams = (clonedData?.data?.parameters as Record<string, unknown>) ?? {}
                const mergedParams = applyShallowPatch(clonedParams, parseResult.data.parameters)

                store.set(updateWorkflowDraftAtom, localDraftId, {
                    data: {parameters: mergedParams},
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
