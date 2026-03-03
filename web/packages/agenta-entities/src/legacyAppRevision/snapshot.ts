/**
 * LegacyAppRevision Snapshot Helpers
 *
 * Provides utilities for creating and applying draft patches for URL snapshot sharing.
 * These helpers enable capturing the current state of a draft revision and restoring
 * it from a serialized patch.
 *
 * @example
 * ```typescript
 * import {
 *     buildLegacyAppRevisionDraftPatch,
 *     applyLegacyAppRevisionDraftPatch,
 *     type LegacyAppRevisionDraftPatch,
 * } from '@agenta/entities/legacyAppRevision'
 *
 * // Build a patch from current draft state
 * const patch = buildLegacyAppRevisionDraftPatch(revisionId)
 * // { parameters: {...} }
 *
 * // Apply a patch to create/update a draft
 * applyLegacyAppRevisionDraftPatch(revisionId, patch)
 * ```
 */

import {getDefaultStore} from "jotai/vanilla"

import {computeShallowDiff, applyShallowPatch} from "../runnable/snapshotDiff"

import type {LegacyAppRevisionData} from "./core"
import {
    legacyAppRevisionServerDataSelectorFamily,
    legacyAppRevisionDraftAtomFamily,
    legacyAppRevisionServerDataAtomFamily,
} from "./state/store"
import {stripVolatileKeys} from "./utils"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Patch representing the differences between a draft and its source revision.
 *
 * This is the minimal data needed to reconstruct a draft state from a committed revision.
 *
 * IMPORTANT: We only store raw parameters, NOT enhanced prompts/properties.
 * Enhanced data contains session-specific __id and __metadata values that won't
 * work across browser tabs. The entity system will derive enhanced data from
 * the raw parameters when the patch is applied.
 */
export interface LegacyAppRevisionDraftPatch {
    /** Raw parameters (ag_config) - the source of truth for all config data */
    parameters: Record<string, unknown>
}

/**
 * Result of building a draft patch
 */
export interface BuildPatchResult {
    /** Whether the revision has draft changes */
    hasDraft: boolean
    /** The patch data (null if no draft) */
    patch: LegacyAppRevisionDraftPatch | null
    /** Source revision ID */
    sourceRevisionId: string
}

// ============================================================================
// PATCH BUILDING
// ============================================================================

/**
 * Build a draft patch from the current state of a revision.
 *
 * This function compares the draft state with the server data and returns
 * the full parameters payload if there are changes. If there's no draft
 * or the draft matches server data, returns null.
 *
 * The patch contains the complete raw parameters (ag_config format), not
 * a minimal diff. Enhanced prompts/properties are converted back to raw
 * parameters before comparison and inclusion in the patch.
 *
 * @param revisionId - The revision ID to build a patch for
 * @returns BuildPatchResult with patch data or null if no draft exists or no changes
 *
 * @example
 * ```typescript
 * const result = buildLegacyAppRevisionDraftPatch('rev-123')
 * if (result.hasDraft && result.patch) {
 *     // Serialize patch for URL sharing
 *     const encoded = encodeSnapshot(result.patch)
 * }
 * ```
 */
export function buildLegacyAppRevisionDraftPatch(revisionId: string): BuildPatchResult {
    const store = getDefaultStore()

    // Get draft and server data
    const draft = store.get(legacyAppRevisionDraftAtomFamily(revisionId))
    const serverData = store.get(legacyAppRevisionServerDataSelectorFamily(revisionId))

    // No draft means no changes to capture
    if (!draft) {
        return {
            hasDraft: false,
            patch: null,
            sourceRevisionId: revisionId,
        }
    }

    const serverParams = serverData?.parameters ?? {}
    const draftParams = draft.parameters ?? {}

    // Compute shallow diff — only include top-level keys that actually changed.
    // Uses stripVolatileKeys as preprocessor so __id/__metadata don't cause
    // false positives, but the diff result contains original (unstripped) values.
    const diff = computeShallowDiff(draftParams, serverParams, {
        preprocess: (v) => stripVolatileKeys(v, true),
    })

    if (!diff) {
        return {
            hasDraft: false,
            patch: null,
            sourceRevisionId: revisionId,
        }
    }

    return {
        hasDraft: true,
        patch: {parameters: diff},
        sourceRevisionId: revisionId,
    }
}

