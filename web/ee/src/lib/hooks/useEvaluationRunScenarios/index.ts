import {useCallback} from "react"

import {useSetAtom} from "jotai"
import useSWR, {SWRConfiguration} from "swr"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {snakeToCamelCaseKeys} from "@/oss/lib/helpers/casing"

import {
    evalAtomStore,
    evaluationRunStateAtom,
    loadingStateAtom,
} from "../useEvaluationRunData/assets/atoms"

import {IScenario, ScenarioResponse, UseEvaluationRunScenariosOptions} from "./types"

// Fetcher factory that returns raw snake_case scenario responses and syncs atoms of current store
const makeFetcher = (
    url: string,
    syncAtom: boolean,
    setLoading: ReturnType<typeof useSetAtom>,
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
        return axios.get(url).then((res) => {
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
                evalAtomStore().set(evaluationRunStateAtom, (draft) => {
                    draft.scenarios = scenarios
                })
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
    const queryParams = new URLSearchParams()
    if (runId) {
        queryParams.append("run_ids", `{${runId}}`)
        if (params?.limit !== undefined) {
            queryParams.append("limit", params.limit.toString())
        }
        if (params?.next) {
            queryParams.append("next", params.next)
        }
    }
    return runId ? `/preview/evaluations/scenarios/?${queryParams.toString()}` : null
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

    const fetcher = useCallback(makeFetcher(swrKey!, syncAtom, setLoading), [
        swrKey,
        syncAtom,
        setLoading,
    ])

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
