/* eslint-disable @typescript-eslint/no-explicit-any -- relocated eval-run parity data layer (WP-4e-2b); reads dynamic backend-shaped payloads, logic unchanged */
import {queryEvaluationResults} from "@agenta/entities/evaluationRun"
import {projectIdAtom} from "@agenta/shared/state"
import {createBatchFetcher, type BatchFetcher} from "@agenta/shared/utils"
import {atom, getDefaultStore} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import type {IStepResponse} from "../../../core"
import {snakeToCamelCaseKeys} from "../utils/casing"

import {isTerminalStatus} from "./compare"
import {activePreviewRunIdAtom, effectiveProjectIdAtom} from "./run"
import {evaluationRunQueryAtomFamily} from "./table/run"
import type {ScenarioStepsBatchResult} from "./types"

const scenarioStepsBatcherCache = new Map<string, BatchFetcher<string, ScenarioStepsBatchResult>>()

/**
 * Invalidate the scenario steps batcher cache.
 * Call this after updating step results to force a fresh fetch.
 */
export const invalidateScenarioStepsBatcherCache = () => {
    scenarioStepsBatcherCache.clear()
}

const resolveEffectiveRunId = (get: any, runId?: string | null) =>
    runId ?? get(activePreviewRunIdAtom) ?? undefined

export const scenarioStepsBatcherFamily = atomFamily(({runId}: {runId?: string | null} = {}) =>
    atom((get) => {
        const effectiveRunId = resolveEffectiveRunId(get, runId)
        const globalProjectId = getDefaultStore().get(projectIdAtom)
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

                    // Route through the canonical typed/zod results fetcher instead of a
                    // raw axios re-implementation of POST /evaluations/results/query. The
                    // atomWithQuery shell below still owns caching + live polling — only the
                    // network call is unified onto the entities API.
                    const rawSteps = await queryEvaluationResults({
                        projectId,
                        runId: effectiveRunId,
                        scenarioIds: validScenarioIds,
                    })

                    const grouped: Record<string, ScenarioStepsBatchResult> = Object.create(null)

                    for (const rawStep of rawSteps) {
                        const camel = snakeToCamelCaseKeys(rawStep) as unknown as IStepResponse
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

export const scenarioStepsBatcherAtom = atom((get) => get(scenarioStepsBatcherFamily(undefined)))

export const scenarioStepsQueryFamily = atomFamily(
    ({scenarioId, runId}: {scenarioId: string; runId?: string | null}) =>
        atomWithQuery<ScenarioStepsBatchResult>((get) => {
            const effectiveRunId = resolveEffectiveRunId(get, runId)
            const batcher = get(scenarioStepsBatcherFamily({runId: effectiveRunId}))

            // While the run is still executing, poll so the focus drawer /
            // scenario viewer pick up a scenario's results as it completes.
            // Stops once the run is terminal.
            const runQuery = effectiveRunId
                ? get(evaluationRunQueryAtomFamily(effectiveRunId))
                : undefined
            const runStatus = runQuery?.data?.rawRun?.status ?? runQuery?.data?.camelRun?.status
            const runTerminal = isTerminalStatus(runStatus)

            return {
                queryKey: ["preview", "scenario-steps", effectiveRunId, scenarioId],
                enabled: Boolean(effectiveRunId && batcher && scenarioId),
                refetchOnWindowFocus: false,
                refetchOnReconnect: false,
                refetchInterval: runTerminal ? false : 5000,
                staleTime: 30_000,
                gcTime: 5 * 60 * 1000,
                // Enable structural sharing to prevent unnecessary re-renders when data hasn't changed
                structuralSharing: true,
                queryFn: async () => {
                    if (!batcher) {
                        throw new Error("Scenario steps batcher is not initialised")
                    }
                    return batcher(scenarioId)
                },
            }
        }),
)
