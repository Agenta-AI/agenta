/**
 * Workflow Commit Module
 *
 * Provides commit/archive actions for workflow entities with callback
 * registration for playground-specific orchestration.
 *
 * The workflow API returns new revision IDs directly — no polling needed.
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
import {extractApiErrorMessage, stripAgentaMetadataDeep} from "@agenta/shared/utils"
import {atom, getDefaultStore} from "jotai"

import {flattenEvaluatorConfiguration} from "../../runnable/evaluatorTransforms"
import {
    commitWorkflowRevisionApi,
    createWorkflow as createWorkflowApi,
    createWorkflowVariantApi,
    archiveWorkflowRevision,
    archiveWorkflowVariant,
    queryWorkflowRevisions,
} from "../api"
import {generateSlug, type Workflow, type WorkflowData} from "../core"

import {workflowsListDataAtom} from "./allWorkflows"
import {invalidateEvaluatorsListCache} from "./evaluatorUtils"
import {
    workflowEntityAtomFamily,
    discardWorkflowDraftAtom,
    invalidateWorkflowsListCache,
    invalidateWorkflowCache,
    invalidateWorkflowRevisionsByWorkflowCache,
    invalidateWorkflowVariantsCache,
    getFlatSourceData,
} from "./store"

// ============================================================================
// HELPERS
// ============================================================================

type ErrorWithResponseStatus = Error & {response?: {status?: number}}

function preserveResponseStatus(error: unknown, message: string): ErrorWithResponseStatus {
    const err = new Error(message) as ErrorWithResponseStatus
    const status = (error as {response?: {status?: number}})?.response?.status
    if (status !== undefined) {
        err.response = {status}
    }
    return err
}

/**
 * Prepare parameters for the commit API.
 * For evaluator workflows, flattens nested params (prompt.messages → prompt_template)
 * back to the flat format the backend expects.
 */
function prepareCommitParameters(
    entity: Workflow,
    flatParams: Record<string, unknown> | null,
): Record<string, unknown> | undefined {
    const rawParams = stripAgentaMetadataDeep(entity.data?.parameters) as
        | Record<string, unknown>
        | undefined
    if (!rawParams) return undefined

    const isEvaluator = entity.flags?.is_evaluator ?? false
    if (isEvaluator) {
        return flattenEvaluatorConfiguration(rawParams, flatParams)
    }
    return rawParams
}

/**
 * Prepare schemas for the commit API.
 * For evaluator workflows the UI applies a display-only nesting transform to
 * `schemas.parameters` — use the flat server schemas instead so the transform
 * is never persisted.
 */
function prepareCommitSchemas(
    entity: Workflow,
    flatSchemas: WorkflowData["schemas"] | null,
): WorkflowData["schemas"] | undefined {
    if (entity.flags?.is_evaluator) {
        return flatSchemas ?? entity.data?.schemas
    }
    return entity.data?.schemas
}

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

export function getWorkflowCommitCallbacks(): Readonly<WorkflowCommitCallbacks> {
    return _commitCallbacks
}

export function clearWorkflowCommitCallbacks(): void {
    _commitCallbacks = {}
}

/**
 * Invoke the registered onNewRevision callback.
 *
 * Used by flows that bypass `commitWorkflowRevisionAtom` (e.g., creating
 * a new workflow for ephemeral entities) but still need to notify listeners
 * like the CreateEvaluatorDrawer.
 */
