/* eslint-disable import/order */
import {useCallback, useMemo} from "react"

import {EvaluationStatus} from "@agenta/entities/evaluationRun"
import type {OpenAPISpec} from "@agenta/entities/shared/openapi"
import {fetchRevision} from "@agenta/entities/testset"
import {testcasesResponseSchema, type Testcase as PreviewTestcase} from "@agenta/entities/testcase"
import {
    appOpenApiSchemaAtomFamily,
    appRoutePathAtomFamily,
    workflowMolecule,
} from "@agenta/entities/workflow"
import {axios} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import type {SnakeToCamelCaseKeys} from "@agenta/shared/types"
import {getDefaultStore, useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {createEvaluationRun} from "../../controllers"
import {
    buildRunConfig,
    buildRunIndex,
    type RevisionSchemaContext,
    type RunConfigTestset,
} from "../../core"

import {fetchPreviewRunsShared} from "./assets/previewRunsRequest"
import type {CreateEvaluationRunInput, OssTestset, RunFlagsFilter} from "./previewTypes"

export type {RunFlagsFilter}

const EMPTY_RUNS: SnakeToCamelCaseKeys<EvaluationRun>[] = []
export interface PreviewEvaluationRunsData {
    runs: SnakeToCamelCaseKeys<EvaluationRun>[]
    count: number
}

interface PreviewEvaluationRunsQueryParams {
    projectId?: string
    appId?: string
    searchQuery?: string
    references: unknown[]
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
    mutate: () => Promise<unknown>
    refetch: () => Promise<unknown>
    isLoading: boolean
    isPending: boolean
    isError: boolean
    error: unknown
}
import {searchQueryAtom} from "./states/queryFilterAtoms"
import {EnrichedEvaluationRun, EvaluationRun} from "./types"

/**
 * Testset enriched with the testcase ids/rows the creation flow hydrates onto it.
 * `OssTestset` doesn't model `data`, so we widen it locally.
 */
type TestsetWithData = OssTestset & {
    slug?: string | null
    data?: {
        testcaseIds?: string[]
        testcases?: {id: string; data?: Record<string, unknown>}[]
        [key: string]: unknown
    }
}

/** Eval-type discriminants the hook branches on (formerly OSS `EvaluationType`). */
export type PreviewEvaluationFilterType = "human" | "online" | "automatic" | "single_model_test"

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
    isCustomApp = false,
}: {
    skip?: boolean
    types?: PreviewEvaluationFilterType[]
    debug?: boolean
    appId?: string | null
    flags?: RunFlagsFilter
    /**
     * Whether the current app is a custom workflow. Injected by the OSS caller from
     * `currentAppContextAtom.appType === "custom"` — the headless package can't read that
     * OSS atom. Used only when constructing run config in `createNewRun`.
     */
    isCustomApp?: boolean
} = {}): {
    swrData: PreviewEvaluationsQueryState
    createNewRun: (paramInputs: CreateEvaluationRunInput) => Promise<{
        runId: string
        runIds: string[]
        scenarios: string[]
    }>
    runs: EnrichedEvaluationRun[]
} => {
    // atoms
    const searchQuery = useAtomValue(searchQueryAtom)
    const projectId = useAtomValue(projectIdAtom) ?? undefined

    const debugEnabled = debug ?? process.env.NODE_ENV !== "production"

    const types = useMemo(() => {
        return propsTypes.map((type) => {
            switch (type) {
                case "single_model_test":
                case "human":
                    return "human" as const
                case "automatic":
                case "online":
                    return "automatic" as const
                default:
                    return type
            }
        })
    }, [propsTypes])

    const appId = appIdOverride || undefined

    // Derive effective flags based on types (e.g., online implies is_live=true by default)
    const effectiveFlags = useMemo(() => {
        const base = {...(flags || {})}
        if (propsTypes.includes("online") && base.is_live === undefined) {
            base.is_live = true
        }
        return base
    }, [flags, propsTypes])

    const referenceFilters = useMemo(() => {
        const filters: {application: {id: string}}[] = []
        if (appId) {
            filters.push({
                application: {id: appId},
            })
        }
        return filters
    }, [appId])

    // const effectiveEvalType = useMemo(() => {
    //     if (propsTypes.includes("online")) return "online" as const
    //     if (types.includes("automatic")) return "auto" as const
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
        const queryState = evaluationRunsQuery as {
            isPending?: boolean
            isLoading?: boolean
            isFetching?: boolean
            isError?: boolean
        }
        const isPending = queryState.isPending ?? false
        const isLoading = queryState.isLoading ?? queryState.isFetching ?? isPending
        const combinedPending = isPending || isEnrichmentPending
        const combinedLoading = isLoading || isEnrichmentPending
        const data = queryEnabled ? evaluationRunsQuery.data : {runs: [], count: 0}
        return {
            data,
            mutate: async () => evaluationRunsQuery.refetch(),
            refetch: evaluationRunsQuery.refetch,
            isLoading: combinedLoading,
            isPending: combinedPending,
            isError: queryEnabled ? (queryState.isError ?? false) : false,
            error: queryEnabled ? evaluationRunsQuery.error : undefined,
        }
    }, [evaluationRunsQuery, queryEnabled, isEnrichmentPending])

    /**
     * Helper to compute enriched and sorted runs (lazy) when accessed.
     */
    const computeRuns = useCallback((): EnrichedEvaluationRun[] => {
        if (!rawRuns.length) return []
        const isOnline = propsTypes.includes("online")
        const enriched: EnrichedEvaluationRun[] = rawRuns
            .map((_run) => {
                const runClone = structuredClone(_run) as EnrichedEvaluationRun & {
                    runIndex?: ReturnType<typeof buildRunIndex>
                    flags?: {isActive?: boolean}
                    status?: unknown
                    data?: {status?: unknown} & Record<string, unknown>
                }
                const runIndex = buildRunIndex(runClone)
                runClone.runIndex = runIndex
                // const result = enrichRun(runClone, previewTestsets?.testsets || [], runIndex)
                if (runClone && isOnline) {
                    const flags = runClone.flags || {}

                    if (flags?.isActive === false) {
                        runClone.status = EvaluationStatus.CANCELLED
                        if (runClone.data) {
                            runClone.data.status = EvaluationStatus.CANCELLED
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
            const rawTestset = paramInputs.testset as
                | (TestsetWithData & {revisionId?: string})
                | undefined

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
            const isCustom = isCustomApp
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
                ...paramInputs,
                testset: paramInputs.testset as RunConfigTestset | undefined,
                meta: {
                    ...(paramInputs.meta || {}),
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
        [evaluationRunsState, projectId, isCustomApp],
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
