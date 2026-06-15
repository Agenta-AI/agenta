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

// Patch is a shallow diff over the whole `data` object (any changed top-level
// key: uri, schemas, url, headers, script, runtime, parameters).
const workflowPatchSchema = z.record(z.string(), z.unknown())

// Merge a data patch over a server baseline: parameters shallow-merge (nested
// diff), every other key replaces.
function mergeDataPatch(
    remoteData: Workflow | null | undefined,
    patch: Record<string, unknown>,
): Record<string, unknown> {
    const baseData = (remoteData?.data ?? {}) as Record<string, unknown>
    const remoteParams = (remoteData?.data?.parameters as Record<string, unknown>) ?? {}
    const {parameters, ...rest} = patch
    const merged: Record<string, unknown> = {...baseData, ...rest}
    if (parameters && typeof parameters === "object") {
        merged.parameters = applyShallowPatch(remoteParams, parameters as Record<string, unknown>)
    }
    return merged
}

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

        // Effective current data (clone + draft overlay) vs source server baseline.
        const localData = store.get(workflowEntityAtomFamily(revisionId))
        const remoteData = store.get(workflowServerDataSelectorFamily(revisionId))
        const localRec = (localData?.data ?? {}) as Record<string, unknown>
        const remoteRec = (remoteData?.data ?? {}) as Record<string, unknown>

        // Shallow diff over every data key, with parameters diffed at its own level.
        const patch = computeShallowDiff(localRec, remoteRec) ?? {}
        const paramDiff = computeShallowDiff(
            (localRec.parameters as Record<string, unknown>) ?? {},
            (remoteRec.parameters as Record<string, unknown>) ?? {},
        )
        if (paramDiff) patch.parameters = paramDiff
        else delete patch.parameters

        if (Object.keys(patch).length === 0) {
            return {hasDraft: false, patch: null, sourceRevisionId: revisionId}
        }

        return {hasDraft: true, patch, sourceRevisionId: revisionId}
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

        const patchData = parseResult.data
        if (Object.keys(patchData).length === 0) return true

        const store = getDefaultStore()
        const mergedData = mergeDataPatch(
            store.get(workflowServerDataSelectorFamily(revisionId)),
            patchData,
        )

        store.set(updateWorkflowDraftAtom, revisionId, {data: mergedData})
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

            // Skip an empty patch — the clone already holds the full source data.
            if (Object.keys(parseResult.data).length > 0) {
                const store = getDefaultStore()
                const mergedData = mergeDataPatch(
                    store.get(workflowServerDataSelectorFamily(localDraftId)),
                    parseResult.data,
                )
                store.set(updateWorkflowDraftAtom, localDraftId, {data: mergedData})
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
