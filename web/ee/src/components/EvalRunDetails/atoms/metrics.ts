import {atom} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {snakeToCamelCaseKeys} from "@/oss/lib/helpers/casing"
import {getProjectValues} from "@/oss/state/project"
import createBatchFetcher, {BatchFetcher} from "@/oss/state/utils/createBatchFetcher"

import {activeEvaluationRunIdAtom, previewEvaluationRunQueryAtom} from "./previewRun"
import {ACTIVE_RUN_REFETCH_INTERVAL, isActiveEvaluationStatus} from "./status"

interface EvaluationMetricEntry {
    id?: string
    runId: string
    scenarioId?: string
    status?: string
    data?: Record<string, any>
    tags?: Record<string, any>
    meta?: Record<string, any>
    createdAt?: string
    updatedAt?: string
}

export interface ScenarioMetricData {
    metrics: EvaluationMetricEntry[]
    raw: Record<string, any>
    flat: Record<string, any>
}

const metricBatcherCache = new Map<string, BatchFetcher<string, ScenarioMetricData | null>>()

const asNumber = (value: any): number | undefined => {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value
    }
    return undefined
}

const extractStatTotal = (stats: any): number | undefined => {
    if (!stats || typeof stats !== "object") return undefined
    return (
        asNumber(stats.total) ??
        asNumber(stats.sum) ??
        (typeof stats.mean === "number" && typeof stats.count === "number"
            ? stats.mean * stats.count
            : undefined)
    )
}

const mergeDeep = (
    target: Record<string, any>,
    source: Record<string, any>,
): Record<string, any> => {
    const output: Record<string, any> = {...target}
    Object.entries(source ?? {}).forEach(([key, value]) => {
        if (
            value &&
            typeof value === "object" &&
            !Array.isArray(value) &&
            typeof output[key] === "object" &&
            output[key] !== null &&
            !Array.isArray(output[key])
        ) {
            output[key] = mergeDeep(output[key], value as Record<string, any>)
        } else {
            output[key] = value
        }
    })
    return output
}

const flattenMetrics = (raw: Record<string, any>): Record<string, any> => {
    const flat: Record<string, any> = {}
    Object.entries(raw || {}).forEach(([key, value]) => {
        if (key === "acc" && value && typeof value === "object") {
            const acc = value as Record<string, any>
            const costs = acc.costs as Record<string, any> | undefined
            const duration = acc.duration as Record<string, any> | undefined
            const tokens = acc.tokens as Record<string, any> | undefined

            if (costs?.total !== undefined) flat.totalCost = costs.total
            if (duration?.total !== undefined) {
                const totalSeconds = Number((duration.total / 1000).toFixed(6))
                flat["duration.total"] = totalSeconds
            }
            if (tokens?.total !== undefined) flat.totalTokens = tokens.total
            if (tokens?.prompt !== undefined) flat.promptTokens = tokens.prompt
            if (tokens?.completion !== undefined) flat.completionTokens = tokens.completion
        } else if (value && typeof value === "object" && !Array.isArray(value)) {
            Object.entries(value as Record<string, any>).forEach(([subKey, subValue]) => {
                flat[`${key}.${subKey}`] = subValue
            })
        } else {
            flat[key] = value
        }
    })
    return flat
}

const computeAggregatedMetrics = (raw: Record<string, any>) => {
    const aggregate = {
        totalCost: 0,
        hasCost: false,
        durationMs: 0,
        hasDuration: false,
        tokens: 0,
        hasTokens: false,
        promptTokens: 0,
        hasPromptTokens: false,
        completionTokens: 0,
        hasCompletionTokens: false,
        errorsTrue: 0,
        errorsFalse: 0,
    }

    const walk = (node: any, key?: string) => {
        if (!node || typeof node !== "object") return
        if (key === "acc") return

        if (node.costs && typeof node.costs === "object") {
            const sum = extractStatTotal(node.costs)
            if (sum !== undefined) {
                aggregate.totalCost += sum
                aggregate.hasCost = true
            }
        }

        if (node.duration && typeof node.duration === "object") {
            const sum = extractStatTotal(node.duration)
            if (sum !== undefined) {
                aggregate.hasDuration = true
                const presumedMs = sum > 100 ? sum : sum * 1000
                aggregate.durationMs += presumedMs
            }
        }

        if (node.tokens && typeof node.tokens === "object") {
            const sum = extractStatTotal(node.tokens)
            if (sum !== undefined) {
                aggregate.tokens += sum
                aggregate.hasTokens = true
            }

            const promptSum = extractStatTotal(node.tokens.prompt)
            if (promptSum !== undefined) {
                aggregate.promptTokens += promptSum
                aggregate.hasPromptTokens = true
            }

            const completionSum = extractStatTotal(node.tokens.completion)
            if (completionSum !== undefined) {
                aggregate.completionTokens += completionSum
                aggregate.hasCompletionTokens = true
            }
        }

        if (node.errors && typeof node.errors === "object") {
            const frequency = Array.isArray(node.errors.frequency) ? node.errors.frequency : []
            frequency.forEach((entry: any) => {
                if (!entry) return
                if (entry.value === true) aggregate.errorsTrue += entry.count ?? 0
                if (entry.value === false) aggregate.errorsFalse += entry.count ?? 0
            })

            if (frequency.length === 0 && typeof node.errors.count === "number") {
                if (node.errors.count > 0) {
                    aggregate.errorsTrue += node.errors.count
                } else {
                    aggregate.errorsFalse += 1
                }
            }
        }

        Object.entries(node).forEach(([childKey, childValue]) => {
            if (
                childKey === "costs" ||
                childKey === "duration" ||
                childKey === "tokens" ||
                childKey === "errors"
            ) {
                return
            }
            walk(childValue, childKey)
        })
    }

    walk(raw)

    return {
        totalCost: aggregate.hasCost ? aggregate.totalCost : undefined,
        durationMs: aggregate.hasDuration ? aggregate.durationMs : undefined,
        tokens: aggregate.hasTokens ? aggregate.tokens : undefined,
        promptTokens: aggregate.hasPromptTokens ? aggregate.promptTokens : undefined,
        completionTokens: aggregate.hasCompletionTokens ? aggregate.completionTokens : undefined,
        errors:
            aggregate.errorsTrue + aggregate.errorsFalse > 0 ? aggregate.errorsTrue > 0 : undefined,
    }
}

