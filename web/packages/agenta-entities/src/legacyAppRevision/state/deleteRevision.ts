/**
 * Delete Revision Action
 *
 * Entity-level action for deleting a single revision.
 * Handles: API call → query invalidation → result.
 *
 * Playground-specific orchestration (selection update, drawer state, URL sync)
 * is handled via registered callbacks.
 */

import {axios, getAgentaApiUrl} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"

import {invalidateEntityQueries} from "./invalidation"
import {legacyAppRevisionEntityWithBridgeAtomFamily} from "./store"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Parameters for deleting a revision.
 */
export interface DeleteRevisionParams {
    /** The revision ID to delete */
    revisionId: string
}

/**
 * Result of a successful delete operation.
 */
export interface DeleteRevisionResult {
    success: true
    /** The deleted revision ID */
    revisionId: string
    /** The variant ID the revision belonged to */
    variantId: string
}

/**
 * Result of a failed delete operation.
 */
export interface DeleteRevisionError {
    success: false
    error: Error
}

/**
 * Union result type.
 */
export type DeleteRevisionOutcome = DeleteRevisionResult | DeleteRevisionError

// ============================================================================
// CALLBACKS
// ============================================================================

/**
 * Callbacks for playground-specific orchestration during delete.
 */
export interface DeleteRevisionCallbacks {
    /**
     * Called after entity queries are invalidated.
     * Use to invalidate playground-specific or OSS-specific queries.
     */
    onQueryInvalidate?: () => Promise<void>

    /**
     * Called after the revision is successfully deleted and queries invalidated.
     * Use for selection update, drawer state, URL sync, etc.
     */
    onRevisionDeleted?: (
        result: DeleteRevisionResult,
        params: DeleteRevisionParams,
    ) => Promise<void>

    /**
     * Called on error.
     */
    onError?: (error: Error, params: DeleteRevisionParams) => void
}

let _deleteRevisionCallbacks: DeleteRevisionCallbacks = {}

export function registerDeleteRevisionCallbacks(callbacks: DeleteRevisionCallbacks): void {
    _deleteRevisionCallbacks = {..._deleteRevisionCallbacks, ...callbacks}
}

export function clearDeleteRevisionCallbacks(): void {
    _deleteRevisionCallbacks = {}
}

// ============================================================================
// ACTION ATOM
// ============================================================================

/**
 * Delete a single revision.
 *
 * Entity-level flow:
 * 1. Resolve revision data to get variantId
 * 2. Call DELETE /variants/{variantId}/revisions/{revisionId}/
 * 3. Invalidate entity queries
 * 4. Invoke onRevisionDeleted callback
 * 5. Return result
 */
export const deleteRevisionAtom = atom(
    null,
    async (get, _set, params: DeleteRevisionParams): Promise<DeleteRevisionOutcome> => {
        const {revisionId} = params

        try {
            const projectId = get(projectIdAtom)
            if (!projectId) {
                throw new Error("No project ID available")
            }

            // 1. Resolve revision data to get variantId
            const revisionData = get(legacyAppRevisionEntityWithBridgeAtomFamily(revisionId))
            if (!revisionData) {
                throw new Error(`Revision "${revisionId}" not found in entity store`)
            }

            const variantId = revisionData.variantId
            if (!variantId) {
                throw new Error(`Revision "${revisionId}" has no variantId`)
            }

            // 2. Call API
            await axios.delete(
                `${getAgentaApiUrl()}/variants/${variantId}/revisions/${revisionId}/`,
                {params: {project_id: projectId}},
            )

            // 3. Invalidate entity queries
            await invalidateEntityQueries()

            // 3b. Invoke additional query invalidation callback
            if (_deleteRevisionCallbacks.onQueryInvalidate) {
                await _deleteRevisionCallbacks.onQueryInvalidate()
            }

            const result: DeleteRevisionResult = {
                success: true,
                revisionId,
                variantId,
            }

            // 4. Invoke callback for playground orchestration
            if (_deleteRevisionCallbacks.onRevisionDeleted) {
                await _deleteRevisionCallbacks.onRevisionDeleted(result, params)
            }

            return result
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error))

            if (_deleteRevisionCallbacks.onError) {
                _deleteRevisionCallbacks.onError(err, params)
            }

            return {success: false, error: err}
        }
    },
)
