import {useCallback} from "react"

import {useSetAtom} from "jotai"
import useSWR, {SWRConfiguration} from "swr"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {snakeToCamelCaseKeys} from "@/oss/lib/helpers/casing"

import {evalAtomStore, loadingStateAtom} from "../useEvaluationRunData/assets/atoms"
import {evaluationRunStateFamily} from "../useEvaluationRunData/assets/atoms/runScopedAtoms"

import {IScenario, ScenarioResponse, UseEvaluationRunScenariosOptions} from "./types"

// Fetcher factory that posts a query to the new endpoint and syncs atoms of current store
const makeFetcher = (
    endpoint: string,
    syncAtom: boolean,
    setLoading: ReturnType<typeof useSetAtom>,
    runId?: string | null,
    params?: UseEvaluationRunScenariosOptions,
): (() => Promise<{
    scenarios: IScenario[]
    count: number
    next?: string
}>) => {
    return () => {
        if (syncAtom) {
            setLoading((draft) => {
                draft.isLoadingScenarios = true
                draft.isLoadingEvaluation = false
                draft.activeStep = "scenarios"
            })
        }

        // Build request body for /preview/evaluations/scenarios/query
        const body: Record<string, any> = {
            scenario: {
                ...(runId ? {run_ids: [runId]} : {}),
            },
            windowing: {
                ...(params?.limit !== undefined ? {limit: params.limit} : {}),
                ...(params?.next ? {next: params.next} : {}),
            },
        }

        return axios.post(endpoint, body).then((res) => {
            const raw = res.data
            const scenarios = Array.isArray(raw.scenarios)
                ? (raw.scenarios.map((scenario: ScenarioResponse, index: number) => ({
                      ...snakeToCamelCaseKeys<ScenarioResponse>(scenario),
                      scenarioIndex: (scenario.meta?.index || 0) + 1,
                  })) as IScenario[])
                : ([] as IScenario[])

            if (syncAtom) {
                setLoading((draft) => {
                    draft.isLoadingScenarios = false
                    draft.activeStep = null
                })
                // Only sync to run-scoped atom if runId is available
                if (runId) {
                    evalAtomStore().set(evaluationRunStateFamily(runId), (draft) => {
                        draft.scenarios = scenarios
                    })
                }
            }
            return {
                scenarios,
                count: raw.count as number,
                next: raw.next as string | undefined,
            }
        })
    }
}

/**
 * @deprecated
 * @param runId
 * @param params
 * @returns
 */
export const getEvaluationRunScenariosKey = (
    runId?: string | null | undefined,
    params?: UseEvaluationRunScenariosOptions,
) => {
    if (!runId) return null
    const parts: string[] = ["scenarios-query", `run:${runId}`]
    if (params?.limit !== undefined) parts.push(`limit:${params.limit}`)
    if (params?.next) parts.push(`next:${params.next}`)
    return parts.join("|")
}
/**
 * @deprecated
 * Hook to fetch scenarios belonging to a specific evaluation run,
 * plus some “progress” aggregates (pending vs. completed).
 *
 * @param runId    The UUID of the run. If falsy, fetching is skipped.
 * @param params   Optional pagination: { limit, next }.
 */

interface UseEvaluationRunScenariosHookOptions extends SWRConfiguration {
    syncAtom?: boolean
}
const useEvaluationRunScenarios = (
    runId: string | null | undefined,
    params?: UseEvaluationRunScenariosOptions,
    {syncAtom = true, ...options}: UseEvaluationRunScenariosHookOptions = {},
) => {
    const setLoading = useSetAtom(loadingStateAtom)

    // Build query string only if runId is provided
    const swrKey = getEvaluationRunScenariosKey(runId, params)

    const fetcher = useCallback(
        makeFetcher("/preview/evaluations/scenarios/query", syncAtom, setLoading, runId, params),
        [syncAtom, setLoading, runId, params?.limit, params?.next],
    )

    const swrData = useSWR<{
        scenarios: IScenario[]
        count: number
        next?: string
    }>(swrKey ? `${swrKey}-${syncAtom}` : null, swrKey ? fetcher : null, {
        ...options,
        revalidateIfStale: false,
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
    })

    return swrData
}

export default useEvaluationRunScenarios
