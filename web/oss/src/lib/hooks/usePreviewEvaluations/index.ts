/* eslint-disable import/order */
import {useCallback, useEffect, useMemo} from "react"

import {useAtomValue, useSetAtom} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"
import {useSWRConfig} from "swr"
import {v4 as uuidv4} from "uuid"

import {useAppId} from "@/oss/hooks/useAppId"
import axios from "@/oss/lib/api/assets/axiosConfig"
import {EvaluationType} from "@/oss/lib/enums"
import {buildRunIndex} from "@/oss/lib/evaluations/buildRunIndex"
import {snakeToCamelCaseKeys} from "@/oss/lib/helpers/casing"
import {EvaluationStatus, SnakeToCamelCaseKeys, Testset} from "@/oss/lib/Types"
import {slugify} from "@/oss/lib/utils/slugify"
import {createEvaluationRunConfig} from "@/oss/services/evaluationRuns/api"
import {CreateEvaluationRunInput} from "@/oss/services/evaluationRuns/api/types"
import {fetchTestset} from "@/oss/services/testsets/api"
import {getProjectValues} from "@/oss/state/project"
import {setProjectVariantReferencesAtom} from "@/oss/state/projectVariantConfig"
import {usePreviewTestsetsData, useTestsetsData} from "@/oss/state/testset"

import {primePreviewRunCache} from "./assets/previewRunBatcher"
import {fetchPreviewRunsShared} from "./assets/previewRunsRequest"
import {collectProjectVariantReferences} from "./projectVariantConfigs"

const EMPTY_RUNS: any[] = []
export interface PreviewEvaluationRunsData {
    runs: SnakeToCamelCaseKeys<EvaluationRun>[]
    count: number
}

export interface RunFlagsFilter {
    is_live?: boolean
    is_active?: boolean
    is_closed?: boolean
    has_queries?: boolean
    has_testsets?: boolean
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

