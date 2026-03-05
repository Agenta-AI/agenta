/**
 * EvaluatorRevision Module
 *
 * Real molecule implementation for evaluator revisions.
 * Fetches revision data by revision ID from the workflow revisions API.
 * Used by the 3-level selection hierarchy: Evaluator → Variant → Revision.
 *
 * @example
 * ```typescript
 * import { evaluatorRevisionMolecule } from '@agenta/entities/evaluatorRevision'
 *
 * const data = useAtomValue(evaluatorRevisionMolecule.selectors.data(revisionId))
 * const query = useAtomValue(evaluatorRevisionMolecule.selectors.query(revisionId))
 * ```
 */

import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {createBatchFetcher} from "@agenta/shared/utils"
import {atom, type Atom} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery, queryClientAtom} from "jotai-tanstack-query"

import {fetchEvaluatorRevisionsByIdsBatch, inspectWorkflow} from "../evaluator/api"
import type {Evaluator} from "../evaluator/core"
import type {EvaluatorRevisionsResponse} from "../evaluator/core"

// ============================================================================
// TYPES
// ============================================================================

export interface SettingsPreset {
    name: string
    description?: string
    settings_values: Record<string, unknown>
}

interface QueryState<T = unknown> {
    data: T | null
    isPending: boolean
    isError: boolean
    error: unknown
}

type QueryClient = import("@tanstack/react-query").QueryClient

// ============================================================================
// BATCH FETCHER
// ============================================================================

interface EvaluatorRevisionBatchRequest {
    projectId: string
    revisionId: string
}

const evaluatorRevisionBatchFetcher = createBatchFetcher<
    EvaluatorRevisionBatchRequest,
    Evaluator | null
>({
    maxBatchSize: 50,
    flushDelay: 10,
    serializeKey: (req) => `${req.projectId}:${req.revisionId}`,
    batchFn: async (requests, serializedKeys) => {
        const results = new Map<string, Evaluator | null>()
        const byProject = new Map<string, {revisionIds: string[]; keys: string[]}>()

        requests.forEach((req, index) => {
            const key = serializedKeys[index]
            if (!req.projectId || !req.revisionId) {
                results.set(key, null)
                return
            }

            const existing = byProject.get(req.projectId)
            if (existing) {
                existing.revisionIds.push(req.revisionId)
                existing.keys.push(key)
            } else {
                byProject.set(req.projectId, {
                    revisionIds: [req.revisionId],
                    keys: [key],
                })
            }
        })

        await Promise.all(
            Array.from(byProject.entries()).map(async ([projectId, group]) => {
                const revisionMap = await fetchEvaluatorRevisionsByIdsBatch(
                    projectId,
                    group.revisionIds,
                )
                group.revisionIds.forEach((revisionId, index) => {
                    const key = group.keys[index]
                    results.set(key, revisionMap.get(revisionId) ?? null)
                })
            }),
        )

        return results
    },
})

function findEvaluatorRevisionInDetailCache(
    queryClient: QueryClient,
    projectId: string,
    revisionId: string,
): Evaluator | undefined {
    return queryClient.getQueryData<Evaluator>(["evaluatorRevision", revisionId, projectId])
}

