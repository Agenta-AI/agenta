/**
 * OSS App Revision Commit Module
 *
 * LEGACY ABSTRACTION - This module encapsulates the workaround for the legacy API
 * that doesn't return new revision IDs after commit. It will be removed when
 * migrating to the new appRevision entity.
 *
 * ## The Problem
 *
 * The legacy `PUT /variants/{variantId}/parameters` endpoint:
 * 1. Creates a new revision as a side effect
 * 2. Does NOT return the new revision ID
 * 3. Forces us to poll for the new revision to appear
 *
 * ## This Abstraction
 *
 * Provides a clean `commitRevision` action that:
 * 1. Calls the legacy API
 * 2. Invalidates queries
 * 3. Waits for the new revision to appear (via polling)
 * 4. Returns `{newRevisionId, newRevision}` like a proper API would
 *
 * ## Usage
 *
 * ```typescript
 * import { commitRevisionAtom, registerCommitCallbacks } from '@agenta/entities/legacyAppRevision'
 *
 * // Optional: Register callbacks for playground-specific orchestration
 * registerCommitCallbacks({
 *   onQueryInvalidate: async () => {
 *     // Invalidate playground-specific queries
 *   },
 *   onNewRevision: async (result) => {
 *     // Update selected variants, duplicate chat history, etc.
 *   },
 * })
 *
 * // Commit a revision
 * const result = await set(commitRevisionAtom, {
 *   revisionId: 'current-revision-id',
 *   parameters: { ag_config: {...} },
 *   commitMessage: 'My changes',
 * })
 *
 * if (result.success) {
 *   console.log('New revision:', result.newRevisionId)
 * }
 * ```
 *
 * @packageDocumentation
 */

import {axios, getAgentaApiUrl} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {atom, getDefaultStore} from "jotai"
import {atomFamily} from "jotai/utils"

import type {OssAppRevisionData} from "../core"

import {
    revisionsListAtomFamily,
    ossAppRevisionDraftAtomFamily,
    ossAppRevisionServerDataAtomFamily,
} from "./store"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Parameters for committing a revision
 */
export interface CommitRevisionParams {
    /** Current revision ID (or local draft ID) */
    revisionId: string
    /** Parameters to save (ag_config format) */
    parameters: Record<string, unknown>
    /** Commit message */
    commitMessage?: string
    /** Variant ID (required for API call) */
    variantId: string
}

/**
 * Result of a successful commit
 */
export interface CommitRevisionResult {
    success: true
    /** The new revision ID */
    newRevisionId: string
    /** The new revision number */
    newRevision: number
    /** Full revision data if available */
    revisionData?: OssAppRevisionData
}

/**
 * Result of a failed commit
 */
export interface CommitRevisionError {
    success: false
    error: Error
}

/**
 * Commit result union type
 */
export type CommitResult = CommitRevisionResult | CommitRevisionError

/**
 * Callbacks for playground-specific orchestration.
 * These are optional and allow the playground layer to hook into the commit flow
 * without polluting the entity layer.
 */
export interface CommitCallbacks {
    /**
     * Called after API mutation, before waiting for new revision.
     * Use to invalidate playground-specific queries.
     */
    onQueryInvalidate?: () => Promise<void>

    /**
     * Called when new revision is detected.
     * Use for playground-specific state updates (selected variants, chat history, etc.)
     */
    onNewRevision?: (result: CommitRevisionResult, params: CommitRevisionParams) => Promise<void>

    /**
     * Called on any error during commit.
     */
    onError?: (error: Error, params: CommitRevisionParams) => void
}

// ============================================================================
// CALLBACK REGISTRY
// ============================================================================

let _commitCallbacks: CommitCallbacks = {}

/**
 * Register callbacks for commit orchestration.
 *
 * This allows the playground layer to hook into commit flow without
 * the entity layer depending on playground-specific code.
 *
 * @example
 * ```typescript
 * // In playground initialization
 * registerCommitCallbacks({
 *   onQueryInvalidate: async () => {
 *     await set(invalidatePlaygroundQueriesAtom)
 *   },
 *   onNewRevision: async (result, params) => {
 *     // Update selected variants state
 *     // Duplicate chat history
 *   },
 * })
 * ```
 */
export function registerCommitCallbacks(callbacks: CommitCallbacks): void {
    _commitCallbacks = {..._commitCallbacks, ...callbacks}
}

/**
 * Clear registered callbacks (for testing)
 */
export function clearCommitCallbacks(): void {
    _commitCallbacks = {}
}

// ============================================================================
// POLLING UTILITIES
// ============================================================================

/**
 * Selector for newest revision in a variant's revision list
 */
export const newestRevisionForVariantAtomFamily = atomFamily((variantId: string) =>
    atom((get) => {
        const revisions = get(revisionsListAtomFamily(variantId))
        if (!revisions || revisions.length === 0) return null

        return revisions.reduce((newest, current) => {
            const newestRev = newest?.revision ?? 0
            const currentRev = current?.revision ?? 0
            return currentRev > newestRev ? current : newest
        }, revisions[0])
    }),
)

/**
 * Wait for a new revision to appear in the revision list.
 *
 * This is the core workaround for the API not returning new revision IDs.
 * Polls the revision list until a revision different from prevRevisionId appears.
 *
 * @internal
 */
