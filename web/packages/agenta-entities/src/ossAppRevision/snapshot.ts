/**
 * OssAppRevision Snapshot Helpers
 *
 * Provides utilities for creating and applying draft patches for URL snapshot sharing.
 * These helpers enable capturing the current state of a draft revision and restoring
 * it from a serialized patch.
 *
 * @example
 * ```typescript
 * import {
 *     buildOssAppRevisionDraftPatch,
 *     applyOssAppRevisionDraftPatch,
 *     type OssAppRevisionDraftPatch,
 * } from '@agenta/entities/ossAppRevision'
 *
 * // Build a patch from current draft state
 * const patch = buildOssAppRevisionDraftPatch(revisionId)
 * // { parameters: {...} }
 *
 * // Apply a patch to create/update a draft
 * applyOssAppRevisionDraftPatch(revisionId, patch)
 * ```
 */

import {getDefaultStore} from "jotai/vanilla"

import type {OssAppRevisionData} from "./core"
import {
    ossAppRevisionServerDataSelectorFamily,
    ossAppRevisionDraftAtomFamily,
    ossAppRevisionServerDataAtomFamily,
} from "./state/store"
import {
    areParametersDifferent,
    enhancedPromptsToParameters,
    enhancedCustomPropertiesToParameters,
} from "./utils"

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
export interface OssAppRevisionDraftPatch {
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
    patch: OssAppRevisionDraftPatch | null
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
 * const result = buildOssAppRevisionDraftPatch('rev-123')
 * if (result.hasDraft && result.patch) {
 *     // Serialize patch for URL sharing
 *     const encoded = encodeSnapshot(result.patch)
 * }
 * ```
 */
export function buildOssAppRevisionDraftPatch(revisionId: string): BuildPatchResult {
    const store = getDefaultStore()

    // Get draft and server data
    const draft = store.get(ossAppRevisionDraftAtomFamily(revisionId))
    const serverData = store.get(ossAppRevisionServerDataSelectorFamily(revisionId))

    // No draft means no changes to capture
    if (!draft) {
        return {
            hasDraft: false,
            patch: null,
            sourceRevisionId: revisionId,
        }
    }

    // Start with draft parameters as base
    let draftParams = {...(draft.parameters ?? {})}
    const serverParams = serverData?.parameters ?? {}

    // If draft has enhanced prompts, convert them back to raw parameters
    if (draft.enhancedPrompts && Array.isArray(draft.enhancedPrompts)) {
        draftParams = enhancedPromptsToParameters(draft.enhancedPrompts, draftParams)
    }

    // If draft has enhanced custom properties, convert them back to raw parameters
    if (draft.enhancedCustomProperties && typeof draft.enhancedCustomProperties === "object") {
        draftParams = enhancedCustomPropertiesToParameters(
            draft.enhancedCustomProperties as Record<string, unknown>,
            draftParams,
        )
    }

    // Compare parameters to detect changes (preserves null values as meaningful)
    const hasChanges = areParametersDifferent({parameters: draftParams}, serverParams)

    if (!hasChanges) {
        return {
            hasDraft: false,
            patch: null,
            sourceRevisionId: revisionId,
        }
    }

    // Build patch with raw parameters only
    const patch: OssAppRevisionDraftPatch = {
        parameters: draftParams,
    }

    return {
        hasDraft: true,
        patch,
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
 * const success = applyOssAppRevisionDraftPatch('rev-123', decodedPatch)
 * if (success) {
 *     // Draft is now set with patched values
 * }
 * ```
 */
export function applyOssAppRevisionDraftPatch(
    revisionId: string,
    patch: OssAppRevisionDraftPatch,
): boolean {
    const store = getDefaultStore()

    // Get server data as base
    const serverData = store.get(ossAppRevisionServerDataSelectorFamily(revisionId))

    if (!serverData) {
        // Server data not available yet - cannot apply patch
        return false
    }

    // Build draft by applying patched parameters onto server data
    // IMPORTANT: We only patch parameters, NOT enhanced prompts/properties.
    // The entity system will derive enhanced data from the parameters.
    const draft: OssAppRevisionData = {
        ...serverData,
        parameters: patch.parameters,
        // Clear enhanced data so it gets re-derived from the new parameters
        enhancedPrompts: undefined,
        enhancedCustomProperties: undefined,
    }

    // Set the draft
    store.set(ossAppRevisionDraftAtomFamily(revisionId), draft)

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
export function initializeServerData(revisionId: string, data: OssAppRevisionData): void {
    const store = getDefaultStore()
    const existing = store.get(ossAppRevisionServerDataAtomFamily(revisionId))

    // Only set if not already present
    if (!existing) {
        store.set(ossAppRevisionServerDataAtomFamily(revisionId), data)
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
    const draft = store.get(ossAppRevisionDraftAtomFamily(revisionId))

    if (!draft) {
        return false
    }

    const serverData = store.get(ossAppRevisionServerDataSelectorFamily(revisionId))
    if (!serverData) {
        // No server data means this is a new entity with changes
        return true
    }

    // Convert enhanced data back to parameters for comparison
    let draftParams = {...(draft.parameters ?? {})}

    if (draft.enhancedPrompts && Array.isArray(draft.enhancedPrompts)) {
        draftParams = enhancedPromptsToParameters(draft.enhancedPrompts, draftParams)
    }

    if (draft.enhancedCustomProperties && typeof draft.enhancedCustomProperties === "object") {
        draftParams = enhancedCustomPropertiesToParameters(
            draft.enhancedCustomProperties as Record<string, unknown>,
            draftParams,
        )
    }

    const serverParams = serverData.parameters ?? {}

    // Use shared comparison that preserves null values
    return areParametersDifferent({parameters: draftParams}, serverParams)
}
