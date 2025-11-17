import {atom} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {snakeToCamelCaseKeys} from "@/oss/lib/helpers/casing"
import type {IStepResponse} from "@/oss/lib/hooks/useEvaluationRunScenarioSteps/types"
import {getProjectValues} from "@/oss/state/project"
import createBatchFetcher, {BatchFetcher} from "@/oss/state/utils/createBatchFetcher"

import {activeEvaluationRunIdAtom} from "./previewRun"
import type {ScenarioStepsBatchResult} from "./types"

const scenarioStepsBatcherCache = new Map<string, BatchFetcher<string, ScenarioStepsBatchResult>>()

const buildParamsSerializer = () => (params: Record<string, any>) => {
    const search = new URLSearchParams()
    Object.entries(params).forEach(([key, value]) => {
        if (Array.isArray(value)) {
            value.forEach((item) => {
                if (item === undefined || item === null) return
                search.append(key, String(item))
            })
        } else if (value !== undefined && value !== null) {
            search.append(key, String(value))
        }
    })
    return search.toString()
}

export const scenarioStepsBatcherAtom = atom((get) => {
    const runId = get(activeEvaluationRunIdAtom)
    const {projectId} = getProjectValues()
    if (!runId || !projectId) return null

    const cacheKey = `${projectId}:${runId}`
    let batcher = scenarioStepsBatcherCache.get(cacheKey)
    if (!batcher) {
        scenarioStepsBatcherCache.clear()
        batcher = createBatchFetcher<string, ScenarioStepsBatchResult>({
            serializeKey: (key) => key,
            batchFn: async (scenarioIds) => {
                if (scenarioIds.length === 0) {
                    return {}
                }

                const response = await axios.get<{steps: any[]; next?: string}>(
                    `/preview/evaluations/steps/`,
                    {
                        params: {
                            project_id: projectId,
                            run_id: runId,
                            scenario_ids: scenarioIds,
                        },
                        paramsSerializer: buildParamsSerializer(),
                    },
                )

                const rawSteps = Array.isArray(response.data?.steps) ? response.data.steps : []

                const grouped: Record<string, ScenarioStepsBatchResult> = Object.create(null)

                for (const rawStep of rawSteps) {
                    const camel = snakeToCamelCaseKeys(rawStep) as IStepResponse
                    const scenarioId = (camel as any).scenarioId as string | undefined
                    if (!scenarioId) continue
                    const bucket = (grouped[scenarioId] ||= {
                        scenarioId,
                        steps: [],
                        count: 0,
                        next: response.data?.next,
                    })
                    bucket.steps.push(camel)
                }

                for (const scenarioId of scenarioIds) {
                    if (!grouped[scenarioId]) {
                        grouped[scenarioId] = {
                            scenarioId,
                            steps: [],
                            count: 0,
                            next: response.data?.next,
                        }
                    }
                }

                Object.values(grouped).forEach((bucket) => {
                    bucket.count = bucket.steps.length
                })

                return grouped
            },
        })
        scenarioStepsBatcherCache.set(cacheKey, batcher)
    }
    return batcher
})

export const scenarioStepsQueryFamily = atomFamily((scenarioId: string) =>
    atomWithQuery<ScenarioStepsBatchResult>((get) => {
        const runId = get(activeEvaluationRunIdAtom)
        const batcher = get(scenarioStepsBatcherAtom)

        return {
            queryKey: ["preview", "scenario-steps", runId, scenarioId],
            enabled: Boolean(runId && batcher && scenarioId),
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            staleTime: 30_000,
            gcTime: 5 * 60 * 1000,
            queryFn: async () => {
                if (!batcher) {
                    throw new Error("Scenario steps batcher is not initialised")
                }
                return batcher(scenarioId)
            },
        }
    }),
)