async function waitForNewRevision(params: {
    variantId: string
    prevRevisionId: string | null
    timeoutMs?: number
    pollIntervalMs?: number
}): Promise<{newestRevisionId: string | null; newestRevision: number | null}> {
    const {variantId, prevRevisionId, timeoutMs = 15_000, pollIntervalMs = 250} = params
    const store = getDefaultStore()

    if (!variantId) {
        return {newestRevisionId: null, newestRevision: null}
    }

    return new Promise((resolve) => {
        let intervalId: ReturnType<typeof setInterval> | null = null
        let timeoutId: ReturnType<typeof setTimeout> | null = null

        const cleanup = () => {
            if (intervalId) clearInterval(intervalId)
            if (timeoutId) clearTimeout(timeoutId)
        }

        const check = () => {
            const newest = store.get(newestRevisionForVariantAtomFamily(variantId))
            const newestId = newest?.id ?? null
            const newestRev = newest?.revision ?? null

            if (!newestId) return

            // If we have a new revision (different from previous), resolve
            if (!prevRevisionId || newestId !== prevRevisionId) {
                cleanup()
                resolve({newestRevisionId: newestId, newestRevision: newestRev})
            }
        }

        // Set up polling
        intervalId = setInterval(check, pollIntervalMs)

        // Set up timeout (best-effort: return whatever is newest)
        timeoutId = setTimeout(() => {
            cleanup()
            const newest = store.get(newestRevisionForVariantAtomFamily(variantId))
            resolve({
                newestRevisionId: newest?.id ?? null,
                newestRevision: newest?.revision ?? null,
            })
        }, timeoutMs)

        // Check immediately in case it's already updated
        check()
    })
}

// ============================================================================
// COMMIT ATOM
// ============================================================================

/**
 * Commit a revision to create a new version.
 *
 * This atom encapsulates the full commit flow:
 * 1. Call legacy API (PUT /variants/{variantId}/parameters)
 * 2. Invoke onQueryInvalidate callback
 * 3. Wait for new revision to appear via polling
 * 4. Invoke onNewRevision callback
 * 5. Clear draft state
 * 6. Return clean result with newRevisionId
 *
 * @example
 * ```typescript
 * const result = await set(commitRevisionAtom, {
 *   revisionId: currentRevisionId,
 *   variantId,
 *   parameters: { ag_config: {...} },
 *   commitMessage: 'Updated prompts',
 * })
 *
 * if (result.success) {
 *   console.log('Created revision:', result.newRevisionId)
 * }
 * ```
 */
export const commitRevisionAtom = atom(
    null,
    async (get, set, params: CommitRevisionParams): Promise<CommitResult> => {
        const {revisionId, variantId, parameters, commitMessage} = params

        try {
            const projectId = get(projectIdAtom)
            if (!projectId) {
                throw new Error("No project ID available")
            }

            // 1. Call legacy API
            // The API expects parameters in ag_config format
            const apiParams = parameters.ag_config ?? parameters

            await axios.put(
                `${getAgentaApiUrl()}/variants/${variantId}/parameters`,
                {
                    parameters: apiParams,
                    commit_message: commitMessage ?? "",
                },
                {
                    params: {project_id: projectId},
                },
            )

            // 2. Invoke query invalidation callback
            // This allows playground to invalidate its TanStack Query caches
            if (_commitCallbacks.onQueryInvalidate) {
                await _commitCallbacks.onQueryInvalidate()
            }

            // 3. Wait for new revision to appear
            // This is the workaround for API not returning new revision ID
            const {newestRevisionId, newestRevision} = await waitForNewRevision({
                variantId,
                prevRevisionId: revisionId,
                timeoutMs: 15_000,
            })

            if (!newestRevisionId || !newestRevision) {
                throw new Error("Failed to detect new revision after commit")
            }

            const result: CommitRevisionResult = {
                success: true,
                newRevisionId: newestRevisionId,
                newRevision: newestRevision,
            }

            // 4. Invoke new revision callback
            // This allows playground to update selected variants, duplicate chat history, etc.
            if (_commitCallbacks.onNewRevision) {
                await _commitCallbacks.onNewRevision(result, params)
            }

            // 5. Clear draft state for the old revision
            set(ossAppRevisionDraftAtomFamily(revisionId), null)
            set(ossAppRevisionServerDataAtomFamily(revisionId), null)

            return result
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error))

            if (_commitCallbacks.onError) {
                _commitCallbacks.onError(err, params)
            }

            return {
                success: false,
                error: err,
            }
        }
    },
)

// ============================================================================
// IMPERATIVE API
// ============================================================================

/**
 * Commit a revision imperatively (for use in callbacks).
 *
 * @example
 * ```typescript
 * const result = await commitRevision({
 *   revisionId: currentRevisionId,
 *   variantId,
 *   parameters: { ag_config: {...} },
 *   commitMessage: 'Updated prompts',
 * })
 * ```
 */
export async function commitRevision(params: CommitRevisionParams): Promise<CommitResult> {
    const store = getDefaultStore()
    return store.set(commitRevisionAtom, params)
}
