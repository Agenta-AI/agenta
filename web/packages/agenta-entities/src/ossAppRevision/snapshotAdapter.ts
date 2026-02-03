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
import {createLocalDraftFromRevision} from "./state/localDrafts"
import {ossAppRevisionDraftAtomFamily, ossAppRevisionServerDataAtomFamily} from "./state/store"

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
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get the immediate source revision ID from a local draft.
 * This may return another local draft ID if the draft was created from another draft.
 */
function getImmediateSourceId(draftId: string): string | null {
    if (!isLocalDraftId(draftId)) {
        return null
    }

    const store = getDefaultStore()

    // PRIORITY 1: Check stored data for _sourceRevisionId
    // This is the most reliable source as createLocalDraftFromRevision stores it here
    const serverData = store.get(ossAppRevisionServerDataAtomFamily(draftId)) as {
        _sourceRevisionId?: string
    } | null
    if (serverData?._sourceRevisionId) {
        return serverData._sourceRevisionId
    }

    // PRIORITY 2: Check draft atom
    const draftData = store.get(ossAppRevisionDraftAtomFamily(draftId)) as {
        _sourceRevisionId?: string
    } | null
    if (draftData?._sourceRevisionId) {
        return draftData._sourceRevisionId
    }

    // PRIORITY 3: Try to extract from the ID format (local-{sourceId}-{timestamp})
    // BUT only if the extracted ID looks like a UUID (contains hyphens and is not numeric-only)
    // This handles legacy format where the source ID was embedded in the draft ID
    const fromId = extractSourceIdFromDraft(draftId)
    if (fromId && !isLocalDraftId(fromId) && fromId.includes("-")) {
        return fromId
    }

    return null
}

/**
 * Recursively resolve a local draft ID to its root server revision ID.
 * This handles chained local drafts (draft created from another draft).
 *
 * @param id - The ID to resolve (can be a local draft or server revision)
 * @returns The root server revision ID, or null if unable to resolve
 */
function resolveRootSourceId(id: string): string | null {
    // If it's not a local draft, it's already a server revision ID
    if (!isLocalDraftId(id)) {
        return id
    }

    let currentId = id
    let iterations = 0
    const maxIterations = 10 // Prevent infinite loops

    while (isLocalDraftId(currentId) && iterations < maxIterations) {
        const nextSourceId = getImmediateSourceId(currentId)

        if (!nextSourceId) {
            // Can't find source, return null
            return null
        }

        currentId = nextSourceId
        iterations++
    }

    // Return null if we ended up at a local draft (couldn't resolve to server)
    if (isLocalDraftId(currentId)) {
        return null
    }

    return currentId
}

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
        // Use recursive resolution to get the root server revision ID
        // This handles chained local drafts (draft created from another draft)
        const rootSourceId = resolveRootSourceId(draftId)

        return rootSourceId
    },

    createLocalDraftWithPatch(sourceRevisionId: string, patch: RunnableDraftPatch): string | null {
        // Validate patch using Zod schema
        const parseResult = ossAppRevisionPatchSchema.safeParse(patch)
        if (!parseResult.success) {
            console.warn(
                "[OssAppRevisionSnapshotAdapter] Invalid patch format for createLocalDraftWithPatch:",
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
            const applied = applyOssAppRevisionDraftPatch(localDraftId, parseResult.data)

            if (!applied) {
                console.warn(
                    "[OssAppRevisionSnapshotAdapter] Failed to apply patch to new local draft:",
                    localDraftId,
                )
                // Still return the draft ID - it was created, just without the patch
            }

            return localDraftId
        } catch (error) {
            console.error(
                "[OssAppRevisionSnapshotAdapter] Failed to create local draft with patch:",
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
snapshotAdapterRegistry.register(ossAppRevisionSnapshotAdapter)
