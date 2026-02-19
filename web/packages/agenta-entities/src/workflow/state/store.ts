/**
 * Workflow Store
 *
 * Jotai atoms for workflow entity state management.
 * Uses atomFamily pattern for per-entity state with TanStack Query integration.
 *
 * Unlike the evaluator store which hardcodes `is_evaluator: true` for queries,
 * the workflow store does NOT inject any default flags — consumers control
 * filtering via the query parameters.
 *
 * @packageDocumentation
 */

import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import type {StoreOptions, ListQueryState} from "../../shared"
import {generateLocalId, isLocalDraftId, isPlaceholderId} from "../../shared"
import {
    fetchWorkflow,
    fetchWorkflowRevisionById,
    inspectWorkflow,
    fetchWorkflowAppOpenApiSchema,
    queryWorkflows,
    queryWorkflowVariants,
    queryWorkflowRevisionsByWorkflow,
    queryWorkflowRevisions,
} from "../api"
import type {InspectWorkflowResponse, AppOpenApiSchemas} from "../api"
import type {
    Workflow,
    WorkflowsResponse,
    WorkflowVariant,
    WorkflowVariantsResponse,
    WorkflowRevisionsResponse,
} from "../core"

// ============================================================================
// HELPERS
// ============================================================================

function getStore(options?: StoreOptions) {
    return options?.store ?? getDefaultStore()
}

// ============================================================================
// PROJECT ID ATOM
// ============================================================================

/**
 * Project ID atom.
 * Re-exports the shared projectIdAtom so workflow queries use the
 * canonical project ID without requiring manual wiring.
 */
export const workflowProjectIdAtom = projectIdAtom

// ============================================================================
// LIST QUERY
// ============================================================================

/**
 * Query atom for the workflows list.
 * By default, fetches ALL workflows (no flag filter).
 * Automatically fetches when projectId is set.
 */
export const workflowsListQueryAtom = atomWithQuery((get) => {
    const projectId = get(workflowProjectIdAtom)
    return {
        queryKey: ["workflows", "list", projectId],
        queryFn: async (): Promise<WorkflowsResponse> => {
            if (!projectId) return {count: 0, workflows: []}
            return queryWorkflows({projectId})
        },
        enabled: get(sessionAtom) && !!projectId,
        staleTime: 30_000,
    }
})

/**
 * Derived atom for the workflows list data (convenience).
 */
export const workflowsListDataAtom = atom<Workflow[]>((get) => {
    const query = get(workflowsListQueryAtom)
    return query.data?.workflows ?? []
})

/**
 * Derived atom for non-archived workflows.
 */
export const nonArchivedWorkflowsAtom = atom<Workflow[]>((get) => {
    const workflows = get(workflowsListDataAtom)
    return workflows.filter((w) => !w.deleted_at)
})

// ============================================================================
// VARIANT LIST QUERY (for 3-level hierarchy)
// ============================================================================

/**
 * Query atom family for fetching variants of a workflow.
 * Used in the Workflow → Variant → Revision selection hierarchy.
 */
export const workflowVariantsQueryAtomFamily = atomFamily((workflowId: string) =>
    atomWithQuery((get) => {
        const projectId = get(workflowProjectIdAtom)
        return {
            queryKey: ["workflows", "variants", workflowId, projectId],
            queryFn: async (): Promise<WorkflowVariantsResponse> => {
                if (!projectId || !workflowId) return {count: 0, workflow_variants: []}
                return queryWorkflowVariants(workflowId, projectId)
            },
            enabled: get(sessionAtom) && !!projectId && !!workflowId,
            staleTime: 30_000,
        }
    }),
)

/**
 * Derived atom family for variant list data (convenience).
 */
export const workflowVariantsListDataAtomFamily = atomFamily((workflowId: string) =>
    atom<WorkflowVariant[]>((get) => {
        const query = get(workflowVariantsQueryAtomFamily(workflowId))
        return query.data?.workflow_variants ?? []
    }),
)

// ============================================================================
// REVISION LIST QUERY BY WORKFLOW (for 2-level hierarchy: Workflow → Revision)
// ============================================================================

/**
 * Query atom family for fetching revisions directly by workflow ID.
 * Skips the variant level — used for the 2-level list-popover selection.
 */
