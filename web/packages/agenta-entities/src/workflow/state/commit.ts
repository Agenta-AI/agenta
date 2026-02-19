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
import {atom, getDefaultStore} from "jotai"

import {updateWorkflow, archiveWorkflow} from "../api"
import type {Workflow} from "../core"

import {
    workflowEntityAtomFamily,
    discardWorkflowDraftAtom,
    invalidateWorkflowsListCache,
    invalidateWorkflowCache,
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
    /** Workflow ID (parent workflow) */
    workflowId: string
}

/**
 * Result of an archive operation
 */
export interface WorkflowArchiveResult {
    success: true
    revisionId: string
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

            // 2. Call API — updateWorkflow handles both metadata + data commit
            const workflowId = entity.workflow_id ?? entity.id
            const newWorkflow = await updateWorkflow(projectId, {
                id: workflowId,
                data: entity.data
                    ? {
                          uri: entity.data.uri,
                          url: entity.data.url,
                          parameters: entity.data.parameters,
                          schemas: entity.data.schemas,
                      }
                    : null,
            })

            const newRevisionId = newWorkflow.id

            // 3. Invalidate caches
            invalidateWorkflowsListCache()
            invalidateWorkflowCache(workflowId)

            if (_commitCallbacks.onQueryInvalidate) {
                await _commitCallbacks.onQueryInvalidate()
            }

            const result: WorkflowCommitResult = {
                success: true,
                revisionId,
                newRevisionId,
                workflow: newWorkflow,
            }

            // 4. Invoke new revision callback
            if (_commitCallbacks.onNewRevision) {
                await _commitCallbacks.onNewRevision(result, params)
            }

            // 5. Discard draft
            set(discardWorkflowDraftAtom, revisionId)

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
// ARCHIVE ATOM
// ============================================================================

/**
 * Archive a workflow.
 */
export const archiveWorkflowRevisionAtom = atom(
    null,
    async (get, _set, params: WorkflowArchiveParams): Promise<WorkflowArchiveOutcome> => {
        const {revisionId, workflowId} = params

        try {
            const projectId = get(projectIdAtom)
            if (!projectId) {
                throw new Error("No project ID available")
            }

            await archiveWorkflow(projectId, workflowId)

            // Invalidate caches
            invalidateWorkflowsListCache()

            if (_archiveCallbacks.onQueryInvalidate) {
                await _archiveCallbacks.onQueryInvalidate()
            }

            const result: WorkflowArchiveResult = {
                success: true,
                revisionId,
            }

            if (_archiveCallbacks.onRevisionDeleted) {
                await _archiveCallbacks.onRevisionDeleted(result)
            }

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
