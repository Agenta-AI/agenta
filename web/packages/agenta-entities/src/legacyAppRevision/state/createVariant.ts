/**
 * Create Variant Action
 *
 * Entity-level action for creating a new variant from a base revision.
 * Handles the full flow: parameter resolution → API call → query invalidation → poll.
 *
 * Playground-specific orchestration (selection swap, chat history, URL sync)
 * is handled via registered callbacks.
 */

import {axios, getAgentaApiUrl} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {atom, getDefaultStore} from "jotai"

import {isLocalDraftId} from "@agenta/entities/shared"

import type {LegacyAppRevisionData} from "../core"
import {buildLegacyAppRevisionDraftPatch} from "../snapshot"

import {waitForNewRevision} from "./commit"
import {invalidateEntityQueries} from "./invalidation"
import {
    legacyAppRevisionEntityWithBridgeAtomFamily,
    legacyAppRevisionDraftAtomFamily,
    variantsListAtomFamily,
} from "./store"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Parameters for creating a new variant.
 */
export interface CreateVariantParams {
    /** Base revision ID to fork from */
    baseRevisionId: string
    /** Name for the new variant */
    newVariantName: string
    /** Optional commit message */
    commitMessage?: string
    /** App ID (required for resolving baseId from variant list) */
    appId: string
}

/**
 * Result of a successful create-variant operation.
 */
export interface CreateVariantResult {
    success: true
    /** The new revision ID (after polling) */
    newRevisionId: string
    /** The new variant ID from the API response */
    newVariantId: string
    /** The base revision ID that was forked */
    baseRevisionId: string
}

/**
 * Result of a failed create-variant operation.
 */
export interface CreateVariantError {
    success: false
    error: Error
}

/**
 * Union result type.
 */
export type CreateVariantOutcome = CreateVariantResult | CreateVariantError

// ============================================================================
// CALLBACKS
// ============================================================================

/**
 * Callbacks for playground-specific orchestration during create-variant.
 */
export interface CreateVariantCallbacks {
    /**
     * Called after entity queries are invalidated.
     * Use to invalidate playground-specific or OSS-specific queries.
     */
    onQueryInvalidate?: () => Promise<void>

    /**
     * Called when the new variant's first revision is detected.
     * Use for selection swap, chat history duplication, URL sync, etc.
     */
    onNewVariant?: (result: CreateVariantResult, params: CreateVariantParams) => Promise<void>

    /**
     * Called on error.
     */
    onError?: (error: Error, params: CreateVariantParams) => void
}

let _createVariantCallbacks: CreateVariantCallbacks = {}

export function registerCreateVariantCallbacks(callbacks: CreateVariantCallbacks): void {
    _createVariantCallbacks = {..._createVariantCallbacks, ...callbacks}
}

export function clearCreateVariantCallbacks(): void {
    _createVariantCallbacks = {}
}

// ============================================================================
// HELPERS
// ============================================================================

type DataWithExtras = LegacyAppRevisionData & {
    _sourceVariantId?: string
    _baseId?: string
    baseId?: string
}

/**
 * Resolve the baseId for a revision, handling local drafts and variant list fallback.
 */
function resolveBaseId(revisionData: LegacyAppRevisionData, appId: string): string | undefined {
    const data = revisionData as DataWithExtras
    const store = getDefaultStore()

    // 1. For local drafts, use stored _baseId
    if (isLocalDraftId(revisionData.id)) {
        if (data._baseId) return data._baseId
    }

    // 2. Try the revision's own baseId
    if (data.baseId) return data.baseId

    // 3. Fall back to parent variant lookup
    const variantIdForLookup = isLocalDraftId(revisionData.id)
        ? (data._sourceVariantId ?? revisionData.variantId)
        : revisionData.variantId

    if (variantIdForLookup && appId) {
        try {
            const variants = store.get(variantsListAtomFamily(appId))
            const parentVariant = variants.find((v) => v.id === variantIdForLookup)
            if (parentVariant?.baseId) return parentVariant.baseId
        } catch {
            // Variant list not available
        }
    }

    return undefined
}