export const workflowRevisionsByWorkflowQueryAtomFamily = atomFamily((workflowId: string) =>
    atomWithQuery((get) => {
        const projectId = get(workflowProjectIdAtom)
        return {
            queryKey: ["workflows", "revisionsByWorkflow", workflowId, projectId],
            queryFn: async (): Promise<WorkflowRevisionsResponse> => {
                if (!projectId || !workflowId) return {count: 0, workflow_revisions: []}
                return queryWorkflowRevisionsByWorkflow(workflowId, projectId)
            },
            enabled: get(sessionAtom) && !!projectId && !!workflowId,
            staleTime: 30_000,
        }
    }),
)

/**
 * Derived atom family for revision list data by workflow ID (convenience).
 * Sorted by version descending (newest first).
 */
export const workflowRevisionsByWorkflowListDataAtomFamily = atomFamily((workflowId: string) =>
    atom<Workflow[]>((get) => {
        const query = get(workflowRevisionsByWorkflowQueryAtomFamily(workflowId))
        const revisions = query.data?.workflow_revisions ?? []
        return [...revisions].sort((a, b) => (b.version ?? 0) - (a.version ?? 0))
    }),
)

// ============================================================================
// REVISION LIST QUERY (for 3-level hierarchy)
// ============================================================================

/**
 * Query atom family for fetching revisions of a variant.
 * Used in the Workflow → Variant → Revision selection hierarchy.
 */
export const workflowRevisionsQueryAtomFamily = atomFamily((variantId: string) =>
    atomWithQuery((get) => {
        const projectId = get(workflowProjectIdAtom)
        return {
            queryKey: ["workflows", "revisions", variantId, projectId],
            queryFn: async (): Promise<WorkflowRevisionsResponse> => {
                if (!projectId || !variantId) return {count: 0, workflow_revisions: []}
                return queryWorkflowRevisions(variantId, projectId)
            },
            enabled: get(sessionAtom) && !!projectId && !!variantId,
            staleTime: 30_000,
        }
    }),
)

/**
 * Derived atom family for revision list data (convenience).
 * Sorted by version descending (newest first).
 */
export const workflowRevisionsListDataAtomFamily = atomFamily((variantId: string) =>
    atom<Workflow[]>((get) => {
        const query = get(workflowRevisionsQueryAtomFamily(variantId))
        const revisions = query.data?.workflow_revisions ?? []
        return [...revisions].sort((a, b) => (b.version ?? 0) - (a.version ?? 0))
    }),
)

// ============================================================================
// LIST QUERY STATE WRAPPERS (for selection adapters and relations)
// ============================================================================

/**
 * ListQueryState wrapper for workflow variants.
 * Wraps the TanStack Query result into the ListQueryState shape
 * required by entity selection adapters and relations.
 */
export const workflowVariantsListQueryStateAtomFamily = atomFamily((workflowId: string) =>
    atom<ListQueryState<WorkflowVariant>>((get) => {
        const query = get(workflowVariantsQueryAtomFamily(workflowId))
        return {
            data: query.data?.workflow_variants ?? [],
            isPending: query.isPending ?? false,
            isError: query.isError ?? false,
            error: query.error ?? null,
        }
    }),
)

/**
 * ListQueryState wrapper for workflow revisions (by variant).
 * Used in the 3-level selection hierarchy (Workflow → Variant → Revision).
 * Sorted by version descending (newest first).
 */
export const workflowRevisionsListQueryStateAtomFamily = atomFamily((variantId: string) =>
    atom<ListQueryState<Workflow>>((get) => {
        const query = get(workflowRevisionsQueryAtomFamily(variantId))
        const revisions = query.data?.workflow_revisions ?? []
        return {
            data: [...revisions].sort((a, b) => (b.version ?? 0) - (a.version ?? 0)),
            isPending: query.isPending ?? false,
            isError: query.isError ?? false,
            error: query.error ?? null,
        }
    }),
)

/**
 * ListQueryState wrapper for workflows list (root level).
 * Filters out archived workflows.
 */
export const workflowsListQueryStateAtom = atom<ListQueryState<Workflow>>((get) => {
    const query = get(workflowsListQueryAtom)
    const data = (query.data?.workflows ?? []).filter((w) => !w.deleted_at)
    return {
        data,
        isPending: query.isPending ?? false,
        isError: query.isError ?? false,
        error: query.error ?? null,
    }
})