function findEvaluatorRevisionInListCaches(
    queryClient: QueryClient,
    projectId: string,
    revisionId: string,
): Evaluator | undefined {
    const evaluatorRevisionQueries = queryClient.getQueriesData<EvaluatorRevisionsResponse>({
        predicate: (query) => {
            const key = query.queryKey
            return (
                key[0] === "evaluators" &&
                (key[1] === "revisionsByWorkflow" || key[1] === "revisions") &&
                key[3] === projectId
            )
        },
    })

    for (const [_queryKey, data] of evaluatorRevisionQueries) {
        const revisions = data?.workflow_revisions
        if (!Array.isArray(revisions)) continue
        const found = revisions.find((revision) => revision.id === revisionId)
        if (found) return found
    }

    const workflowRevisionQueries = queryClient.getQueriesData<EvaluatorRevisionsResponse>({
        predicate: (query) => {
            const key = query.queryKey
            return (
                key[0] === "workflows" &&
                (key[1] === "revisionsByWorkflow" || key[1] === "revisions") &&
                key[3] === projectId
            )
        },
    })

    for (const [_queryKey, data] of workflowRevisionQueries) {
        const revisions = data?.workflow_revisions
        if (!Array.isArray(revisions)) continue
        const found = revisions.find((revision) => revision.id === revisionId)
        if (found) return found
    }

    const evaluatorLatestQueries = queryClient.getQueriesData<Evaluator | null>({
        predicate: (query) => {
            const key = query.queryKey
            return key[0] === "evaluators" && key[1] === "revision" && key[3] === projectId
        },
    })

    for (const [_queryKey, data] of evaluatorLatestQueries) {
        if (data?.id === revisionId) return data
    }

    const workflowDetail = queryClient.getQueryData<Evaluator>([
        "workflows",
        "revision",
        revisionId,
        projectId,
    ])
    if (workflowDetail) return workflowDetail

    return undefined
}

function findEvaluatorRevisionInCache(
    queryClient: QueryClient,
    projectId: string,
    revisionId: string,
): Evaluator | undefined {
    return (
        findEvaluatorRevisionInDetailCache(queryClient, projectId, revisionId) ??
        findEvaluatorRevisionInListCaches(queryClient, projectId, revisionId)
    )
}

// ============================================================================
// QUERY ATOMS
// ============================================================================

/**
 * Query atom family for fetching a single revision by its revision ID.
 * Uses batched `POST /preview/workflows/revisions/query` via createBatchFetcher.
 */
const evaluatorRevisionQueryAtomFamily = atomFamily((revisionId: string) =>
    atomWithQuery((get) => {
        const projectId = get(projectIdAtom)
        const queryClient = get(queryClientAtom)
        const detailCached =
            projectId && revisionId
                ? findEvaluatorRevisionInDetailCache(queryClient, projectId, revisionId)
                : undefined

        return {
            queryKey: ["evaluatorRevision", revisionId, projectId],
            queryFn: async (): Promise<Evaluator | null> => {
                if (!projectId || !revisionId) return null
                const cached = findEvaluatorRevisionInCache(queryClient, projectId, revisionId)
                if (cached) return cached
                return evaluatorRevisionBatchFetcher({projectId, revisionId})
            },
            initialData: detailCached ?? undefined,
            enabled: get(sessionAtom) && !!projectId && !!revisionId && !detailCached,
            staleTime: 30_000,
        }
    }),
)

/**
 * Inspect query atom family.
 * After revision data loads, calls `/preview/workflows/inspect` with the
 * revision's URI to resolve the full interface schema (including inputs).
 */
const evaluatorRevisionInspectAtomFamily = atomFamily((revisionId: string) =>
    atomWithQuery((get) => {
        const projectId = get(projectIdAtom)
        const revisionQuery = get(evaluatorRevisionQueryAtomFamily(revisionId))
        const uri = revisionQuery.data?.data?.uri ?? null

        return {
            queryKey: ["evaluatorRevision", "inspect", revisionId, uri, projectId],
            queryFn: async () => {
                if (!projectId || !uri) return null
                return inspectWorkflow(uri, projectId)
            },
            enabled: get(sessionAtom) && !!projectId && !!uri,
            staleTime: 60_000,
        }
    }),
)

/**
 * Draft state per revision (local edits before save).
 */
const evaluatorRevisionDraftAtomFamily = atomFamily((_revisionId: string) =>
    atom<Partial<Evaluator> | null>(null),
)

/**
 * Merged entity atom: server data + inspect schemas + local draft overlay.
 *
 * Merges in three layers:
 * 1. Server revision data (from query)
 * 2. Inspect schemas (fills in missing inputs schema)
 * 3. Local draft overlay (user edits)
 */
