/**
 * Source Revision Resolution Utilities
 *
 * Shared helpers for resolving local draft IDs to their root server revision IDs.
 * Used by both the snapshot adapter and local drafts module.
 *
 * @packageDocumentation
 */

import {getDefaultStore} from "jotai/vanilla"

import {isLocalDraftId, extractSourceIdFromDraft} from "../../shared/utils/revisionLabel"
import {
    legacyAppRevisionDraftAtomFamily,
    legacyAppRevisionServerDataAtomFamily,
} from "../state/store"

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get the immediate source revision ID from a local draft.
 *
 * Checks three sources in priority order:
 * 1. Server data `_sourceRevisionId` (most reliable, set by createLocalDraftFromRevision)
 * 2. Draft data `_sourceRevisionId` (fallback for drafts with pending writes)
 * 3. ID format extraction (legacy format: local-{sourceId}-{timestamp})
 *
 * This may return another local draft ID if the draft was created from another draft.
 *
 * @param draftId - A local draft ID to look up
 * @returns The immediate source revision ID, or null if not found / not a local draft
 */
export function getImmediateSourceId(draftId: string): string | null {
    if (!isLocalDraftId(draftId)) {
        return null
    }

    const store = getDefaultStore()

    // PRIORITY 1: Check stored data for _sourceRevisionId
    // This is the most reliable source as createLocalDraftFromRevision stores it here
    const serverData = store.get(legacyAppRevisionServerDataAtomFamily(draftId)) as {
        _sourceRevisionId?: string
    } | null
    if (serverData?._sourceRevisionId) {
        return serverData._sourceRevisionId
    }

    // PRIORITY 2: Check draft atom
    const draftData = store.get(legacyAppRevisionDraftAtomFamily(draftId)) as {
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
export function resolveRootSourceId(id: string): string | null {
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
