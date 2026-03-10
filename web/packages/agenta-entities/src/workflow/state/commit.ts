/**
 * Workflow Commit Module
 *
 * Provides commit/archive actions for workflow entities with callback
 * registration for playground-specific orchestration.
 *
 * Unlike legacyAppRevision, the workflow API returns new revision IDs
 * directly — no polling needed.
 *
 * @example
 * ```typescript
 * import { commitWorkflowRevisionAtom, registerWorkflowCommitCallbacks } from '@agenta/entities/workflow'
 *
 * registerWorkflowCommitCallbacks({
 *   onQueryInvalidate: async () => { ... },
 *   onNewRevision: async (result) => { ... },
 * })
 *
 * const result = await set(commitWorkflowRevisionAtom, {
 *   revisionId: currentId,
 *   commitMessage: 'Updated parameters',
 * })
 * ```
 */

import {projectIdAtom} from "@agenta/shared/state"
import {stripAgentaMetadataDeep} from "@agenta/shared/utils"
import {atom, getDefaultStore} from "jotai"

import {
    commitWorkflowRevisionApi,
    createWorkflowVariantApi,
    archiveWorkflowRevision,
    archiveWorkflowVariant,
    queryWorkflowRevisions,
} from "../api"
import type {Workflow} from "../core"

import {
    workflowEntityAtomFamily,
    discardWorkflowDraftAtom,
    invalidateWorkflowsListCache,
    invalidateWorkflowCache,
    invalidateWorkflowRevisionsByWorkflowCache,
} from "./store"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Parameters for committing a workflow revision
 */
export interface WorkflowCommitParams {
    /** Current revision ID */
    revisionId: string
    /** Commit message */
    commitMessage?: string
}

/**
 * Result of a successful commit
 */
export interface WorkflowCommitResult {
    success: true
    /** The source revision ID */
    revisionId: string
    /** The new revision ID */
    newRevisionId: string
    /** The new workflow data */
    workflow?: Workflow
}

/**
 * Result of a failed commit
 */
export interface WorkflowCommitError {
    success: false
    error: Error
}

export type WorkflowCommitOutcome = WorkflowCommitResult | WorkflowCommitError

/**
 * Parameters for archiving a workflow revision
 */
export interface WorkflowArchiveParams {
    /** Revision ID to archive */
    revisionId: string
    /** Workflow ID (parent workflow artifact) */
    workflowId: string
    /** Variant ID (parent variant) — when provided, the atom checks if the
     *  variant has remaining active revisions and archives it if empty. */
    variantId?: string
}

/**
 * Result of an archive operation
 */
export interface WorkflowArchiveResult {
    success: true
    revisionId: string
    workflowId: string
}

export interface WorkflowArchiveError {
    success: false
    error: Error
}

export type WorkflowArchiveOutcome = WorkflowArchiveResult | WorkflowArchiveError

// ============================================================================
// COMMIT CALLBACK REGISTRY
// ============================================================================

export interface WorkflowCommitCallbacks {
    onQueryInvalidate?: () => Promise<void>
    onNewRevision?: (result: WorkflowCommitResult, params: WorkflowCommitParams) => Promise<void>
    onError?: (error: Error, params: WorkflowCommitParams) => void
}

let _commitCallbacks: WorkflowCommitCallbacks = {}

export function registerWorkflowCommitCallbacks(callbacks: WorkflowCommitCallbacks): void {
    _commitCallbacks = {..._commitCallbacks, ...callbacks}
}

export function clearWorkflowCommitCallbacks(): void {
    _commitCallbacks = {}
}

// ============================================================================
// ARCHIVE CALLBACK REGISTRY
// ============================================================================

export interface WorkflowArchiveCallbacks {
    onQueryInvalidate?: () => Promise<void>
    onRevisionDeleted?: (result: WorkflowArchiveResult) => Promise<void>
    onError?: (error: Error, params: WorkflowArchiveParams) => void
}

let _archiveCallbacks: WorkflowArchiveCallbacks = {}

export function registerWorkflowArchiveCallbacks(callbacks: WorkflowArchiveCallbacks): void {
    _archiveCallbacks = {..._archiveCallbacks, ...callbacks}
}

export function clearWorkflowArchiveCallbacks(): void {
    _archiveCallbacks = {}
}

// ============================================================================
// COMMIT ATOM
// ============================================================================

/**
 * Commit a workflow revision to create a new version.
 *
 * Flow:
 * 1. Read merged entity data (server + draft)
 * 2. Call updateWorkflow API (returns new revision directly)
 * 3. Invalidate caches
 * 4. Invoke callbacks
 * 5. Discard draft
 */
