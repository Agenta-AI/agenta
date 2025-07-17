import {useCallback, useMemo} from "react"

import useSWR, {useSWRConfig} from "swr"
import {v4 as uuidv4} from "uuid"

import {getAppValues} from "@/oss/contexts/app.context"
import {getCurrentProject} from "@/oss/contexts/project.context"
import {EvaluationStatus, TestSet} from "@/oss/lib/Types"
import {slugify} from "@/oss/lib/utils/slugify"
import {createEvaluationRunConfig} from "@/oss/services/evaluationRuns/api"
import {CreateEvaluationRunInput} from "@/oss/services/evaluationRuns/api/types"
import {useTestsets} from "@/oss/services/testsets/api"

import axios from "../../api/assets/axiosConfig"
import {EvaluationType} from "../../enums"
import {snakeToCamelCaseKeys} from "../../helpers/casing"
import {SnakeToCamelCaseKeys} from "../../Types"
import {buildRunIndex} from "../useEvaluationRunData/assets/helpers/buildRunIndex"
import {getEvaluationRunScenariosKey} from "../useEvaluationRunScenarios"
import useEvaluators from "../useEvaluators"

import useEnrichEvaluationRun from "./assets/utils"
import {EnrichedEvaluationRun, EvaluationRun} from "./types"

const SCENARIOS_ENDPOINT = "/preview/evaluations/scenarios/"

/**
 * Custom hook to manage and enrich preview evaluation runs.
 * Fetches preview runs from SWR, enriches them with related metadata (testset, variant, evaluators),
 * and sorts them by creation timestamp descending.
 *
 * @param skip - Optional flag to skip fetching preview evaluations.
 * @returns Object containing SWR response, enriched runs, and a function to trigger new evaluation creation.
 */