// ============================================================================
// LATEST REVISION (lightweight dedicated query)
// ============================================================================

/**
 * Query atom family for fetching the latest revision of a workflow.
 * Uses `fetchWorkflow` which queries by workflow ID and returns the latest
 * revision directly — avoids triggering the full revisions list query.
 */
const workflowLatestRevisionQueryAtomFamily = atomFamily((workflowId: string) =>
    atomWithQuery((get) => {
        const projectId = get(workflowProjectIdAtom)
        return {
            queryKey: ["workflows", "latestRevision", workflowId, projectId],
            queryFn: async (): Promise<Workflow | null> => {
                if (!projectId || !workflowId) return null
                try {
                    return await fetchWorkflow({id: workflowId, projectId})
                } catch {
                    return null
                }
            },
            enabled: get(sessionAtom) && !!projectId && !!workflowId,
            staleTime: 30_000,
        }
    }),
)

/**
 * Derived atom family for the latest revision ID of a workflow.
 * Reads from the dedicated latest revision query (1 API call)
 * instead of fetching all revisions.
 */
export const workflowLatestRevisionIdAtomFamily = atomFamily((workflowId: string) =>
    atom<string | null>((get) => {
        if (!workflowId) return null
        const query = get(workflowLatestRevisionQueryAtomFamily(workflowId))
        return query.data?.id ?? null
    }),
)

// ============================================================================
// SINGLE ENTITY QUERY
// ============================================================================

/**
 * Query atom family for fetching a single workflow revision by its revision ID.
 * Returns the WorkflowRevision which contains `data` (uri, schemas, parameters).
 *
 * Uses `fetchWorkflowRevisionById` (GET /preview/workflows/revisions/{id})
 * because the playground stores revision IDs, not workflow IDs.
 */
export const workflowQueryAtomFamily = atomFamily((revisionId: string) =>
    atomWithQuery((get) => {
        const projectId = get(workflowProjectIdAtom)

        return {
            queryKey: ["workflows", "revision", revisionId, projectId],
            queryFn: async (): Promise<Workflow | null> => {
                if (!projectId || !revisionId) return null
                return fetchWorkflowRevisionById(revisionId, projectId)
            },
            enabled:
                get(sessionAtom) &&
                !!projectId &&
                !!revisionId &&
                !isLocalDraftId(revisionId) &&
                !isPlaceholderId(revisionId),
            staleTime: 30_000,
        }
    }),
)

// ============================================================================
// INSPECT QUERY (resolve full schema — evaluator workflows only)
// ============================================================================

/**
 * Inspect query atom family.
 * After revision data loads, calls `/preview/workflows/inspect` with the
 * revision's URI to resolve the full interface schema (including inputs).
 *
 * **Only fires for evaluator workflows** (`flags.is_evaluator`).
 * For app workflows the inspect endpoint does not return input schemas;
 * those use the OpenAPI fallback below instead.
 */
export const workflowInspectAtomFamily = atomFamily((revisionId: string) =>
    atomWithQuery((get) => {
        const projectId = get(workflowProjectIdAtom)
        const revisionQuery = get(workflowQueryAtomFamily(revisionId))
        const serverData = revisionQuery.data ?? null
        const uri = serverData?.data?.uri ?? null
        const isEvaluator = serverData?.flags?.is_evaluator ?? false

        return {
            queryKey: ["workflows", "inspect", revisionId, uri, projectId],
            queryFn: async (): Promise<InspectWorkflowResponse | null> => {
                if (!projectId || !uri) return null
                return inspectWorkflow(uri, projectId)
            },
            enabled: get(sessionAtom) && !!projectId && !!uri && isEvaluator,
            staleTime: 60_000,
        }
    }),
)

// ============================================================================
// APP OPENAPI SCHEMA QUERY (non-evaluator workflow fallback)
// ============================================================================

/**
 * OpenAPI schema query atom family.
 * For app workflows (non-evaluator), fetches the OpenAPI spec from the
 * app's service URL and extracts input/output/parameter schemas.
 *
 * **Only fires for non-evaluator workflows** that have a `data.url`.
 * Evaluator workflows use the inspect endpoint above instead.
 */