export const commitWorkflowRevisionAtom = atom(
    null,
    async (get, set, params: WorkflowCommitParams): Promise<WorkflowCommitOutcome> => {
        const {revisionId, commitMessage: _commitMessage} = params

        try {
            const projectId = get(projectIdAtom)
            if (!projectId) {
                throw new Error("No project ID available")
            }

            // 1. Read merged entity data
            const entity = get(workflowEntityAtomFamily(revisionId))
            if (!entity) {
                throw new Error(`No workflow entity found for ${revisionId}`)
            }

            // 2. Call the revision commit endpoint directly.
            // We do NOT use `updateWorkflow` here — that function also fires a
            // `PUT /preview/workflows/{id}` for metadata edits, which overwrites
            // the artifact's `flags` with null and causes the app to vanish from
            // the apps list.
            const workflowId = entity.workflow_id ?? entity.id
            const variantId = entity.workflow_variant_id ?? entity.variant_id

            if (!entity.data) {
                throw new Error("Cannot commit workflow: no data to commit")
            }

            const newWorkflow = await commitWorkflowRevisionApi(projectId, {
                workflowId,
                variantId: variantId ?? undefined,
                name: entity.name ?? undefined,
                flags: entity.flags ?? undefined,
                message: _commitMessage ?? undefined,
                data: {
                    uri: entity.data.uri,
                    url: entity.data.url,
                    parameters: stripAgentaMetadataDeep(entity.data.parameters),
                    schemas: entity.data.schemas,
                },
            })

            const newRevisionId = newWorkflow.id

            const result: WorkflowCommitResult = {
                success: true,
                revisionId,
                newRevisionId,
                workflow: newWorkflow,
            }

            // 3. Invoke new revision callback (entity switch — must happen
            // before returning so the UI shows the correct entity)
            if (_commitCallbacks.onNewRevision) {
                await _commitCallbacks.onNewRevision(result, params)
            }

            // 4. Discard draft
            set(discardWorkflowDraftAtom, revisionId)

            // 5. Invalidate caches in the background so the caller (modal)
            // isn't blocked by network refetches.
            invalidateWorkflowsListCache()
            invalidateWorkflowCache(revisionId)
            invalidateWorkflowRevisionsByWorkflowCache(workflowId)
            if (_commitCallbacks.onQueryInvalidate) {
                void _commitCallbacks.onQueryInvalidate()
            }

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
// CREATE VARIANT ATOM
// ============================================================================

/**
 * Parameters for creating a new workflow variant
 */
export interface WorkflowCreateVariantParams {
    /** Source revision ID (to copy data from) */
    baseRevisionId: string
    /** Name for the new variant */
    newVariantName: string
    /** Commit message for the first revision */
    commitMessage?: string
}

/**
 * Result of a successful variant creation
 */
export interface WorkflowCreateVariantResult {
    success: true
    /** The new revision ID (first revision under the new variant) */
    newRevisionId: string
    /** The new variant ID */
    newVariantId: string
}

export interface WorkflowCreateVariantError {
    success: false
    error: Error
}

export type WorkflowCreateVariantOutcome = WorkflowCreateVariantResult | WorkflowCreateVariantError

/**
 * Create a new workflow variant and commit its first revision with the
 * current entity data.
 *
 * Flow:
 * 1. Read the source entity data (server + draft)
 * 2. Create a new variant via `POST /preview/workflows/variants/`
 * 3. Commit first revision under the new variant via `POST /preview/workflows/revisions/commit`
 * 4. Invalidate caches
 * 5. Invoke callbacks (reuses commit callbacks for query invalidation and switch)
 */
export const createWorkflowVariantAtom = atom(
    null,
    async (
        get,
        set,
        params: WorkflowCreateVariantParams,
    ): Promise<WorkflowCreateVariantOutcome> => {
        const {baseRevisionId, newVariantName, commitMessage} = params

        try {
            const projectId = get(projectIdAtom)
            if (!projectId) {
                throw new Error("No project ID available")
            }

            // 1. Read the source entity data
            const entity = get(workflowEntityAtomFamily(baseRevisionId))
            if (!entity) {
                throw new Error(`No workflow entity found for ${baseRevisionId}`)
            }

            const workflowId = entity.workflow_id ?? entity.id
            if (!entity.data) {
                throw new Error("Cannot create variant: no data to carry over")
            }

            // 2. Create the new variant
            const slug = newVariantName.toLowerCase().replace(/[^a-z0-9_-]/g, "_")
            const newVariant = await createWorkflowVariantApi(projectId, {
                workflowId,
                slug,
                name: newVariantName,
            })

            if (!newVariant?.id) {
                throw new Error("Failed to create workflow variant")
            }

            // 3. Commit seed revision (v0) — matches legacy behavior where
            //    fork always creates v0 + v1 so the user-visible first version is v1
            await commitWorkflowRevisionApi(projectId, {
                workflowId,
                variantId: newVariant.id,
                name: newVariantName,
                flags: entity.flags ?? undefined,
                data: {
                    uri: entity.data.uri,
                    url: entity.data.url,
                },
            })

            // 4. Commit actual data revision (v1) with full parameters
            const newRevision = await commitWorkflowRevisionApi(projectId, {
                workflowId,
                variantId: newVariant.id,
                name: newVariantName,
                flags: entity.flags ?? undefined,
                message: commitMessage,
                data: {
                    uri: entity.data.uri,
                    url: entity.data.url,
                    parameters: stripAgentaMetadataDeep(entity.data.parameters),
                    schemas: entity.data.schemas,
                },
            })

            const newRevisionId = newRevision.id

            // 5. Invoke new revision callback (entity switch — must happen
            // before returning so the UI shows the correct entity)
            const commitResult: WorkflowCommitResult = {
                success: true,
                revisionId: baseRevisionId,
                newRevisionId,
                workflow: newRevision,
            }
            if (_commitCallbacks.onNewRevision) {
                await _commitCallbacks.onNewRevision(commitResult, {
                    revisionId: baseRevisionId,
                    commitMessage,
                })
            }

            // Discard draft for the base revision
            set(discardWorkflowDraftAtom, baseRevisionId)

            // 6. Invalidate caches in the background so the caller (modal)
            // isn't blocked by network refetches.
            invalidateWorkflowsListCache()
            invalidateWorkflowCache(baseRevisionId)
            invalidateWorkflowRevisionsByWorkflowCache(workflowId)
            if (_commitCallbacks.onQueryInvalidate) {
                void _commitCallbacks.onQueryInvalidate()
            }

            return {
                success: true,
                newRevisionId,
                newVariantId: newVariant.id,
            }
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error))
            return {
                success: false,
                error: err,
            }
        }
    },
)

// ============================================================================
// ARCHIVE ATOM
// ============================================================================

/**
 * Archive a single workflow revision.
 *
 * Uses `POST /preview/workflows/revisions/{revision_id}/archive` to archive
 * only the specified revision — NOT the entire workflow artifact.
 */
export const archiveWorkflowRevisionAtom = atom(
    null,
    async (get, _set, params: WorkflowArchiveParams): Promise<WorkflowArchiveOutcome> => {
        const {revisionId, workflowId, variantId} = params

        try {
            const projectId = get(projectIdAtom)
            if (!projectId) {
                throw new Error("No project ID available")
            }

            const _t0 = performance.now()
            await archiveWorkflowRevision(projectId, revisionId)
            console.log(`[archive] API call: ${(performance.now() - _t0).toFixed(0)}ms`)

            // When variantId is provided, check if the variant still has
            // active (non-archived) revisions. If not, archive the variant
            // so it no longer appears in the entity selector dropdown.
            if (variantId) {
                try {
                    const _t1 = performance.now()
                    const remaining = await queryWorkflowRevisions(variantId, projectId)
                    console.log(
                        `[archive] queryWorkflowRevisions: ${(performance.now() - _t1).toFixed(0)}ms`,
                    )
                    const allRevisions = remaining.workflow_revisions ?? []
                    const activeRevisions = allRevisions.filter(
                        (r) => !r.deleted_at && r.id !== revisionId,
                    )
                    // Check if remaining revisions are only seed commits (v0)
                    // with no parameters — these are invisible to the user.
                    const userVisibleRevisions = activeRevisions.filter(
                        (r) => r.data?.parameters && Object.keys(r.data.parameters).length > 0,
                    )
                    if (userVisibleRevisions.length === 0) {
                        const _t2 = performance.now()
                        // Archive leftover seed revisions first
                        for (const r of activeRevisions) {
                            await archiveWorkflowRevision(projectId, r.id)
                        }
                        // Then archive the now-empty variant
                        await archiveWorkflowVariant(projectId, variantId)
                        console.log(
                            `[archive] variant cleanup: ${(performance.now() - _t2).toFixed(0)}ms`,
                        )
                    }
                } catch (_variantErr) {
                    // Best-effort: don't fail the overall delete if variant cleanup fails
                }
            }

            const result: WorkflowArchiveResult = {
                success: true,
                revisionId,
                workflowId,
            }

            const _t3 = performance.now()
            invalidateWorkflowsListCache()
            invalidateWorkflowRevisionsByWorkflowCache(workflowId)
            invalidateWorkflowCache(revisionId)
            console.log(
                `[archive] sync cache invalidation: ${(performance.now() - _t3).toFixed(0)}ms`,
            )

            if (_archiveCallbacks.onQueryInvalidate) {
                const _t4 = performance.now()
                await _archiveCallbacks.onQueryInvalidate()
                console.log(
                    `[archive] onQueryInvalidate callback: ${(performance.now() - _t4).toFixed(0)}ms`,
                )
            }

            // Await selection cleanup so the replacement revision is in place
            // before the caller (delete modal) closes — prevents an empty
            // playground flash.
            if (_archiveCallbacks.onRevisionDeleted) {
                await _archiveCallbacks.onRevisionDeleted(result)
            }

            console.log(`[archive] TOTAL: ${(performance.now() - _t0).toFixed(0)}ms`)
            return result
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error))

            if (_archiveCallbacks.onError) {
                _archiveCallbacks.onError(err, params)
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

export async function commitWorkflowRevision(
    params: WorkflowCommitParams,
): Promise<WorkflowCommitOutcome> {
    const store = getDefaultStore()
    return store.set(commitWorkflowRevisionAtom, params)
}