export const evaluationMetricBatcherAtom = atom((get) => {
    const {projectId} = getProjectValues()
    const runId = get(activeEvaluationRunIdAtom)
    if (!projectId || !runId) return null

    const cacheKey = `${projectId}:${runId}`
    let batcher = metricBatcherCache.get(cacheKey)
    if (!batcher) {
        metricBatcherCache.clear()
        batcher = createBatchFetcher<string, ScenarioMetricData | null>({
            serializeKey: (key) => key,
            batchFn: async (scenarioIds) => {
                const unique = Array.from(new Set(scenarioIds.filter(Boolean)))
                if (!unique.length) {
                    return {}
                }

                const response = await axios.post(
                    `/preview/evaluations/metrics/query`,
                    {
                        metric: {
                            scenario_ids: unique,
                            run_id: runId,
                        },
                    },
                    {
                        params: {project_id: projectId},
                    },
                )

                const rawMetrics = Array.isArray(response.data?.metrics)
                    ? response.data.metrics
                    : []

                const grouped: Record<string, ScenarioMetricData> = Object.create(null)

                unique.forEach((scenarioId) => {
                    grouped[scenarioId] = {
                        metrics: [],
                        raw: {},
                        flat: {},
                    }
                })

                rawMetrics.forEach((rawMetric: any) => {
                    const metric = snakeToCamelCaseKeys(rawMetric) as EvaluationMetricEntry
                    const scenarioId = metric.scenarioId ?? undefined
                    if (!scenarioId || !grouped[scenarioId]) {
                        return
                    }

                    grouped[scenarioId].metrics.push(metric)
                    const data = metric.data ?? {}
                    grouped[scenarioId].raw = mergeDeep(grouped[scenarioId].raw, data)
                })

                Object.values(grouped).forEach((summary) => {
                    const aggregates = computeAggregatedMetrics(summary.raw)

                    if (
                        aggregates.totalCost !== undefined ||
                        aggregates.tokens !== undefined ||
                        aggregates.durationMs !== undefined
                    ) {
                        summary.raw.acc = summary.raw.acc ? {...summary.raw.acc} : {}
                    }

                    if (aggregates.totalCost !== undefined) {
                        summary.raw.acc.costs = {
                            ...(summary.raw.acc.costs || {}),
                            total: aggregates.totalCost,
                        }
                        if (summary.raw.totalCost === undefined) {
                            summary.raw.totalCost = aggregates.totalCost
                        }
                    }

                    if (aggregates.durationMs !== undefined) {
                        summary.raw.acc.duration = {
                            ...(summary.raw.acc.duration || {}),
                            total: aggregates.durationMs,
                        }
                        const durationSeconds = aggregates.durationMs / 1000
                        if (summary.raw.duration === undefined) {
                            summary.raw.duration = durationSeconds
                        }
                    }

                    if (aggregates.tokens !== undefined) {
                        summary.raw.acc.tokens = {
                            ...(summary.raw.acc.tokens || {}),
                            total: aggregates.tokens,
                        }
                        if (aggregates.promptTokens !== undefined) {
                            summary.raw.acc.tokens.prompt = aggregates.promptTokens
                        }
                        if (aggregates.completionTokens !== undefined) {
                            summary.raw.acc.tokens.completion = aggregates.completionTokens
                        }
                        if (summary.raw.tokens === undefined) {
                            summary.raw.tokens = aggregates.tokens
                        }
                        if (
                            aggregates.promptTokens !== undefined &&
                            summary.raw.promptTokens === undefined
                        ) {
                            summary.raw.promptTokens = aggregates.promptTokens
                        }
                        if (
                            aggregates.completionTokens !== undefined &&
                            summary.raw.completionTokens === undefined
                        ) {
                            summary.raw.completionTokens = aggregates.completionTokens
                        }
                    }

                    if (aggregates.errors !== undefined) {
                        summary.raw.errors = aggregates.errors
                    }

                    summary.flat = flattenMetrics(summary.raw)
                })

                return grouped
            },
        })
        metricBatcherCache.set(cacheKey, batcher)
    }

    return batcher
})

export const evaluationMetricQueryAtomFamily = atomFamily((scenarioId: string) =>
    atomWithQuery<ScenarioMetricData | null>((get) => {
        const batcher = get(evaluationMetricBatcherAtom)
        const {projectId} = getProjectValues()
        const runId = get(activeEvaluationRunIdAtom)
        const previewRunData = get(previewEvaluationRunQueryAtom)
        const runStatus = previewRunData?.run?.status?.value ?? null

        return {
            queryKey: ["preview", "evaluation-metric", runId, projectId, scenarioId],
            enabled: Boolean(projectId && runId && batcher && scenarioId),
            staleTime: 30_000,
            gcTime: 5 * 60 * 1000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            refetchInterval: () =>
                isActiveEvaluationStatus(runStatus) ? ACTIVE_RUN_REFETCH_INTERVAL : false,
            queryFn: async () => {
                if (!batcher) {
                    throw new Error("Metric batcher is not initialised")
                }
                const value = await batcher(scenarioId)
                return value ?? null
            },
        }
    }),
)