/**
 * Build ag_config parameters from entity data (merged server + draft).
 */
function buildAgConfig(revisionId: string): Record<string, unknown> | null {
    // Use the draft patch if available — returns raw parameters in ag_config format
    const patchResult = buildLegacyAppRevisionDraftPatch(revisionId)
    if (patchResult.hasDraft && patchResult.patch?.parameters) {
        return patchResult.patch.parameters
    }

    // No draft — use server data parameters directly
    const store = getDefaultStore()
    const entityData = store.get(legacyAppRevisionEntityWithBridgeAtomFamily(revisionId))
    if (!entityData) return null

    return entityData.parameters ?? null
}

// ============================================================================
// ACTION ATOM
// ============================================================================

/**
 * Create a new variant from a base revision.
 *
 * Entity-level flow:
 * 1. Resolve base revision data from molecule
 * 2. Build ag_config parameters
 * 3. Resolve baseId
 * 4. Call POST /variants/from-base API
 * 5. Invalidate entity queries
 * 6. Poll for new revision
 * 7. Invoke onNewVariant callback
 * 8. Clear draft state for source revision
 * 9. Return result with newRevisionId
 */
export const createVariantAtom = atom(
    null,
    async (get, set, params: CreateVariantParams): Promise<CreateVariantOutcome> => {
        const {baseRevisionId, newVariantName, commitMessage, appId} = params

        try {
            const projectId = get(projectIdAtom)
            if (!projectId) {
                throw new Error("No project ID available")
            }

            // 1. Resolve base revision data
            const baseRevisionData = get(
                legacyAppRevisionEntityWithBridgeAtomFamily(baseRevisionId),
            )
            if (!baseRevisionData) {
                throw new Error(`Base revision "${baseRevisionId}" not found in entity store`)
            }

            // 2. Build ag_config parameters
            const agConfig = buildAgConfig(baseRevisionId)

            // 3. Resolve baseId
            const resolvedBaseId = resolveBaseId(baseRevisionData, appId)
            if (!resolvedBaseId) {
                throw new Error(
                    `Missing baseId for revision ${baseRevisionId}; cannot create variant`,
                )
            }

            // 4. Call API
            const response = await axios.post(
                `${getAgentaApiUrl()}/variants/from-base`,
                {
                    base_id: resolvedBaseId,
                    new_variant_name: newVariantName,
                    new_config_name: newVariantName,
                    parameters: agConfig || {},
                    commit_message: commitMessage ?? "",
                },
                {
                    params: {project_id: projectId},
                },
            )

            const newVariantId = response.data?.variant_id || response.data?.variantId
            if (!newVariantId) {
                throw new Error("API did not return a variant ID")
            }

            // 5. Invalidate entity queries
            await invalidateEntityQueries()

            // 5b. Invoke additional query invalidation callback
            if (_createVariantCallbacks.onQueryInvalidate) {
                await _createVariantCallbacks.onQueryInvalidate()
            }

            // 6. Poll for new revision
            const {newestRevisionId} = await waitForNewRevision({
                variantId: newVariantId,
                prevRevisionId: null,
            })

            if (!newestRevisionId) {
                throw new Error("Failed to detect new revision after creating variant")
            }

            const result: CreateVariantResult = {
                success: true,
                newRevisionId: newestRevisionId,
                newVariantId,
                baseRevisionId,
            }

            // 7. Invoke callback for playground orchestration
            if (_createVariantCallbacks.onNewVariant) {
                await _createVariantCallbacks.onNewVariant(result, params)
            }

            // 8. Clear draft state for source revision
            set(legacyAppRevisionDraftAtomFamily(baseRevisionId), null)

            return result
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error))

            if (_createVariantCallbacks.onError) {
                _createVariantCallbacks.onError(err, params)
            }

            return {success: false, error: err}
        }
    },
)