export const workflowAppSchemaAtomFamily = atomFamily((revisionId: string) =>
    atomWithQuery((get) => {
        const projectId = get(workflowProjectIdAtom)
        const revisionQuery = get(workflowQueryAtomFamily(revisionId))
        const serverData = revisionQuery.data ?? null
        const url = serverData?.data?.url ?? null
        const isEvaluator = serverData?.flags?.is_evaluator ?? false

        return {
            queryKey: ["workflows", "appSchema", revisionId, url, projectId],
            queryFn: async (): Promise<AppOpenApiSchemas | null> => {
                if (!projectId || !url) return null
                return fetchWorkflowAppOpenApiSchema(url, projectId)
            },
            enabled: get(sessionAtom) && !!projectId && !!url && !isEvaluator,
            staleTime: 60_000,
        }
    }),
)

// ============================================================================
// DRAFT STATE
// ============================================================================

/**
 * Draft state per workflow (local edits before save).
 * Stores partial updates to workflow data.
 */
export const workflowDraftAtomFamily = atomFamily((_workflowId: string) =>
    atom<Partial<Workflow> | null>(null),
)

/**
 * Merged entity atom: server data + resolved schemas + local draft overlay.
 * Also checks local draft storage for browser-only clones.
 *
 * Merges in layers:
 * 1. Server revision data (from query)
 * 2. Schema resolution (flag-gated):
 *    - **Evaluator workflows**: inspect endpoint fills missing schemas
 *    - **App workflows**: OpenAPI spec fetch fills missing schemas
 * 3. Local draft overlay (user edits)
 *
 * Local drafts already contain fully-merged data from the source revision,
 * so they skip the schema resolution stage.
 */
export const workflowEntityAtomFamily = atomFamily((workflowId: string) =>
    atom<Workflow | null>((get) => {
        // Check local draft storage first (for browser-only clones)
        // Local drafts already contain fully-merged data from their source revision
        const localData = get(workflowLocalServerDataAtomFamily(workflowId))
        if (localData) {
            const draft = get(workflowDraftAtomFamily(workflowId))
            if (!draft) return localData
            return {
                ...localData,
                ...draft,
                data: {
                    ...localData.data,
                    ...draft.data,
                },
            } as Workflow
        }

        const query = get(workflowQueryAtomFamily(workflowId))
        const serverData = query.data ?? null
        const draft = get(workflowDraftAtomFamily(workflowId))

        if (!serverData) return draft as Workflow | null

        const isEvaluator = serverData.flags?.is_evaluator ?? false

        let merged = serverData

        if (isEvaluator) {
            // Evaluator workflows: merge inspect data
            const inspectQuery = get(workflowInspectAtomFamily(workflowId))
            const inspectData = inspectQuery.data ?? null

            if (inspectData) {
                const inspectSchemas = inspectData.interface?.schemas
                const inspectParams =
                    (inspectData.configuration as Record<string, unknown> | undefined)
                        ?.parameters ?? null

                merged = {
                    ...serverData,
                    data: {
                        ...serverData.data,
                        parameters:
                            serverData.data?.parameters ??
                            (inspectParams as Record<string, unknown> | null) ??
                            undefined,
                        ...(inspectSchemas
                            ? {
                                  schemas: {
                                      ...serverData.data?.schemas,
                                      inputs:
                                          serverData.data?.schemas?.inputs ?? inspectSchemas.inputs,
                                      outputs:
                                          serverData.data?.schemas?.outputs ??
                                          inspectSchemas.outputs,
                                      parameters:
                                          serverData.data?.schemas?.parameters ??
                                          inspectSchemas.parameters,
                                  },
                              }
                            : {}),
                    },
                } as Workflow
            }
        } else {
            // App workflows: merge OpenAPI-derived schemas
            const appSchemaQuery = get(workflowAppSchemaAtomFamily(workflowId))
            const appSchemas = appSchemaQuery.data ?? null

            if (appSchemas) {
                merged = {
                    ...serverData,
                    data: {
                        ...serverData.data,
                        schemas: {
                            ...serverData.data?.schemas,
                            inputs: serverData.data?.schemas?.inputs ?? appSchemas.inputs,
                            outputs: serverData.data?.schemas?.outputs ?? appSchemas.outputs,
                            parameters:
                                serverData.data?.schemas?.parameters ?? appSchemas.parameters,
                        },
                    },
                } as Workflow
            }
        }

        if (!draft) return merged

        return {
            ...merged,
            ...draft,
            data: {
                ...merged.data,
                ...draft.data,
            },
        } as Workflow
    }),
)

