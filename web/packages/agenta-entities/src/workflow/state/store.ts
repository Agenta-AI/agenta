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
import isEqual from "fast-deep-equal"
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
    fetchInterfaceSchemas,
    fetchWorkflowAppOpenApiSchema,
    queryWorkflows,
    queryWorkflowVariants,
    queryWorkflowRevisionsByWorkflow,
    queryWorkflowRevisions,
} from "../api"
import type {InspectWorkflowResponse, InterfaceSchemasResponse, AppOpenApiSchemas} from "../api"
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
// INTERFACE SCHEMAS QUERY (builtin workflow fallback)
// ============================================================================

/**
 * Helper to check if a URI is a builtin workflow URI.
 */
function isBuiltinUri(uri: string | null | undefined): boolean {
    if (!uri) return false
    return uri.startsWith("agenta:builtin:")
}

/**
 * Interface schemas query atom family.
 * For builtin workflows, fetches the interface schemas from the
 * `/preview/workflows/interfaces/schemas` endpoint.
 *
 * This is a lightweight fallback that returns static schema definitions
 * for builtin evaluators without requiring the handler to be running.
 *
 * **Only fires for builtin workflows** (URI starts with "agenta:builtin:").
 */
export const workflowInterfaceSchemasAtomFamily = atomFamily((revisionId: string) =>
    atomWithQuery((get) => {
        const projectId = get(workflowProjectIdAtom)
        const revisionQuery = get(workflowQueryAtomFamily(revisionId))
        const serverData = revisionQuery.data ?? null
        const uri = serverData?.data?.uri ?? null

        // Check if schemas are already present in server data
        const existingSchemas = serverData?.data?.schemas
        const hasParametersSchema = !!existingSchemas?.parameters
        const hasInputsSchema = !!existingSchemas?.inputs

        // Only fetch if it's a builtin URI and missing schemas
        const needsSchemaFetch = isBuiltinUri(uri) && (!hasParametersSchema || !hasInputsSchema)

        return {
            queryKey: ["workflows", "interfaceSchemas", revisionId, uri, projectId],
            queryFn: async (): Promise<InterfaceSchemasResponse | null> => {
                if (!projectId || !uri) return null
                return fetchInterfaceSchemas(uri, projectId)
            },
            enabled: get(sessionAtom) && !!projectId && !!uri && needsSchemaFetch,
            staleTime: Infinity, // Static schemas never change
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
 * 3. Interface schemas fallback (for builtin workflows missing schemas)
 * 4. Local draft overlay (user edits)
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

        // Interface schemas fallback: for builtin workflows that still have missing schemas
        // This is a lightweight fallback that works for any builtin URI
        const uri = merged.data?.uri ?? null
        if (isBuiltinUri(uri)) {
            const interfaceSchemasQuery = get(workflowInterfaceSchemasAtomFamily(workflowId))
            const interfaceSchemas = interfaceSchemasQuery.data?.schemas ?? null

            if (interfaceSchemas) {
                merged = {
                    ...merged,
                    data: {
                        ...merged.data,
                        schemas: {
                            ...merged.data?.schemas,
                            inputs: merged.data?.schemas?.inputs ?? interfaceSchemas.inputs,
                            outputs: merged.data?.schemas?.outputs ?? interfaceSchemas.outputs,
                            parameters:
                                merged.data?.schemas?.parameters ?? interfaceSchemas.parameters,
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
 * Compares draft parameters with server parameters to determine if there are
 * actual changes. Returns false if:
 * - No draft exists
 * - Draft parameters match server parameters (user reverted their changes)
 *
 * URL snapshot persistence is handled separately by the snapshot system
 * which encodes `createLocalDraft` flags — it does not depend on isDirty.
 */
export const workflowIsDirtyAtomFamily = atomFamily((workflowId: string) =>
    atom<boolean>((get) => {
        const draft = get(workflowDraftAtomFamily(workflowId))
        if (!draft) return false

        // Get server data to compare
        const localData = get(workflowLocalServerDataAtomFamily(workflowId))
        const query = get(workflowQueryAtomFamily(workflowId))
        const serverData = localData ?? query.data ?? null

        if (!serverData) return true // No server data, draft is dirty

        // Compare draft parameters with server parameters
        const draftParams = draft.data?.parameters
        const serverParams = serverData.data?.parameters

        // If no draft parameters, check if draft has any other changes
        if (!draftParams) {
            // Draft exists but no parameter changes - still dirty if draft has other data
            if (!draft.data) return false
            const dataKeys = Object.keys(draft.data as Record<string, unknown>)
            return dataKeys.length > 0
        }

        // Recursively sort object keys for consistent comparison
        // This handles json_schema property order differences
        const sortObjectKeys = (obj: unknown): unknown => {
            if (obj === null || obj === undefined) return obj
            if (Array.isArray(obj)) return obj.map(sortObjectKeys)
            if (typeof obj !== "object") return obj
            const sorted: Record<string, unknown> = {}
            for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
                sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key])
            }
            return sorted
        }

        // Normalize parameters for comparison
        const normalizeForComparison = (params: unknown): unknown => {
            if (!params || typeof params !== "object") return params
            const p = params as Record<string, unknown>

            // Normalize prompt_template content (trim trailing whitespace)
            let normalized = {...p}
            if (Array.isArray(p.prompt_template)) {
                normalized.prompt_template = (p.prompt_template as unknown[]).map((msg) => {
                    if (!msg || typeof msg !== "object") return msg
                    const m = msg as Record<string, unknown>
                    if (typeof m.content !== "string") return msg
                    const content = m.content
                        .split("\n")
                        .map((line: string) => line.trimEnd())
                        .join("\n")
                        .trimEnd()
                    return {...m, content}
                })
            }

            // Sort all object keys recursively (handles json_schema property order)
            return sortObjectKeys(normalized)
        }

        // Deep compare normalized parameters using fast-deep-equal
        const normalizedDraft = normalizeForComparison(draftParams)
        const normalizedServer = normalizeForComparison(serverParams)
        const isDirty = !isEqual(normalizedDraft, normalizedServer)

        // DEBUG: Log comparison
        if (isDirty) {
            console.log(
                "[isDirty DEBUG] normalizedDraft:",
                JSON.stringify(normalizedDraft, null, 2),
            )
            console.log(
                "[isDirty DEBUG] normalizedServer:",
                JSON.stringify(normalizedServer, null, 2),
            )
        }

        return isDirty
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
