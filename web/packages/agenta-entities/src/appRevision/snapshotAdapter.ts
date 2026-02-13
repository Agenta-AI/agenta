/**
 * AppRevision Snapshot Adapter
 *
 * Implements the RunnableSnapshotAdapter interface for AppRevision entities.
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

import type {AppRevisionData} from "./core"
import {appRevisionDraftAtomFamily, appRevisionQueryAtomFamily} from "./state/store"

// ============================================================================
// PATCH VALIDATION SCHEMA
// ============================================================================

/**
 * Zod schema for validating AppRevision draft patches.
 */
const appRevisionPatchSchema = z.object({
    agConfig: z.record(z.string(), z.unknown()),
    prompts: z.array(z.unknown()).optional(),
})

// ============================================================================
// TYPES
// ============================================================================

/**
 * Patch representing the differences between a draft and its source revision.
 *
 * For AppRevision, we store the full agConfig since that's the primary
 * configuration data that gets edited.
 */
export interface AppRevisionDraftPatch {
    /** The agConfig containing prompt configuration */
    agConfig: Record<string, unknown>
    /** Optional: prompts array if present */
    prompts?: unknown[]
    /** Allow additional properties for extensibility */
    [key: string]: unknown
}

// ============================================================================
// PATCH BUILDING
// ============================================================================

/**
 * Build a draft patch from the current state of an AppRevision.
 *
 * Compares draft state with server data and returns the patch if there are changes.
 *
 * @param revisionId - The revision ID to build a patch for
 * @returns BuildDraftPatchResult with patch data or null
 */
export function buildAppRevisionDraftPatch(revisionId: string): BuildDraftPatchResult {
    const store = getDefaultStore()

    // Get draft and server data
    const draft = store.get(appRevisionDraftAtomFamily(revisionId))
    const queryState = store.get(appRevisionQueryAtomFamily(revisionId))
    const serverData = queryState.data

    // No draft means no changes to capture
    if (!draft) {
        return {
            hasDraft: false,
            patch: null,
            sourceRevisionId: revisionId,
        }
    }

    // Compare draft with server data
    const hasChanges = JSON.stringify(draft) !== JSON.stringify(serverData)

    if (!hasChanges) {
        return {
            hasDraft: false,
            patch: null,
            sourceRevisionId: revisionId,
        }
    }

    // Build patch with relevant fields
    const patch: AppRevisionDraftPatch = {
        agConfig: (draft.agConfig as Record<string, unknown>) ?? {},
    }

    // Include prompts if present
    if (draft.prompts) {
        patch.prompts = draft.prompts
    }

    return {
        hasDraft: true,
        patch: patch as RunnableDraftPatch,
        sourceRevisionId: revisionId,
    }
}

// ============================================================================
// PATCH APPLICATION
// ============================================================================

/**
 * Apply a draft patch to an AppRevision, creating or updating its draft state.
 *
 * @param revisionId - The revision ID to apply the patch to
 * @param patch - The patch to apply
 * @returns true if patch was applied successfully, false if server data not available
 */
export function applyAppRevisionDraftPatch(
    revisionId: string,
    patch: AppRevisionDraftPatch,
): boolean {
    const store = getDefaultStore()

    // Get server data as base
    const queryState = store.get(appRevisionQueryAtomFamily(revisionId))
    const serverData = queryState.data

    if (!serverData) {
        // Server data not available yet - cannot apply patch
        return false
    }

    // Build draft by applying patched fields onto server data
    const draft: AppRevisionData = {
        ...serverData,
        agConfig: patch.agConfig,
    }

    // Apply prompts if present in patch
    if (patch.prompts) {
        draft.prompts = patch.prompts as AppRevisionData["prompts"]
    }

    // Set the draft
    store.set(appRevisionDraftAtomFamily(revisionId), draft)

    return true
}

// ============================================================================
// ADAPTER IMPLEMENTATION
// ============================================================================

/**
 * Snapshot adapter for AppRevision entities.
 *
 * Provides snapshot operations (build/apply patch, draft detection) for
 * the AppRevision entity type.
 */
export const appRevisionSnapshotAdapter: RunnableSnapshotAdapter = {
    type: "appRevision",

    buildDraftPatch(revisionId: string): BuildDraftPatchResult {
        return buildAppRevisionDraftPatch(revisionId)
    },

    applyDraftPatch(revisionId: string, patch: RunnableDraftPatch): boolean {
        // Validate patch using Zod schema
        const parseResult = appRevisionPatchSchema.safeParse(patch)
        if (!parseResult.success) {
            console.warn(
                "[AppRevisionSnapshotAdapter] Invalid patch format:",
                parseResult.error.message,
            )
            return false
        }

        return applyAppRevisionDraftPatch(revisionId, parseResult.data as AppRevisionDraftPatch)
    },

    getDraft(revisionId: string): unknown | null {
        const store = getDefaultStore()
        return store.get(appRevisionDraftAtomFamily(revisionId)) ?? null
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
snapshotAdapterRegistry.register(appRevisionSnapshotAdapter)