const usePreviewEvaluations = ({
    skip,
    types: propsTypes = [],
    debug,
}: {skip?: boolean; types?: EvaluationType[]; debug?: boolean} = {}): {
    swrData: typeof evaluationRunsSwr
    createNewRun: (paramInputs: CreateEvaluationRunInput) => Promise<any>
    runs: EnrichedEvaluationRun[]
} => {
    const types = useMemo(() => {
        return propsTypes.map((type) => {
            switch (type) {
                case EvaluationType.single_model_test:
                case EvaluationType.human:
                    return EvaluationType.human
                default:
                    return type
            }
        })
    }, [propsTypes])
    const {currentApp} = getAppValues()
    const {mutate: globalMutate} = useSWRConfig()
    const appId = currentApp?.app_id
    const {data: humanEvaluators} = useEvaluators({
        preview: true,
        queries: {
            is_human: true,
        },
    })

    /**
     * SWR hook to fetch preview evaluation runs.
     */
    const evaluationsQueryFetcher = useCallback(async () => {
        // Build dynamic step filters
        const stepFilters: any[] = [
            {
                references: {
                    application: {id: appId},
                },
            },
        ]
        // If the consumer requested human evaluations, require a step that references *any* evaluator
        if (types.includes(EvaluationType.human)) {
            if (Array.isArray(humanEvaluators) && humanEvaluators.length > 0) {
                humanEvaluators.forEach((ev) => {
                    stepFilters.push({
                        references: {
                            evaluator: {id: ev.id},
                        },
                    })
                })
            } else {
                // Fallback: any evaluator reference
                stepFilters.push({
                    references: {
                        evaluator: {},
                    },
                })
            }
        }
        const response = await axios.post(`/preview/evaluations/runs/query`, {
            run: {
                data: {
                    steps: [...stepFilters],
                },
            },
        })
        return {
            runs: (response.data?.runs || []).map((run: EvaluationRun) =>
                snakeToCamelCaseKeys<EvaluationRun>(run),
            ),
            count: response.data.count,
        } as {
            runs: SnakeToCamelCaseKeys<EvaluationRun>[]
            count: number
        }
    }, [appId])

    const evaluationRunsSwr = useSWR(
        skip || !appId ? null : `/preview/evaluations/runs/query?app_id=${appId}`,
        evaluationsQueryFetcher,
    )
    /**
     * Hook to fetch testsets data.
     */
    const {data: testsets} = useTestsets()
    const {data: previewTestsets} = useTestsets(true)
    const enrichRun = useEnrichEvaluationRun({debug})

    /**
     * Helper to create scenarios for a given run and testset.
     * Each CSV row becomes its own scenario.
     */
    const createScenarios = useCallback(
        async (
            runId: string,
            testset: TestSet & {data: {testcaseIds?: string[]; testcases?: {id: string}[]}},
        ): Promise<string[]> => {
            if (!testset?.id) {
                throw new Error(`Testset with id ${testset.id} not found.`)
            }
            if (debug) {
                console.debug("[usePreviewEvaluations] createScenarios: start for run", {
                    runId,
                    testsetId: testset.id,
                })
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
            if (debug) {
                console.debug("[usePreviewEvaluations] createScenarios: payload for scenarios", {
                    payloadScenarioLength: payload.scenarios.length,
                    payload,
                })
            }

            // 2. Invoke the scenario endpoint
            const response = await axios.post(SCENARIOS_ENDPOINT, payload)

            if (debug) {
                console.debug(
                    "[usePreviewEvaluations] createScenarios: received response",
                    response.data,
                )
            }
            // Extract and return new scenario IDs
            return response.data.scenarios.map((s: any) => s.id)
        },
        [testsets, debug],
    )

    /**
     * Helper to compute enriched and sorted runs (lazy) when accessed.
     */
    const computeRuns = useCallback((): EnrichedEvaluationRun[] => {
        if (!evaluationRunsSwr.data?.runs) return []
        const enriched: EnrichedEvaluationRun[] = evaluationRunsSwr.data.runs.map((_run) => {
            const runClone = structuredClone(_run)
            const runIndex = buildRunIndex(runClone)
            return enrichRun!(runClone, previewTestsets?.testsets || [], runIndex)
        })
        if (debug) {
            console.debug("[usePreviewEvaluations] Final enriched and sorted runs", enriched)
        }
        // Sort enriched runs by timestamp, descending
        return enriched.sort((a, b) => {
            const tA = new Date(a.createdAtTimestamp || 0).getTime()
            const tB = new Date(b.createdAtTimestamp || 0).getTime()
            return tB - tA
        })
    }, [evaluationRunsSwr.data?.runs, previewTestsets, enrichRun])

    const createNewRun = useCallback(
        async (paramInputs: CreateEvaluationRunInput) => {
            // JIT migrate old testsets before creating a new run
            if (!paramInputs.testset || !paramInputs.testset._id) {
                throw new Error("Testset is required and must have an _id for migration.")
            }
            try {
                // 1. Converts the old testset to the new format
                const result = await axios.post(
                    `/preview/simple/testsets/${paramInputs.testset._id}/transfer`,
                )

                if (result?.data?.testset) {
                    paramInputs.testset = snakeToCamelCaseKeys(result.data.testset)
                }

                if (debug) {
                    console.debug(
                        `[usePreviewEvaluations] JIT migration completed for testset`,
                        paramInputs.testset.id,
                    )
                }
            } catch (migrationErr: any) {
                if (debug) {
                    console.error(
                        `[usePreviewEvaluations] JIT migration failed for testset`,
                        paramInputs.testset._id,
                        migrationErr,
                    )
                }
                throw new Error(
                    `Failed to migrate testset before creating run: ${migrationErr?.message || migrationErr}`,
                )
            }

            if (debug) {
                console.debug(
                    "[usePreviewEvaluations] createNewRun: preparing to send request",
                    paramInputs,
                )
            }
            // 2. Creates the the payload schema
            const params = createEvaluationRunConfig(paramInputs)

            console.log("createEvaluationRunConfig params:", params)

            if (debug) {
                console.debug(
                    "[usePreviewEvaluations] createNewRun: constructed request payload",
                    params,
                )
            }
            // 3. Invokes run endpoint
            const response = await axios.post("/preview/evaluations/runs/", params)

            if (debug) {
                console.debug(
                    "[usePreviewEvaluations] createNewRun: received response",
                    response.data,
                )
            }
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

            if (debug) {
                console.debug(
                    "[usePreviewEvaluations] createNewRun: created scenarios",
                    scenarioIds,
                )
            }
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
                                key: inputKey,
                            },
                            {
                                ...base,
                                key: invocationKey,
                            },
                        ]

                        evaluators.forEach((ev) => {
                            stepsArray.push({
                                ...base,
                                key: `${invocationKey}.${ev.slug}`,
                            })
                        })
                        return stepsArray
                    },
                )
                // 7. Invoke the /steps endpoint
                axios
                    .post(
                        `/preview/evaluations/steps/?project_id=${getCurrentProject().projectId}`,
                        {steps: allSteps},
                    )
                    .then((res) => {
                        if (debug) {
                            console.debug(
                                "[usePreviewEvaluations] createNewRun: all steps created",
                                res.data,
                            )
                        }
                        // Revalidate scenarios data
                        globalMutate(getEvaluationRunScenariosKey(runId))
                    })
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
            await evaluationRunsSwr.mutate()
            // Return both run response and scenario IDs
            return {
                run: response.data,
                scenarios: scenarioIds,
            }
        },
        [debug, createScenarios, globalMutate, evaluationRunsSwr],
    )

    return {
        swrData: evaluationRunsSwr,
        createNewRun,
        get runs() {
            return enrichRun ? computeRuns() : []
        },
    }
}

export default usePreviewEvaluations
