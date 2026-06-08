/* eslint-disable import/order */
import {useCallback, useMemo} from "react"

import {buildRunConfig, createEvaluationRun, type RevisionSchemaContext} from "@agenta/evaluations"
import type {OpenAPISpec} from "@agenta/entities/shared/openapi"
import {
    appOpenApiSchemaAtomFamily,
    appRoutePathAtomFamily,
    workflowMolecule,
} from "@agenta/entities/workflow"
import {getDefaultStore, useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {useAppId} from "@/oss/hooks/useAppId"
import axios from "@/oss/lib/api/assets/axiosConfig"
import {EvaluationType} from "@/oss/lib/enums"
import {buildRunIndex} from "@/oss/lib/evaluations/buildRunIndex"
import {EvaluationStatus, SnakeToCamelCaseKeys, Testset} from "@/oss/lib/Types"
import {CreateEvaluationRunInput} from "@/oss/services/evaluationRuns/api/types"
import {currentAppContextAtom} from "@/oss/state/app/selectors/app"
import {getProjectValues} from "@/oss/state/project"
import {fetchRevision} from "@/oss/state/entities/testset"
import {
    testcasesResponseSchema,
    type Testcase as PreviewTestcase,
} from "@/oss/state/entities/testcase/schema"

import {fetchPreviewRunsShared} from "./assets/previewRunsRequest"

const EMPTY_RUNS: any[] = []
export interface PreviewEvaluationRunsData {
    runs: SnakeToCamelCaseKeys<EvaluationRun>[]
    count: number
}

export interface RunFlagsFilter {
    is_live?: boolean
    is_active?: boolean
    is_closed?: boolean
    is_queue?: boolean
    has_queries?: boolean
    has_testsets?: boolean
    has_testcases?: boolean
    has_traces?: boolean
    has_evaluators?: boolean
    has_custom?: boolean
    has_human?: boolean
    has_auto?: boolean
}

interface PreviewEvaluationRunsQueryParams {
    projectId?: string
    appId?: string
    searchQuery?: string
    references: any[]
    typesKey: string
    debug: boolean
    enabled: boolean
    flags?: RunFlagsFilter
    evaluationTypes?: string[]
    statuses?: string[] | null
}

const previewEvaluationRunsQueryAtomFamily = atomFamily((serializedParams: string) =>
    atomWithQuery<PreviewEvaluationRunsData>(() => {
        const params = JSON.parse(serializedParams) as PreviewEvaluationRunsQueryParams
        const {
            projectId,
            appId,
            searchQuery,
            references,
            typesKey,
            enabled,
            flags,
            evaluationTypes,
            statuses,
        } = params

        return {
            queryKey: [
                "previewEvaluationRuns",
                projectId ?? "none",
                appId ?? "all",
                typesKey,
                searchQuery ?? "",
                JSON.stringify(references ?? []),
                JSON.stringify(flags ?? {}),
                JSON.stringify(evaluationTypes ?? []),
                JSON.stringify(statuses ?? null),
            ],
            enabled,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            queryFn: async () => {
                if (!projectId) {
                    return {runs: [], count: 0}
                }

                const response = await fetchPreviewRunsShared({
                    projectId,
                    appId,
                    searchQuery,
                    references,
                    flags,
                    evaluationTypes,
                    statuses,
                })

                return {
                    runs: response.runs as SnakeToCamelCaseKeys<EvaluationRun>[],
                    count: response.count,
                }
            },
        }
    }),
)

export {previewEvaluationRunsQueryAtomFamily}

interface PreviewEvaluationsQueryState {
    data?: PreviewEvaluationRunsData
    mutate: () => Promise<any>
    refetch: () => Promise<any>
    isLoading: boolean
    isPending: boolean
    isError: boolean
    error: unknown
}
import {searchQueryAtom} from "./states/queryFilterAtoms"
import {EnrichedEvaluationRun, EvaluationRun} from "./types"

/**
 * Testset enriched with the testcase ids/rows the creation flow hydrates onto it.
 * `Testset` (from lib/Types) doesn't model `data`, so we widen it locally.
 */
type TestsetWithData = Testset & {
    slug?: string | null
    data?: {
        testcaseIds?: string[]
        testcases?: {id: string; data?: Record<string, unknown>}[]
        [key: string]: unknown
    }
}

/**
 * Custom hook to manage and enrich preview evaluation runs.
 * Fetches preview runs via a shared atom query, enriches them with related metadata (testset, variant, evaluators),
 * and sorts them by creation timestamp descending.
 *
 * @param skip - Optional flag to skip fetching preview evaluations.
 * @returns Object containing SWR response, enriched runs, and a function to trigger new evaluation creation.
 */
const usePreviewEvaluations = ({
    skip,
    types: propsTypes = [],
    debug,
    flags,
    appId: appIdOverride,
}: {
    skip?: boolean
    types?: EvaluationType[]
    debug?: boolean
    appId?: string | null
    flags?: RunFlagsFilter
} = {}): {
    swrData: PreviewEvaluationsQueryState
    createNewRun: (paramInputs: CreateEvaluationRunInput) => Promise<any>
    runs: EnrichedEvaluationRun[]
} => {
    // atoms
    const searchQuery = useAtomValue(searchQueryAtom)
    const projectId = getProjectValues().projectId

    const debugEnabled = debug ?? process.env.NODE_ENV !== "production"

    const types = useMemo(() => {
        return propsTypes.map((type) => {
            switch (type) {
                case EvaluationType.single_model_test:
                case EvaluationType.human:
                    return EvaluationType.human
                case EvaluationType.automatic:
                case EvaluationType.online:
                    return EvaluationType.automatic
                default:
                    return type
            }
        })
    }, [propsTypes])

    const routeAppId = useAppId()
    const appId = (appIdOverride ?? routeAppId) || undefined

    // Derive effective flags based on types (e.g., online implies is_live=true by default)
    const effectiveFlags = useMemo(() => {
        const base = {...(flags || {})}
        if (propsTypes.includes(EvaluationType.online) && base.is_live === undefined) {
            base.is_live = true
        }
        return base
    }, [flags, propsTypes])

    const referenceFilters = useMemo(() => {
        const filters: any[] = []
        if (appId) {
            filters.push({
                application: {id: appId},
            })
        }
        return filters
    }, [appId])

    // const effectiveEvalType = useMemo(() => {
    //     if (propsTypes.includes(EvaluationType.online)) return "online" as const
    //     if (types.includes(EvaluationType.automatic)) return "auto" as const
    //     return "human" as const
    // }, [propsTypes, types])

    const typesKey = useMemo(() => types.slice().sort().join("|"), [types])
    const queryEnabled = !skip && Boolean(projectId)
    const isEnrichmentPending = queryEnabled

    const serializedQueryParams = useMemo(
        () =>
            JSON.stringify({
                projectId,
                appId,
                searchQuery,
                references: referenceFilters,
                typesKey,
                debug: debugEnabled,
                enabled: queryEnabled,
                flags: effectiveFlags,
            }),
        [
            projectId,
            appId,
            searchQuery,
            referenceFilters,
            typesKey,
            debugEnabled,
            queryEnabled,
            effectiveFlags,
        ],
    )

    const evaluationRunsAtom = useMemo(
        () => previewEvaluationRunsQueryAtomFamily(serializedQueryParams),
        [serializedQueryParams],
    )

    const evaluationRunsQuery = useAtomValue(evaluationRunsAtom)

    const rawRuns = queryEnabled ? (evaluationRunsQuery.data?.runs ?? EMPTY_RUNS) : EMPTY_RUNS

    const evaluationRunsState = useMemo<PreviewEvaluationsQueryState>(() => {
        const isPending = (evaluationRunsQuery as any).isPending ?? false
        const isLoading =
            (evaluationRunsQuery as any).isLoading ??
            (evaluationRunsQuery as any).isFetching ??
            isPending
        const combinedPending = isPending || isEnrichmentPending
        const combinedLoading = isLoading || isEnrichmentPending
        const data = queryEnabled ? evaluationRunsQuery.data : {runs: [], count: 0}
        return {
            data,
            mutate: async () => evaluationRunsQuery.refetch(),
            refetch: evaluationRunsQuery.refetch,
            isLoading: combinedLoading,
            isPending: combinedPending,
            isError: queryEnabled ? ((evaluationRunsQuery as any).isError ?? false) : false,
            error: queryEnabled ? evaluationRunsQuery.error : undefined,
        }
    }, [evaluationRunsQuery, queryEnabled, isEnrichmentPending])

    /**
     * Helper to compute enriched and sorted runs (lazy) when accessed.
     */
    const computeRuns = useCallback((): EnrichedEvaluationRun[] => {
        if (!rawRuns.length) return []
        const isOnline = propsTypes.includes(EvaluationType.online)
        const enriched: EnrichedEvaluationRun[] = rawRuns
            .map((_run) => {
                const runClone = structuredClone(_run)
                const runIndex = buildRunIndex(runClone)
                runClone.runIndex = runIndex
                // const result = enrichRun(runClone, previewTestsets?.testsets || [], runIndex)
                if (runClone && isOnline) {
                    const flags = (runClone as any).flags || {}

                    if (flags?.isActive === false) {
                        ;(runClone as any).status = EvaluationStatus.CANCELLED
                        if (runClone.data) {
                            ;(runClone.data as any).status = EvaluationStatus.CANCELLED
                        }
                    }
                }
                return runClone
            })
            .filter((run): run is EnrichedEvaluationRun => Boolean(run))

        // Sort enriched runs by timestamp, descending
        return enriched.sort((a, b) => {
            const tA = new Date(a.createdAtTimestamp || 0).getTime()
            const tB = new Date(b.createdAtTimestamp || 0).getTime()
            return tB - tA
        })
    }, [rawRuns, debug, propsTypes])

    const createNewRun = useCallback(
        async (paramInputs: CreateEvaluationRunInput) => {
            const rawTestset: any = paramInputs.testset

            // Prefer revision-based hydration when a revisionId is provided
            if (rawTestset?.revisionId) {
                if (!projectId) {
                    throw new Error("Project id is required to fetch testset revision.")
                }

                const revision = await fetchRevision({id: rawTestset.revisionId, projectId})

                // Fetch all testcases for this revision so we can derive columns and IDs
                const allTestcases: PreviewTestcase[] = []
                let cursor: string | null = null

                // Paginate through /testcases/query until no more pages
                do {
                    const response = await axios.post(
                        "/testcases/query",
                        {
                            testset_revision_ref: {id: revision.id},
                            windowing: {
                                limit: 500,
                                ...(cursor ? {next: cursor} : {}),
                            },
                        },
                        {params: {project_id: projectId}},
                    )

                    const parsed = testcasesResponseSchema.parse(response.data)
                    allTestcases.push(...parsed.testcases)
                    cursor = parsed.windowing?.next ?? null
                } while (cursor)

                const testcaseIds = allTestcases.map((tc) => tc.id).filter(Boolean)
                const testcaseRows = allTestcases.map((tc) => ({
                    id: tc.id,
                    data: tc.data ?? {},
                }))

                const hydratedTestset: TestsetWithData = {
                    ...(rawTestset as TestsetWithData),
                    id: revision.testset_id,
                    // Prefer explicit name from caller, then revision name, then fallback
                    name: (rawTestset.name as string) ?? (revision.name as string) ?? "Test set",
                    // Provide testcaseIds and testcases so mappings & scenarios can use them
                    data: {
                        ...(rawTestset.data ?? {}),
                        testcaseIds,
                        testcases: testcaseRows,
                    },
                }

                paramInputs.testset = hydratedTestset
            }

            if (!projectId) {
                throw new Error("Project id is required to create an evaluation run.")
            }
            if (!paramInputs.testset) {
                throw new Error("Testset is required to create an evaluation run.")
            }

            // Resolve the per-revision schema context from the live playground/workflow
            // atoms here (the app supplies inputs), then hand plain data to the headless
            // @agenta/evaluations package — it owns config construction + creation.
            const store = getDefaultStore()
            const isCustom =
                (store.get(currentAppContextAtom) as {appType?: unknown} | undefined)?.appType ===
                "custom"
            const schemaContextByRevisionId: Record<string, RevisionSchemaContext> = {}
            for (const rev of paramInputs.revisions ?? []) {
                const spec = (store.get(appOpenApiSchemaAtomFamily(rev.id)) ??
                    null) as OpenAPISpec | null
                const routePath = store.get(appRoutePathAtomFamily(rev.id)) || ""
                const inputSchema = store.get(workflowMolecule.selectors.inputSchema(rev.id)) as
                    | {properties?: Record<string, unknown>}
                    | undefined
                schemaContextByRevisionId[rev.id] = {
                    isCustom,
                    spec,
                    routePath,
                    inputSchemaProperties: inputSchema?.properties ?? null,
                }
            }

            const {runs} = buildRunConfig({
                ...(paramInputs as any),
                meta: {
                    ...((paramInputs as any)?.meta || {}),
                    evaluation_kind: "human",
                },
                schemaContextByRevisionId,
            })

            const hydratedTs = paramInputs.testset as TestsetWithData
            const testcaseIds = (
                hydratedTs.data?.testcaseIds ??
                hydratedTs.data?.testcases?.map((tc) => tc.id) ??
                []
            ).filter(Boolean)

            // Orchestrates createRuns -> createScenarios -> setResults with rollback on
            // partial failure. Throws EvaluationRunCreationError if creation fails.
            const result = await createEvaluationRun({projectId, runs, testcaseIds})

            // Refresh the preview runs list.
            await evaluationRunsState.mutate()

            return {
                runId: result.runId,
                runIds: result.runIds,
                scenarios: result.scenarioIds,
            }
        },
        [evaluationRunsState, projectId],
    )

    return {
        swrData: evaluationRunsState,
        createNewRun,
        get runs() {
            return computeRuns() || []
        },
    }
}

export default usePreviewEvaluations
