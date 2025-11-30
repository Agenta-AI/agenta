import {atom} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {snakeToCamelCaseKeys} from "@/oss/lib/helpers/casing"
import type {IStepResponse} from "@/oss/lib/hooks/useEvaluationRunScenarioSteps/types"
import {getProjectValues} from "@/oss/state/project"
import createBatchFetcher, {BatchFetcher} from "@/oss/state/utils/createBatchFetcher"

import {activePreviewRunIdAtom, effectiveProjectIdAtom} from "./run"
import type {ScenarioStepsBatchResult} from "./types"

const scenarioStepsBatcherCache = new Map<string, BatchFetcher<string, ScenarioStepsBatchResult>>()

const resolveEffectiveRunId = (get: any, runId?: string | null) =>
    runId ?? get(activePreviewRunIdAtom) ?? undefined

export const scenarioStepsBatcherFamily = atomFamily(({runId}: {runId?: string | null} = {}) =>
    atom((get) => {
        const effectiveRunId = resolveEffectiveRunId(get, runId)
        const {projectId: globalProjectId} = getProjectValues()
        const projectId = globalProjectId ?? get(effectiveProjectIdAtom)
        if (!effectiveRunId || !projectId) return null

        const cacheKey = `${projectId}:${effectiveRunId}`
        let batcher = scenarioStepsBatcherCache.get(cacheKey)
        if (!batcher) {
            scenarioStepsBatcherCache.clear()
            batcher = createBatchFetcher<string, ScenarioStepsBatchResult>({
                serializeKey: (key) => key,
                batchFn: async (scenarioIds) => {
                    if (scenarioIds.length === 0) {
                        return {}
                    }

                    const validScenarioIds = scenarioIds.filter(
                        (id) =>
                            typeof id === "string" &&
                            id.length > 0 &&
                            !id.startsWith("skeleton-") &&
                            !id.startsWith("placeholder-"),
                    )

                    if (validScenarioIds.length === 0) {
                        const empty: Record<string, ScenarioStepsBatchResult> = Object.create(null)
                        scenarioIds.forEach((scenarioId) => {
                            empty[scenarioId] = {
                                scenarioId,
                                steps: [],
                                count: 0,
                                next: undefined,
                            }
                        })
                        return empty
                    }

                    const response = await axios.post<{results?: any[]; steps?: any[]}>(
                        `/preview/evaluations/results/query?project_id=${projectId}`,
                        {
                            result: {
                                run_id: effectiveRunId,
                                run_ids: [effectiveRunId],
                                scenario_ids: validScenarioIds,
                            },
                            windowing: {},
                        },
                    )

                    const rawSteps = Array.isArray(response.data?.results)
                        ? response.data?.results
                        : Array.isArray(response.data?.steps)
                          ? response.data?.steps
                          : []

                    const grouped: Record<string, ScenarioStepsBatchResult> = Object.create(null)

                    for (const rawStep of rawSteps) {
                        const camel = snakeToCamelCaseKeys(rawStep) as IStepResponse
                        const scenarioId = (camel as any).scenarioId as string | undefined
                        if (!scenarioId) continue
                        const bucket = (grouped[scenarioId] ||= {
                            scenarioId,
                            steps: [],
                            count: 0,
                            next: undefined,
                        })
                        bucket.steps.push(camel)
                    }

                    for (const scenarioId of scenarioIds) {
                        if (!grouped[scenarioId]) {
                            grouped[scenarioId] = {
                                scenarioId,
                                steps: [],
                                count: 0,
                                next: undefined,
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
    }),
)

export const scenarioStepsBatcherAtom = atom((get) => get(scenarioStepsBatcherFamily()))

export const scenarioStepsQueryFamily = atomFamily(
    ({scenarioId, runId}: {scenarioId: string; runId?: string | null}) =>
        atomWithQuery<ScenarioStepsBatchResult>((get) => {
            const effectiveRunId = resolveEffectiveRunId(get, runId)
            const batcher = get(scenarioStepsBatcherFamily({runId: effectiveRunId}))

            return {
                queryKey: ["preview", "scenario-steps", effectiveRunId, scenarioId],
                enabled: Boolean(effectiveRunId && batcher && scenarioId),
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