export async function invokeWorkflowCommitCallbacks(
    result: WorkflowCommitResult,
    params: WorkflowCommitParams,
): Promise<void> {
    if (_commitCallbacks.onNewRevision) {
        await _commitCallbacks.onNewRevision(result, params)
    }
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
            const flatSource = getFlatSourceData(get, revisionId)
            const flatParams =
                (flatSource?.data?.parameters as Record<string, unknown> | null) ?? null
            const flatSchemas = flatSource?.data?.schemas ?? null

            // 2. Call the revision commit endpoint directly.
            // We do NOT use `updateWorkflow` here — that function also fires a
            // `PUT /workflows/{id}` for metadata edits, which overwrites
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
                message: _commitMessage ?? undefined,
                data: {
                    uri: entity.data.uri,
                    url: entity.data.url,
                    parameters: prepareCommitParameters(entity, flatParams),
                    schemas: prepareCommitSchemas(entity, flatSchemas),
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
            invalidateEvaluatorsListCache()
            invalidateWorkflowCache(revisionId)
            invalidateWorkflowRevisionsByWorkflowCache(workflowId)
            if (_commitCallbacks.onQueryInvalidate) {
                void _commitCallbacks.onQueryInvalidate()
            }

            return result
        } catch (error) {
            const err = new Error(extractApiErrorMessage(error))

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
    /** Slug suffix for the new variant. The workflow slug prefix is preserved internally. */
    slug?: string
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
 * 2. Create a new variant via `POST /workflows/variants/`
 * 3. Commit first revision under the new variant via `POST /workflows/revisions/commit`
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
        const {baseRevisionId, newVariantName, slug: explicitSlug, commitMessage} = params

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
            const flatSource = getFlatSourceData(get, baseRevisionId)
            const flatParams =
                (flatSource?.data?.parameters as Record<string, unknown> | null) ?? null
            const flatSchemas = flatSource?.data?.schemas ?? null

            const workflowId = entity.workflow_id ?? entity.id
            if (!entity.data) {
                throw new Error("Cannot create variant: no data to carry over")
            }

            // 2. Create the new variant
            const allWorkflows = get(workflowsListDataAtom)
            const workflowArtifact = allWorkflows.find((w) => w.id === workflowId)
            const variantSlugSuffix = generateSlug(newVariantName)
            const requestedSlug = explicitSlug || variantSlugSuffix
            const slug =
                workflowArtifact?.slug && !requestedSlug.startsWith(`${workflowArtifact.slug}.`)
                    ? `${workflowArtifact.slug}.${requestedSlug}`
                    : requestedSlug
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
                message: commitMessage,
                data: {
                    uri: entity.data.uri,
                    url: entity.data.url,
                    parameters: prepareCommitParameters(entity, flatParams),
                    schemas: prepareCommitSchemas(entity, flatSchemas),
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
            invalidateEvaluatorsListCache()
            invalidateWorkflowCache(baseRevisionId)
            invalidateWorkflowRevisionsByWorkflowCache(workflowId)
            invalidateWorkflowVariantsCache(workflowId)
            if (_commitCallbacks.onQueryInvalidate) {
                void _commitCallbacks.onQueryInvalidate()
            }

            return {
                success: true,
                newRevisionId,
                newVariantId: newVariant.id,
            }
        } catch (error) {
            const err = preserveResponseStatus(error, extractApiErrorMessage(error))
            return {
                success: false,
                error: err,
            }
        }
    },
)

// ============================================================================
// CREATE FROM EPHEMERAL ATOM
// ============================================================================

/**
 * Parameters for creating a workflow from an ephemeral (local-only) entity
 */
export interface WorkflowCreateFromEphemeralParams {
    /** Local entity ID of the ephemeral workflow */
    revisionId: string
    /** Commit message */
    commitMessage?: string
    /** Display name for the new workflow (overrides entity name) */
    name?: string
    /** Slug for the new workflow. When provided, overrides auto-generation. */
    slug?: string
}

/**
 * Create a new workflow from an ephemeral (local-only) entity.
 *
 * Ephemeral entities are created from templates and have `meta.__ephemeral: true`.
 * They have no server baseline — this atom creates the workflow artifact and
 * commits the initial revision.
 *
 * Flow:
 * 1. Read ephemeral entity data from the store
 * 2. Generate a unique slug (NOT the template key)
 * 3. Call createWorkflow API (creates artifact + commits revision)
 * 4. Invoke commit callbacks
 * 5. Discard local draft
 * 6. Invalidate caches
 */