const evaluatorRevisionEntityAtomFamily = atomFamily((revisionId: string) =>
    atom<Evaluator | null>((get) => {
        const query = get(evaluatorRevisionQueryAtomFamily(revisionId))
        const serverData = query.data ?? null
        const inspectQuery = get(evaluatorRevisionInspectAtomFamily(revisionId))
        const inspectData = inspectQuery.data ?? null
        const draft = get(evaluatorRevisionDraftAtomFamily(revisionId))

        if (!serverData) return draft as Evaluator | null

        // Merge inspect data into server data:
        // - schemas from inspect.interface.schemas (fills missing inputs/outputs/parameters schemas)
        // - configuration from inspect.configuration.parameters (fills missing parameter values)
        let merged = serverData
        if (inspectData) {
            const inspectSchemas = inspectData.interface?.schemas
            const inspectParams =
                (inspectData.configuration as Record<string, unknown> | undefined)?.parameters ??
                null

            merged = {
                ...serverData,
                data: {
                    ...serverData.data,
                    // Fill in missing parameter values from inspect configuration
                    parameters:
                        serverData.data?.parameters ??
                        (inspectParams as Record<string, unknown> | null) ??
                        undefined,
                    // Fill in missing schemas from inspect interface
                    ...(inspectSchemas
                        ? {
                              schemas: {
                                  ...serverData.data?.schemas,
                                  inputs: serverData.data?.schemas?.inputs ?? inspectSchemas.inputs,
                                  outputs:
                                      serverData.data?.schemas?.outputs ?? inspectSchemas.outputs,
                                  parameters:
                                      serverData.data?.schemas?.parameters ??
                                      inspectSchemas.parameters,
                              },
                          }
                        : {}),
                },
            } as Evaluator
        }

        if (!draft) return merged

        return {
            ...merged,
            ...draft,
            data: {
                ...merged.data,
                ...draft.data,
            },
        } as Evaluator
    }),
)

/**
 * Query state selector for the bridge interface.
 */
const evaluatorRevisionQueryStateAtomFamily = atomFamily((revisionId: string) =>
    atom<QueryState<Evaluator>>((get) => {
        const query = get(evaluatorRevisionQueryAtomFamily(revisionId))
        return {
            data: query.data ?? null,
            isPending: query.isPending ?? false,
            isError: query.isError ?? false,
            error: query.error ?? null,
        }
    }),
)

/**
 * Is the revision dirty (has local edits)?
 */
const evaluatorRevisionIsDirtyAtomFamily = atomFamily((revisionId: string) =>
    atom<boolean>((get) => {
        const draft = get(evaluatorRevisionDraftAtomFamily(revisionId))
        return draft !== null
    }),
)

// ============================================================================
// MOLECULE
// ============================================================================

/**
 * Evaluator revision molecule.
 *
 * Provides the standard molecule interface (selectors.data, selectors.query,
 * selectors.isDirty) plus evaluator-specific extras (presets, applyPreset).
 */
export const evaluatorRevisionMolecule = {
    selectors: {
        data: (revisionId: string): Atom<unknown | null> =>
            evaluatorRevisionEntityAtomFamily(revisionId),
        query: (revisionId: string): Atom<QueryState> =>
            evaluatorRevisionQueryStateAtomFamily(revisionId),
        isDirty: (revisionId: string): Atom<boolean> =>
            evaluatorRevisionIsDirtyAtomFamily(revisionId),
        /** Returns empty array - presets not yet implemented */
        presets: (_id: string) => atom<SettingsPreset[]>(() => []),
    },
    actions: {
        /** No-op - preset application not yet implemented */
        applyPreset: atom(
            null,
            (_get, _set, _payload: {revisionId: string; preset: SettingsPreset}) => {
                // TODO: implement preset application
            },
        ),
        /** No-op - update not yet implemented for evaluator revisions */
        update: atom(null, (_get, _set, _id: string, _updates: unknown) => {}),
        /** No-op - discard not yet implemented for evaluator revisions */
        discard: atom(null, (_get, _set, _id: string) => {}),
    },
}
