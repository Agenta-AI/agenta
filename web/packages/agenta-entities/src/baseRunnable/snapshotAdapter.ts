/**
 * BaseRunnable Snapshot Adapter
 *
 * Implements the RunnableSnapshotAdapter interface for ephemeral baseRunnable entities.
 * These entities have no server-side state — the full data is serialized inline
 * in the URL snapshot and restored on hydration.
 */

import {getDefaultStore} from "jotai/vanilla"

import {
    snapshotAdapterRegistry,
    type RunnableSnapshotAdapter,
    type BuildDraftPatchResult,
} from "../runnable/snapshotAdapter"
import {isLocalDraftId} from "../shared/utils/revisionLabel"

import {baseRunnableMolecule, createBaseRunnable, type BaseRunnableData} from "./index"

// ============================================================================
// ADAPTER IMPLEMENTATION
// ============================================================================

export const baseRunnableSnapshotAdapter: RunnableSnapshotAdapter = {
    type: "baseRunnable",
    isEphemeral: true,

    buildDraftPatch(_revisionId: string): BuildDraftPatchResult {
        // baseRunnable has no draft system — always report no draft
        return {hasDraft: false, patch: null, sourceRevisionId: _revisionId}
    },

    applyDraftPatch(): boolean {
        // No-op — baseRunnable doesn't use the draft/patch model
        return false
    },

    getDraft(): unknown | null {
        return null
    },

    isLocalDraftId(id: string): boolean {
        return isLocalDraftId(id)
    },

    extractSourceId(): string | null {
        // baseRunnable has no source revision
        return null
    },

    serializeEntity(entityId: string): Record<string, unknown> | null {
        const store = getDefaultStore()
        const data = store.get(
            baseRunnableMolecule.selectors.data(entityId),
        ) as BaseRunnableData | null
        if (!data) return null

        return {
            label: data.label,
            inputs: data.inputs,
            outputs: data.outputs,
            parameters: data.parameters,
            ...(data.sourceRef ? {sourceRef: data.sourceRef} : {}),
        }
    },

    restoreEntity(data: Record<string, unknown>): string | null {
        const {id: entityId, data: entityData} = createBaseRunnable({
            label: (data.label as string) ?? "Restored Entity",
            inputs: (data.inputs as Record<string, unknown>) ?? {},
            outputs: data.outputs ?? {},
            parameters: (data.parameters as Record<string, unknown>) ?? {},
            sourceRef: data.sourceRef as BaseRunnableData["sourceRef"],
        })

        baseRunnableMolecule.set.data(entityId, entityData)
        return entityId
    },
}

// ============================================================================
// AUTO-REGISTRATION
// ============================================================================

snapshotAdapterRegistry.register(baseRunnableSnapshotAdapter)
