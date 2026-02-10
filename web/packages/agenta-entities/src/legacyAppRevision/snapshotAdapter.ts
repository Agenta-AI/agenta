/**
 * LegacyAppRevision Snapshot Adapter
 *
 * Implements the RunnableSnapshotAdapter interface for LegacyAppRevision entities.
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
import {isLocalDraftId} from "../shared/utils/revisionLabel"

import {buildLegacyAppRevisionDraftPatch, applyLegacyAppRevisionDraftPatch} from "./snapshot"
import {createLocalDraftFromRevision} from "./state/localDrafts"
import {legacyAppRevisionDraftAtomFamily} from "./state/store"
import {resolveRootSourceId} from "./utils/sourceResolution"

// ============================================================================
// PATCH VALIDATION SCHEMA
// ============================================================================

/**
 * Zod schema for validating LegacyAppRevision draft patches.
 */
const legacyAppRevisionPatchSchema = z.object({
    parameters: z.record(z.string(), z.unknown()),
})

// ============================================================================
// ADAPTER IMPLEMENTATION
// ============================================================================

/**
 * Snapshot adapter for LegacyAppRevision entities.
 *
 * Provides snapshot operations (build/apply patch, draft detection) for
 * the OSS app revision entity type.
 */
export const legacyAppRevisionSnapshotAdapter: RunnableSnapshotAdapter = {
    type: "legacyAppRevision",

    buildDraftPatch(revisionId: string): BuildDraftPatchResult {
        const result = buildLegacyAppRevisionDraftPatch(revisionId)
        return {
            hasDraft: result.hasDraft,
            // Cast to RunnableDraftPatch (LegacyAppRevisionDraftPatch is compatible at runtime)
            patch: result.patch as RunnableDraftPatch | null,
            sourceRevisionId: result.sourceRevisionId,
        }
    },

    applyDraftPatch(revisionId: string, patch: RunnableDraftPatch): boolean {
        // Validate patch using Zod schema
        const parseResult = legacyAppRevisionPatchSchema.safeParse(patch)
        if (!parseResult.success) {
            console.warn(
                "[LegacyAppRevisionSnapshotAdapter] Invalid patch format:",
                parseResult.error.message,
            )
            return false
        }

        return applyLegacyAppRevisionDraftPatch(revisionId, parseResult.data)
    },

    getDraft(revisionId: string): unknown | null {
        const store = getDefaultStore()
        return store.get(legacyAppRevisionDraftAtomFamily(revisionId)) ?? null
    },

    isLocalDraftId(id: string): boolean {
        return isLocalDraftId(id)
    },

    extractSourceId(draftId: string): string | null {
        // Use recursive resolution to get the root server revision ID
        // This handles chained local drafts (draft created from another draft)
        const rootSourceId = resolveRootSourceId(draftId)

        return rootSourceId
    },

    createLocalDraftWithPatch(sourceRevisionId: string, patch: RunnableDraftPatch): string | null {
        // Validate patch using Zod schema
        const parseResult = legacyAppRevisionPatchSchema.safeParse(patch)
        if (!parseResult.success) {
            console.warn(
                "[LegacyAppRevisionSnapshotAdapter] Invalid patch format for createLocalDraftWithPatch:",
                parseResult.error.message,
            )
            return null
        }

        try {
            // Create a new local draft from the source revision
            // This may return null if source data is not available yet
            const localDraftId = createLocalDraftFromRevision(sourceRevisionId)

            if (!localDraftId) {
                // Source data not available yet - return null so hydration can retry later
                return null
            }

            // Apply the patch to the new local draft
            const applied = applyLegacyAppRevisionDraftPatch(localDraftId, parseResult.data)

            if (!applied) {
                console.warn(
                    "[LegacyAppRevisionSnapshotAdapter] Failed to apply patch to new local draft:",
                    localDraftId,
                )
                // Still return the draft ID - it was created, just without the patch
            }

            return localDraftId
        } catch (error) {
            console.error(
                "[LegacyAppRevisionSnapshotAdapter] Failed to create local draft with patch:",
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
snapshotAdapterRegistry.register(legacyAppRevisionSnapshotAdapter)