/**
 * Is the workflow dirty (has local edits)?
 *
 * Checks whether a draft overlay exists for this entity.
 * For local drafts this starts as `false` (freshly cloned, no edits)
 * and becomes `true` when the user modifies parameters.
 *
 * URL snapshot persistence is handled separately by the snapshot system
 * which encodes `createLocalDraft` flags — it does not depend on isDirty.
 */
export const workflowIsDirtyAtomFamily = atomFamily((workflowId: string) =>
    atom<boolean>((get) => {
        const draft = get(workflowDraftAtomFamily(workflowId))
        return draft !== null
    }),
)

// ============================================================================
// MUTATIONS (Write Atoms)
// ============================================================================

/**
 * Update workflow draft state.
 * Deep-merges the `data` field so nested properties (parameters, schemas, etc.)
 * are preserved across incremental updates.
 */
export const updateWorkflowDraftAtom = atom(
    null,
    (_get, set, workflowId: string, updates: Partial<Workflow>) => {
        const current = _get(workflowDraftAtomFamily(workflowId))
        const {data: updatedData, ...restUpdates} = updates
        const mergedData =
            updatedData || current?.data
                ? {
                      ...current?.data,
                      ...updatedData,
                  }
                : undefined
        set(workflowDraftAtomFamily(workflowId), {
            ...current,
            ...restUpdates,
            ...(mergedData !== undefined ? {data: mergedData} : {}),
        })
    },
)

/**
 * Discard workflow draft (reset to server state).
 */
export const discardWorkflowDraftAtom = atom(null, (_get, set, workflowId: string) => {
    set(workflowDraftAtomFamily(workflowId), null)
})

// ============================================================================
// LOCAL DRAFTS (browser-only clones of server revisions)
// ============================================================================

/**
 * Storage for local draft data, keyed by local draft ID.
 * Stores complete Workflow objects that were cloned from server revisions.
 * These are only stored in browser memory (not persisted via API).
 */
export const workflowLocalServerDataAtomFamily = atomFamily((_localDraftId: string) =>
    atom<Workflow | null>(null),
)

/**
 * Create a local (browser-only) draft by cloning a workflow revision.
 *
 * Reads the source revision data from the store, clones it with a new
 * local ID (prefixed "local-"), and stores the clone so it's immediately
 * available via `workflowEntityAtomFamily(localId)`.
 *
 * @param sourceRevisionId - The revision ID to clone
 * @param _appId - Unused (API compat with the unified bridge signature)
 * @returns The new local draft ID, or null on failure
 */
export function createLocalDraftFromWorkflowRevision(
    sourceRevisionId: string,
    _appId?: string,
): string | null {
    const store = getDefaultStore()

    const sourceData = store.get(workflowEntityAtomFamily(sourceRevisionId))
    if (!sourceData) {
        console.warn("[createLocalDraftFromWorkflowRevision] no sourceData for:", sourceRevisionId)
        return null
    }

    const localId = generateLocalId("local")

    // Clone the source data with the new local ID and mark the source
    const clonedData: Workflow = {
        ...sourceData,
        id: localId,
        _sourceRevisionId: isLocalDraftId(sourceRevisionId)
            ? ((sourceData as Workflow & {_sourceRevisionId?: string})._sourceRevisionId ??
              sourceRevisionId)
            : sourceRevisionId,
    } as Workflow & {_sourceRevisionId: string}

    // Store in the local server data atom
    store.set(workflowLocalServerDataAtomFamily(localId), clonedData)

    return localId
}

// ============================================================================
// CACHE INVALIDATION
// ============================================================================

/**
 * Invalidate the workflows list cache.
 * Call after create/update/archive operations.
 */
export function invalidateWorkflowsListCache(options?: StoreOptions) {
    const store = getStore(options)
    const queryAtom = workflowsListQueryAtom
    const current = store.get(queryAtom)
    if (current?.refetch) {
        current.refetch()
    }
}

/**
 * Invalidate a single workflow's cache.
 */
export function invalidateWorkflowCache(workflowId: string, options?: StoreOptions) {
    const store = getStore(options)
    const queryAtom = workflowQueryAtomFamily(workflowId)
    const current = store.get(queryAtom)
    if (current?.refetch) {
        current.refetch()
    }
}