// ============================================================================
// PATCH APPLICATION
// ============================================================================

/**
 * Apply a draft patch to a revision, creating or updating its draft state.
 *
 * This function takes a patch and applies it on top of the server data for
 * the given revision, creating a draft with the patched values.
 *
 * @param revisionId - The revision ID to apply the patch to
 * @param patch - The patch to apply
 * @returns true if patch was applied successfully, false if server data not available
 *
 * @example
 * ```typescript
 * // After decoding a snapshot from URL
 * const success = applyLegacyAppRevisionDraftPatch('rev-123', decodedPatch)
 * if (success) {
 *     // Draft is now set with patched values
 * }
 * ```
 */
export function applyLegacyAppRevisionDraftPatch(
    revisionId: string,
    patch: LegacyAppRevisionDraftPatch,
): boolean {
    const store = getDefaultStore()

    // Get server data as base
    const serverData = store.get(legacyAppRevisionServerDataSelectorFamily(revisionId))

    if (!serverData) {
        if (process.env.NODE_ENV !== "production") {
            console.warn("[applyDraftPatch] no serverData for", revisionId)
        }
        // Server data not available yet - cannot apply patch
        return false
    }

    // Check if this is an "empty" patch (used for local drafts with no changes)
    // Empty patch means: create a local copy using source parameters as-is
    const isEmptyPatch = !patch.parameters || Object.keys(patch.parameters).length === 0

    // Build draft by merging patched parameters onto server data.
    // Uses shallow merge so both full-params patches (old format) and
    // diff patches (new format with only changed keys) work correctly.
    const draft: LegacyAppRevisionData = {
        ...serverData,
        parameters: isEmptyPatch
            ? serverData.parameters
            : applyShallowPatch(serverData.parameters ?? {}, patch.parameters),
    }

    // Set the draft
    store.set(legacyAppRevisionDraftAtomFamily(revisionId), draft)

    return true
}

/**
 * Initialize server data for a revision if not already present.
 *
 * This is useful when hydrating from a snapshot - we may need to set up
 * the server data atom before applying a patch.
 *
 * @param revisionId - The revision ID
 * @param data - The server data to initialize with
 */
export function initializeServerData(revisionId: string, data: LegacyAppRevisionData): void {
    const store = getDefaultStore()
    const existing = store.get(legacyAppRevisionServerDataAtomFamily(revisionId))

    // Only set if not already present
    if (!existing) {
        store.set(legacyAppRevisionServerDataAtomFamily(revisionId), data)
    }
}

/**
 * Check if a revision has draft changes.
 *
 * Compares the draft's parameters against server parameters to determine
 * if there are actual changes, not just whether a draft exists.
 *
 * @param revisionId - The revision ID to check
 * @returns true if the revision has a draft with meaningful changes
 */
export function hasDraftChanges(revisionId: string): boolean {
    const store = getDefaultStore()
    const draft = store.get(legacyAppRevisionDraftAtomFamily(revisionId))

    if (!draft) {
        return false
    }

    const serverData = store.get(legacyAppRevisionServerDataSelectorFamily(revisionId))
    if (!serverData) {
        // No server data means this is a new entity with changes
        return true
    }

    const serverParams = serverData.parameters ?? {}
    const draftParams = draft.parameters ?? {}

    return (
        computeShallowDiff(draftParams, serverParams, {
            preprocess: (v) => stripVolatileKeys(v, true),
        }) !== null
    )
}
