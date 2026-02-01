/**
 * OssAppRevision Snapshot Adapter
 *
 * Implements the RunnableSnapshotAdapter interface for OssAppRevision entities.
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
import {isLocalDraftId, extractSourceIdFromDraft} from "../shared/utils/revisionLabel"

import {buildOssAppRevisionDraftPatch, applyOssAppRevisionDraftPatch} from "./snapshot"
import {ossAppRevisionDraftAtomFamily} from "./state/store"

// ============================================================================
// PATCH VALIDATION SCHEMA
// ============================================================================

/**
 * Zod schema for validating OssAppRevision draft patches.
 */
const ossAppRevisionPatchSchema = z.object({
    parameters: z.record(z.string(), z.unknown()),
})

// ============================================================================
// ADAPTER IMPLEMENTATION
// ============================================================================

/**
 * Snapshot adapter for OssAppRevision entities.
 *
 * Provides snapshot operations (build/apply patch, draft detection) for
 * the OSS app revision entity type.
 */
export const ossAppRevisionSnapshotAdapter: RunnableSnapshotAdapter = {
    type: "ossAppRevision",

    buildDraftPatch(revisionId: string): BuildDraftPatchResult {
        const result = buildOssAppRevisionDraftPatch(revisionId)
        return {
            hasDraft: result.hasDraft,
            // Cast to RunnableDraftPatch (OssAppRevisionDraftPatch is compatible at runtime)
            patch: result.patch as RunnableDraftPatch | null,
            sourceRevisionId: result.sourceRevisionId,
        }
    },

    applyDraftPatch(revisionId: string, patch: RunnableDraftPatch): boolean {
        // Validate patch using Zod schema
        const parseResult = ossAppRevisionPatchSchema.safeParse(patch)
        if (!parseResult.success) {
            console.warn(
                "[OssAppRevisionSnapshotAdapter] Invalid patch format:",
                parseResult.error.message,
            )
            return false
        }

        return applyOssAppRevisionDraftPatch(revisionId, parseResult.data)
    },

    getDraft(revisionId: string): unknown | null {
        const store = getDefaultStore()
        return store.get(ossAppRevisionDraftAtomFamily(revisionId)) ?? null
    },

    isLocalDraftId(id: string): boolean {
        return isLocalDraftId(id)
    },

    extractSourceId(draftId: string): string | null {
        return extractSourceIdFromDraft(draftId)
    },
}

// ============================================================================
// AUTO-REGISTRATION
// ============================================================================

// Register adapter when this module is imported
snapshotAdapterRegistry.register(ossAppRevisionSnapshotAdapter)