export const createWorkflowFromEphemeralAtom = atom(
    null,
    async (get, set, params: WorkflowCreateFromEphemeralParams): Promise<WorkflowCommitOutcome> => {
        const {revisionId, commitMessage, name, slug} = params

        try {
            const projectId = get(projectIdAtom)
            if (!projectId) {
                throw new Error("No project ID available")
            }

            // 1. Read ephemeral entity data
            const entity = get(workflowEntityAtomFamily(revisionId))
            if (!entity) {
                throw new Error(`No workflow entity found for ${revisionId}`)
            }
            const flatSource = getFlatSourceData(get, revisionId)
            const flatParams =
                (flatSource?.data?.parameters as Record<string, unknown> | null) ?? null
            const flatSchemas = flatSource?.data?.schemas ?? null

            // 2. Generate a unique slug (never use the template key)
            const workflowName = name || entity.name || "Workflow"
            const workflowSlug = slug || generateSlug(workflowName)

            // 3. Create workflow via API
            const newWorkflow = await createWorkflowApi(projectId, {
                slug: workflowSlug,
                name: workflowName,
                flags: entity.flags
                    ? {
                          is_application: entity.flags.is_application,
                          is_evaluator: entity.flags.is_evaluator,
                          is_snippet: entity.flags.is_snippet,
                      }
                    : undefined,
                message: commitMessage || undefined,
                data: entity.data
                    ? {
                          uri: entity.data.uri,
                          parameters: prepareCommitParameters(entity, flatParams),
                          schemas: prepareCommitSchemas(entity, flatSchemas),
                      }
                    : undefined,
            })

            const newRevisionId = newWorkflow.id

            const result: WorkflowCommitResult = {
                success: true,
                revisionId,
                newRevisionId,
                workflow: newWorkflow,
            }

            // 4. Invoke commit callbacks (reuse shared helper)
            await invokeWorkflowCommitCallbacks(result, {revisionId, commitMessage})

            // 5. Discard local draft
            set(discardWorkflowDraftAtom, revisionId)

            // 6. Invalidate caches (both app and evaluator lists)
            invalidateWorkflowsListCache()
            invalidateEvaluatorsListCache()
            if (_commitCallbacks.onQueryInvalidate) {
                void _commitCallbacks.onQueryInvalidate()
            }

            return result
        } catch (error) {
            const err = preserveResponseStatus(error, extractApiErrorMessage(error))

            if (_commitCallbacks.onError) {
                _commitCallbacks.onError(err, {revisionId, commitMessage})
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
 * Archive a single workflow revision.
 *
 * Uses `POST /workflows/revisions/{revision_id}/archive` to archive
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

            await archiveWorkflowRevision(projectId, revisionId)

            // When variantId is provided, check if the variant still has
            // active (non-archived) revisions. If not, archive the variant
            // so it no longer appears in the entity selector dropdown.
            if (variantId) {
                try {
                    const remaining = await queryWorkflowRevisions(variantId, projectId)
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
                        // Archive leftover seed revisions first
                        for (const r of activeRevisions) {
                            await archiveWorkflowRevision(projectId, r.id)
                        }
                        // Then archive the now-empty variant
                        await archiveWorkflowVariant(projectId, variantId)
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

            invalidateWorkflowsListCache()
            invalidateEvaluatorsListCache()
            invalidateWorkflowRevisionsByWorkflowCache(workflowId)
            invalidateWorkflowCache(revisionId)

            if (_archiveCallbacks.onQueryInvalidate) {
                await _archiveCallbacks.onQueryInvalidate()
            }

            // Await selection cleanup so the replacement revision is in place
            // before the caller (delete modal) closes — prevents an empty
            // playground flash.
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