                primePreviewRunCache(projectId, response.runs)

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

const SCENARIOS_ENDPOINT = "/preview/evaluations/scenarios/"

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
                case EvaluationType.auto_exact_match:
                case EvaluationType.automatic:
                case EvaluationType.online:
                    return EvaluationType.automatic
                default:
                    return type
            }
        })
    }, [propsTypes])

    const {mutate: globalMutate} = useSWRConfig()
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
    const setProjectVariantReferences = useSetAtom(setProjectVariantReferencesAtom)

    useEffect(() => {
        if (!projectId) {
            setProjectVariantReferences([])
            return
        }
        if (appId) {
            setProjectVariantReferences([])
            return
        }
        const references = collectProjectVariantReferences(rawRuns, projectId)
        setProjectVariantReferences(references)
        // prefetchProjectVariantConfigs(references)
    }, [appId, projectId, rawRuns, setProjectVariantReferences])

    /**
     * Hook to fetch testsets data.
     */
    const {testsets} = useTestsetsData()
    const {testsets: _previewTestsets} = usePreviewTestsetsData()

    /**
     * Helper to create scenarios for a given run and testset.
     * Each CSV row becomes its own scenario.
     */
    const createScenarios = useCallback(
        async (
            runId: string,
            testset: Testset & {data: {testcaseIds?: string[]; testcases?: {id: string}[]}},
        ): Promise<string[]> => {
            if (!testset?.id) {
                throw new Error(`Testset with id ${testset.id} not found.`)
            }

            // 1. Build payload: each row becomes a scenario
            const payload = {
                scenarios: (
                    testset.data.testcaseIds ??
                    testset.data.testcases?.map((tc) => tc.id) ??
                    []
                ).map((_id, index) => ({
                    run_id: runId,
                    // meta: {index},
                })),
            }

            // 2. Invoke the scenario endpoint
            const response = await axios.post(SCENARIOS_ENDPOINT, payload)

            // Extract and return new scenario IDs
            return response.data.scenarios.map((s: any) => s.id)
        },
        [testsets, debug],
    )

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
            // JIT migrate old testsets before creating a new run
            if (!paramInputs.testset || !paramInputs.testset._id) {
                throw new Error("Testset is required and must have an _id for migration.")
            }
            try {
                // 1. Converts the old testset to the new format
                const existingPreviewQuery = await axios.get(
                    `/preview/simple/testsets/${paramInputs.testset._id}`,
                )
                const _existingQuery = await fetchTestset(paramInputs.testset._id, false)
                const existingPreview = existingPreviewQuery.data?.testset
                let testset
                if (!existingPreview) {
                    const result = await axios.post(
                        `/preview/simple/testsets/${paramInputs.testset._id}/transfer`,
                    )
                    testset = result.data.testset
                } else {
                    testset = existingPreview
                }

                if (testset) {
                    paramInputs.testset = snakeToCamelCaseKeys(testset)
                }
            } catch (migrationErr: any) {
                throw new Error(
                    `Failed to migrate testset before creating run: ${migrationErr?.message || migrationErr}`,
                )
            }

            // 2. Create payload: invocation origin=auto, annotation origin=human (handled by helper)
            const params = createEvaluationRunConfig({
                ...(paramInputs as any),
                meta: {
                    ...((paramInputs as any)?.meta || {}),
                    evaluation_kind: "human",
                },
            })

            // 3. Invoke preview run endpoint (include project for backend routing)
            const response = await axios.post(
                `/preview/evaluations/runs/?project_id=${projectId}`,
                params,
            )

            // 4. Refresh preview runs list and return created run
            await evaluationRunsState.mutate()

            // Extract the newly created runId
            const runId = response.data.runs?.[0]?.id
            if (!runId) {
                throw new Error("createNewRun: runId not returned in response.")
            }
            // Now create scenarios for each row in the specified testset
            if (!paramInputs.testset) {
                throw new Error("Testset is required to create scenarios")
            }
            // 4. Creates the scenarios
            const scenarioIds = await createScenarios(runId, paramInputs.testset)

            // Fire off input, invocation, and annotation steps together in one request (non-blocking)
            try {
                // const repeatId = uuidv4()
                // const retryId = uuidv4()
                // 5. First generate step keys & IDs per scenario
                const revision = paramInputs.revisions?.[0]
                const evaluators = paramInputs.evaluators || []
                const inputKey = slugify(
                    paramInputs.testset.name ?? paramInputs.testset.slug ?? "testset",
                    paramInputs.testset.id,
                )
                const invocationKey = revision
                    ? slugify(
                          (revision as any).name ??
                              (revision as any).variantName ??
                              (revision as any)._parentVariant?.variantName ??
                              "invocation",
                          revision.id,
                      )
                    : "invocation"

                const scenarioStepsData = scenarioIds.map((scenarioId, index) => {
                    const hashId = uuidv4()
                    return {
                        testcaseId:
                            paramInputs.testset?.data?.testcaseIds?.[index] ??
                            paramInputs.testset?.data?.testcases?.[index]?.id,
                        scenarioId,
                        hashId,
                    }
                })

                // 6. Build a single steps array combining input, invocation, and evaluator steps
                const allSteps = scenarioStepsData.flatMap(
                    ({scenarioId, testcaseId, repeatId, retryIdInput, hashId}) => {
                        const base = {
                            testcase_id: testcaseId,
                            scenario_id: scenarioId,
                            run_id: runId,
                        }
                        const stepsArray: any[] = [
                            {
                                ...base,
                                status: EvaluationStatus.SUCCESS,
                                step_key: inputKey,
                            },
                            {
                                ...base,
                                step_key: invocationKey,
                            },
                        ]

                        evaluators.forEach((ev) => {
                            stepsArray.push({
                                ...base,
                                step_key: `${invocationKey}.${ev.slug}`,
                            })
                        })
                        return stepsArray
                    },
                )
                // 7. Invoke the /results endpoint
                await axios
                    .post(`/preview/evaluations/results/?project_id=${projectId}`, {
                        results: allSteps,
                    })
                    // .then((res) => {
                    //     // Revalidate scenarios data
                    //     globalMutate(getEvaluationRunScenariosKey(runId))
                    // })
                    .catch((err) => {
                        console.error(
                            "[usePreviewEvaluations] createNewRun: failed to create steps",
                            err,
                        )
                    })
            } catch (err) {
                console.error("[usePreviewEvaluations] createNewRun: error scheduling steps", err)
            }
            // 8. Refresh SWR data for runs
            await evaluationRunsState.mutate()
            // Return both run response and scenario IDs
            return {
                run: response.data,
                scenarios: scenarioIds,
            }
        },
        [debug, globalMutate, evaluationRunsState, projectId, appId],
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
