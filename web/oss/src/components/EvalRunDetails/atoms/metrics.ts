import deepEqual from "fast-deep-equal"
import {atom} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {deriveEvaluationKind} from "@/oss/lib/evaluations/utils/evaluationKind"
import {snakeToCamelCaseKeys} from "@/oss/lib/helpers/casing"
import {canonicalizeMetricKey} from "@/oss/lib/metricUtils"
import {getProjectValues} from "@/oss/state/project"
import createBatchFetcher, {BatchFetcher} from "@/oss/state/utils/createBatchFetcher"

import {previewEvalTypeAtom} from "../state/evalType"
import {resolveValueBySegments, splitPath} from "../utils/valueAccess"

import {
    createMetricProcessor,
    isLegacyValueLeaf,
    isPlainObject,
    type MetricProcessor,
    type MetricScope,
} from "./metricProcessor"
import {activePreviewRunIdAtom, effectiveProjectIdAtom} from "./run"
import {evaluationRunQueryAtomFamily} from "./table/run"

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

export interface RunLevelMetricData {
    metrics: EvaluationMetricEntry[]
    raw: Record<string, any>
    flat: Record<string, any>
}

const metricBatcherCache = new Map<string, BatchFetcher<string, ScenarioMetricData | null>>()

/**
 * Module-level cache for scenario statuses.
 * This is populated when scenarios are loaded and read by the metric batcher
 * to determine if a scenario is in a terminal state when metrics are missing.
 */
const scenarioStatusCache = new Map<string, string | null>()

/**
 * Track scenarios that have recently had metrics saved.
 * This prevents triggering a refresh immediately after saving when the
 * scenario is in terminal state but metrics haven't been persisted yet.
 */
const recentlySavedScenarios = new Set<string>()
const RECENTLY_SAVED_TTL_MS = 10_000 // 10 seconds

/**
 * Update the scenario status cache with new scenario data.
 * Call this when scenarios are loaded to make statuses available for metric refresh logic.
 */
export const updateScenarioStatusCache = (scenarios: {id: string; status?: string | null}[]) => {
    scenarios.forEach((scenario) => {
        if (scenario.id) {
            scenarioStatusCache.set(scenario.id, scenario.status ?? null)
        }
    })
}

/**
 * Mark a scenario as recently saved to prevent immediate refresh.
 * Call this after saving annotations/metrics to prevent the refresh logic
 * from triggering before the new data is persisted.
 */
export const markScenarioAsRecentlySaved = (scenarioId: string) => {
    recentlySavedScenarios.add(scenarioId)
    // Auto-clear after TTL
    setTimeout(() => {
        recentlySavedScenarios.delete(scenarioId)
    }, RECENTLY_SAVED_TTL_MS)
}

/**
 * Check if a scenario was recently saved (within TTL).
 */
export const wasScenarioRecentlySaved = (scenarioId: string): boolean => {
    return recentlySavedScenarios.has(scenarioId)
}

/**
 * Get scenario statuses for a list of scenario IDs from the cache.
 */
export const getScenarioStatuses = (scenarioIds: string[]): Map<string, string | null> => {
    const result = new Map<string, string | null>()
    scenarioIds.forEach((id) => {
        if (scenarioStatusCache.has(id)) {
            result.set(id, scenarioStatusCache.get(id) ?? null)
        }
    })
    return result
}

/**
 * Clear the scenario status cache.
 * Call this when projectId/workspace changes.
 */
export const clearScenarioStatusCache = () => {
    scenarioStatusCache.clear()
    recentlySavedScenarios.clear()
}

/**
 * Invalidate the metric batcher cache.
 * Call this after updating metrics to force a fresh fetch.
 */
export const invalidateMetricBatcherCache = () => {
    metricBatcherCache.clear()
}

const resolveEffectiveRunId = (get: any, runId?: string | null) =>
    runId ?? get(activePreviewRunIdAtom) ?? undefined

const resolveProjectId = (get: any) => {
    const projectId = get(effectiveProjectIdAtom)
    if (projectId) return projectId
    const {projectId: globalProjectId} = getProjectValues()
    return globalProjectId ?? null
}

const buildGroupedMetrics = (
    scenarioIds: string[],
    rawMetrics: any[],
    processor: MetricProcessor,
    scenarioStatuses?: Map<string, string | null>,
    scenarioContextMap?: Map<string, {hasInvocation?: boolean; hasAnnotation?: boolean}>,
): Record<string, ScenarioMetricData | null> => {
    const grouped: Record<string, ScenarioMetricData | null> = Object.create(null)

    scenarioIds.forEach((scenarioId) => {
        grouped[scenarioId] = {
            metrics: [],
            raw: {},
            flat: {},
        }
    })

    const requestedScenarioSet = new Set(scenarioIds)
    const returnedScenarioCounts = new Map<string, number>()

    rawMetrics.forEach((rawMetric: any) => {
        const metric = snakeToCamelCaseKeys(rawMetric) as EvaluationMetricEntry
        const scope: MetricScope = metric.scenarioId ? "scenario" : "run"
        // Process metric to track refresh state, but don't use result for filtering
        processor.processMetric(metric, scope)

        const scenarioId = metric.scenarioId ?? undefined
        if (!scenarioId || !requestedScenarioSet.has(scenarioId)) {
            return
        }

        returnedScenarioCounts.set(scenarioId, (returnedScenarioCounts.get(scenarioId) ?? 0) + 1)

        // Always include metric data even if flagged for refresh - refresh is a background
        // operation that may not succeed, so we should still display existing data
        const bucket = grouped[scenarioId]
        if (!bucket) return

        bucket.metrics.push(metric)
        const data = metric.data ?? {}
        bucket.raw = mergeDeep(bucket.raw, data)
    })

    Object.entries(grouped).forEach(([scenarioId, summary]) => {
        if (!summary) return

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
            if (aggregates.promptTokens !== undefined && summary.raw.promptTokens === undefined) {
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

    scenarioIds.forEach((scenarioId) => {
        if ((returnedScenarioCounts.get(scenarioId) ?? 0) === 0) {
            const scenarioStatus = scenarioStatuses?.get(scenarioId) ?? null
            const scenarioContext = scenarioContextMap?.get(scenarioId)
            processor.markScenarioGap(
                scenarioId,
                "missing-scenario-metric",
                scenarioStatus,
                scenarioContext,
            )
            grouped[scenarioId] = null
        }
    })

    return grouped
}

const buildRunLevelMetricData = (rawMetrics: any[]): RunLevelMetricData => {
    const rawAccumulator: Record<string, any> = {}
    const entries: EvaluationMetricEntry[] = []

    rawMetrics.forEach((rawMetric: any) => {
        const metric = snakeToCamelCaseKeys(rawMetric) as EvaluationMetricEntry
        if (metric.scenarioId) {
            return
        }
        entries.push(metric)
        const data = metric.data ?? {}
        Object.assign(rawAccumulator, mergeDeep(rawAccumulator, data))
    })

    const aggregates = computeAggregatedMetrics(rawAccumulator)
    const raw = applyAggregatesToRaw(rawAccumulator, aggregates)
    const flat = flattenMetrics(raw)

    return {metrics: entries, raw, flat}
}

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

const assignFlat = (flat: Record<string, any>, key: string, value: any) => {
    if (!key) return
    if (flat[key] === undefined) {
        flat[key] = value
    }
    const canonical = canonicalizeMetricKey(key)
    if (canonical !== key && canonical && flat[canonical] === undefined) {
        flat[canonical] = value
    }
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
            const isEvaluatorBucket =
                typeof key === "string" &&
                key.length > 0 &&
                !key.includes(".") &&
                Object.keys(value as Record<string, any>).some((subKey) => subKey.includes("."))

            if (isPlainObject(value) && isLegacyValueLeaf(value)) {
                assignFlat(flat, key, value.value)
            }

            Object.entries(value as Record<string, any>).forEach(([subKey, subValue]) => {
                const resolvedSubValue =
                    isPlainObject(subValue) && isLegacyValueLeaf(subValue)
                        ? subValue.value
                        : subValue

                // For invocation metrics (attributes.ag.*), always create both
                // prefixed and unprefixed keys to support online evaluations
                const isInvocationMetric = subKey.startsWith("attributes.ag.metrics.")
                if (!isEvaluatorBucket || isInvocationMetric) {
                    assignFlat(flat, subKey, resolvedSubValue)
                }
                assignFlat(flat, `${key}.${subKey}`, resolvedSubValue)
            })
        } else {
            assignFlat(flat, key, value)
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

interface MetricLookupContext {
    scenarioId?: string | null
    runId?: string | null
    columnId?: string
    evaluatorKey?: string | null
    metricKey?: string
    path: string
    stepKey?: string
}

const logMetricLookupMatch = (
    context: MetricLookupContext,
    matchedKey: string,
    source: "flat" | "flat-suffix" | "raw" | "raw-prefixed",
) => {
    if (process.env.NEXT_PUBLIC_EVAL_RUN_DEBUG !== "true" || typeof window === "undefined") return
    // console.info("[EvalRunDetails2][MetricLookup] candidate match", {
    //     ...context,
    //     matchedKey,
    //     source,
    // })
}

/**
 * Extract scalar value from a stats object.
 * For single-count stats objects, use mean/sum. For multi-count, return the whole object.
 */
const extractScalarFromStats = (value: any): unknown => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value

    // If it's a stats object with count: 1, extract the scalar value
    if (typeof value.count === "number" && value.count === 1) {
        // For single value, mean and sum should be the same
        if (typeof value.mean === "number") return value.mean
        if (typeof value.sum === "number") return value.sum
        if (typeof value.max === "number") return value.max
    }

    // If it has a mean/sum for multi-count, use mean for display
    if (typeof value.mean === "number") return value.mean
    if (typeof value.sum === "number") return value.sum

    // Return the whole object for complex stats (will be handled by the UI)
    return value
}

const extractMetricValueFromData = (
    data: ScenarioMetricData | null | undefined,
    path: string,
    metricKey: string | undefined,
    stepKey: string | undefined,
    evaluatorKey: string | null,
    context: MetricLookupContext,
): unknown => {
    if (!data) return undefined

    const segments = splitPath(path)
    if (!segments.length) return undefined

    const flattenedKey = segments.join(".")
    const flatMap = data.flat ?? {}

    const canonicalPrimary = canonicalizeMetricKey(metricKey ?? path ?? flattenedKey)
    const terminalKey = segments[segments.length - 1]

    const baseCandidates: string[] = []
    if (canonicalPrimary) baseCandidates.push(canonicalPrimary)
    if (metricKey && metricKey !== canonicalPrimary) baseCandidates.push(metricKey)
    if (path && path !== canonicalPrimary) baseCandidates.push(path)
    if (flattenedKey && flattenedKey !== canonicalPrimary) baseCandidates.push(flattenedKey)
    if (terminalKey) baseCandidates.push(terminalKey)

    // For invocation metrics (attributes.ag.metrics.*), don't use stepKey for lookup
    // because they're stored unprefixed in online evaluations
    const isInvocationMetric = path.startsWith("attributes.ag.metrics.")
    const effectiveStepKey = isInvocationMetric ? undefined : stepKey

    const stepCandidates: string[] = []
    if (effectiveStepKey) {
        baseCandidates.forEach((candidate) => {
            if (candidate) {
                stepCandidates.push(`${effectiveStepKey}.${candidate}`)
            }
        })
    }

    const evaluatorCandidates: string[] = []
    if (evaluatorKey) {
        ;[...stepCandidates, ...baseCandidates].forEach((candidate) => {
            if (candidate) {
                evaluatorCandidates.push(`${evaluatorKey}.${candidate}`)
            }
        })
    }

    // When stepKey is provided, only use step-prefixed candidates to ensure
    // we match metrics from the same evaluator. This prevents cross-evaluator
    // matching when comparing runs with different evaluator configurations.
    // Prioritize stepCandidates over evaluatorCandidates since online evaluations
    // use stepKey (e.g., "evaluator-142233c5fdb7") as the primary key in flatMap
    const candidates = (
        effectiveStepKey && stepCandidates.length > 0
            ? [...stepCandidates, ...evaluatorCandidates]
            : [...stepCandidates, ...evaluatorCandidates, ...baseCandidates]
    ).filter((candidate, index, array) => candidate && array.indexOf(candidate) === index)

    for (const candidate of candidates) {
        if (candidate && Object.prototype.hasOwnProperty.call(flatMap, candidate)) {
            logMetricLookupMatch(context, candidate, "flat")
            return extractScalarFromStats(flatMap[candidate])
        }
    }

    const suffixSources = [canonicalPrimary, metricKey, path, flattenedKey].filter(
        (suffix): suffix is string => Boolean(suffix),
    )
    const suffixes = new Set<string>()
    suffixSources.forEach((suffix) => {
        suffixes.add(`.${suffix}`)
        suffixes.add(`.${canonicalizeMetricKey(suffix)}`)
    })

    for (const suffix of suffixes) {
        const matchingKey = Object.keys(flatMap).find((key) => {
            if (!key.endsWith(suffix)) return false
            // When effectiveStepKey is provided, only match keys that start with the stepKey
            // to prevent cross-evaluator matching
            if (
                effectiveStepKey &&
                !key.startsWith(`${effectiveStepKey}.`) &&
                key !== effectiveStepKey
            ) {
                return false
            }
            return true
        })
        if (matchingKey) {
            logMetricLookupMatch(context, matchingKey, "flat-suffix")
            return extractScalarFromStats(flatMap[matchingKey])
        }
    }

    const resolvedFromRaw = resolveValueBySegments(data.raw, segments)
    if (resolvedFromRaw !== undefined) {
        logMetricLookupMatch(context, canonicalPrimary ?? segments.join("."), "raw")
        return extractScalarFromStats(resolvedFromRaw)
    }

    if (evaluatorKey) {
        const evaluatorSegments = [evaluatorKey, ...segments]
        const evaluatorResolved = resolveValueBySegments(data.raw, evaluatorSegments)
        if (evaluatorResolved !== undefined) {
            logMetricLookupMatch(context, `${evaluatorKey}.${segments.join(".")}`, "raw-prefixed")
            return extractScalarFromStats(evaluatorResolved)
        }
    }

    if (canonicalPrimary && data.raw) {
        const prefixedSegments =
            effectiveStepKey && canonicalPrimary !== effectiveStepKey
                ? effectiveStepKey.split(".").filter(Boolean).concat(segments)
                : null
        if (prefixedSegments) {
            const nested = resolveValueBySegments(data.raw, prefixedSegments)
            if (nested !== undefined) return extractScalarFromStats(nested)
        }
    }

    return undefined
}

export const evaluationMetricBatcherFamily = atomFamily(({runId}: {runId?: string | null} = {}) =>
    atom((get) => {
        const projectId = resolveProjectId(get)
        const effectiveRunId = resolveEffectiveRunId(get, runId)
        const evalTypeFromAtom = get(previewEvalTypeAtom)

        // Derive evaluation type from run.data.steps - this is the reliable source of truth
        // Do NOT use meta.evaluation_kind as it's flaky and unreliable
        const runQuery = effectiveRunId
            ? get(evaluationRunQueryAtomFamily(effectiveRunId))
            : undefined
        const rawRun = runQuery?.data?.rawRun
        const evalTypeFromRun = rawRun ? deriveEvaluationKind(rawRun) : null
        const evaluationType = evalTypeFromAtom || evalTypeFromRun

        if (!projectId || !effectiveRunId) return null

        const cacheKey = `${projectId}:${effectiveRunId}:${evaluationType || "auto"}`
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

                    const fetchMetrics = async () => {
                        const metricPayload: Record<string, any> = {}
                        // metricPayload.run_id = effectiveRunId
                        if (unique.length) {
                            // For scenario-scoped queries, do not constrain by run_ids to avoid over-filtering.
                            metricPayload.scenario_ids = unique
                        } else {
                            metricPayload.run_ids = [effectiveRunId]
                        }

                        const response = await axios.post(
                            `/preview/evaluations/metrics/query`,
                            {
                                metrics: {
                                    ...metricPayload,
                                },
                            },
                            {
                                params: {project_id: projectId},
                            },
                        )

                        return Array.isArray(response.data?.metrics) ? response.data.metrics : []
                    }

                    const resolveMetrics = async (): Promise<
                        Record<string, ScenarioMetricData | null>
                    > => {
                        const processMetrics = async ({
                            entries,
                            source,
                            triggerRefresh,
                        }: {
                            entries: any[]
                            source: string
                            triggerRefresh: boolean
                        }) => {
                            const processor = createMetricProcessor({
                                projectId,
                                runId: effectiveRunId,
                                source,
                                evaluationType,
                            })

                            // Get scenario statuses from cache for terminal state detection
                            const scenarioStatuses = getScenarioStatuses(unique)

                            const grouped = buildGroupedMetrics(
                                unique,
                                entries,
                                processor,
                                scenarioStatuses,
                            )
                            const flushResult = await processor.flush({triggerRefresh})
                            return {grouped, flushResult}
                        }

                        const initial = await processMetrics({
                            entries: await fetchMetrics(),
                            source: "scenario-metric-batcher",
                            triggerRefresh: true,
                        })

                        let grouped = initial.grouped
                        let flushResult = initial.flushResult

                        // Re-fetch after refresh to get updated metrics
                        if (flushResult.refreshed) {
                            const retry = await processMetrics({
                                entries: await fetchMetrics(),
                                source: "scenario-metric-batcher:retry",
                                triggerRefresh: false,
                            })

                            grouped = retry.grouped
                        }

                        return grouped
                    }

                    return resolveMetrics()
                },
            })
            metricBatcherCache.set(cacheKey, batcher)
        }

        return batcher
    }),
)

export const evaluationMetricBatcherAtom = atom((get) => get(evaluationMetricBatcherFamily({})))

export const evaluationMetricQueryAtomFamily = atomFamily(
    ({scenarioId, runId}: {scenarioId: string; runId?: string | null}) =>
        atomWithQuery<ScenarioMetricData | null>((get) => {
            const effectiveRunId = resolveEffectiveRunId(get, runId)
            const batcher = get(evaluationMetricBatcherFamily({runId: effectiveRunId}))
            const projectId = resolveProjectId(get)

            return {
                queryKey: ["preview", "evaluation-metric", effectiveRunId, projectId, scenarioId],
                enabled: Boolean(projectId && effectiveRunId && batcher && scenarioId),
                staleTime: 30_000,
                gcTime: 5 * 60 * 1000,
                refetchOnWindowFocus: false,
                refetchOnReconnect: false,
                // Enable structural sharing to prevent unnecessary re-renders when data hasn't changed
                structuralSharing: true,
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

export const scenarioMetricValueAtomFamily = atomFamily(
    (args: {
        scenarioId: string
        path: string
        metricKey?: string
        stepKey?: string
        evaluatorId?: string | null
        evaluatorSlug?: string | null
        runId?: string | null
        columnId?: string
    }) =>
        selectAtom(
            evaluationMetricQueryAtomFamily({
                scenarioId: args.scenarioId,
                runId: args.runId,
            }),
            (queryState) => {
                const data = extractMetricValueFromData(
                    queryState.data,
                    args.path,
                    args.metricKey,
                    args.stepKey,
                    args.evaluatorSlug ?? args.evaluatorId ?? null,
                    {
                        scenarioId: args.scenarioId,
                        runId: args.runId,
                        columnId: args.columnId,
                        evaluatorKey: args.evaluatorSlug ?? args.evaluatorId ?? null,
                        metricKey: args.metricKey,
                        path: args.path,
                        stepKey: args.stepKey,
                    },
                )

                return data
            },
            deepEqual,
        ),
)

export const scenarioMetricMetaAtomFamily = atomFamily(
    ({scenarioId, runId}: {scenarioId: string; runId?: string | null}) =>
        selectAtom(
            evaluationMetricQueryAtomFamily({scenarioId, runId}),
            (queryState) => {
                // Stale-while-revalidate: only show loading when there's no cached data
                const hasData = Boolean(queryState.data)
                return {
                    isLoading: !hasData && queryState.isLoading,
                    isFetching: queryState.isFetching,
                    error: queryState.error,
                }
            },
            (a, b) =>
                a.isLoading === b.isLoading && a.isFetching === b.isFetching && a.error === b.error,
        ),
)

export const runLevelMetricQueryAtomFamily = atomFamily(({runId}: {runId?: string | null} = {}) =>
    atomWithQuery<RunLevelMetricData | null>((get) => {
        const effectiveRunId = resolveEffectiveRunId(get, runId)
        const projectId = resolveProjectId(get)

        return {
            queryKey: ["preview", "run-level-metrics", projectId, effectiveRunId],
            enabled: Boolean(projectId && effectiveRunId),
            staleTime: 30_000,
            gcTime: 5 * 60 * 1000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            queryFn: async () => {
                if (!projectId || !effectiveRunId) return null

                const response = await axios.post(
                    `/preview/evaluations/metrics/query`,
                    {
                        metrics: {
                            run_ids: [effectiveRunId],
                            scenario_ids: false,
                            timestamps: false,
                        },
                    },
                    {params: {project_id: projectId}},
                )

                const entries = Array.isArray(response.data?.metrics) ? response.data.metrics : []

                if (!entries.length) {
                    return {metrics: [], raw: {}, flat: {}}
                }

                return buildRunLevelMetricData(entries)
            },
        }
    }),
)

/**
 * Trigger metrics refresh for both scenario-level and run-level metrics.
 * This should be called after actions that modify scenario data (invocations, annotations).
 *
 * @param projectId - The project ID
 * @param runId - The run ID
 * @param scenarioId - Optional scenario ID for scenario-level refresh
 */
export const triggerMetricsRefresh = async ({
    projectId,
    runId,
    scenarioId,
}: {
    projectId: string
    runId: string
    scenarioId?: string
}): Promise<void> => {
    try {
        // Refresh scenario-level metrics if scenarioId is provided
        if (scenarioId) {
            await axios.post(
                `/preview/evaluations/metrics/refresh`,
                {
                    metrics: {
                        run_id: runId,
                        scenario_id: scenarioId,
                    },
                },
                {params: {project_id: projectId}},
            )
        }
        // Refresh run-level metrics (without scenario_id)
        await axios.post(
            `/preview/evaluations/metrics/refresh`,
            {
                metrics: {
                    run_id: runId,
                },
            },
            {params: {project_id: projectId}},
        )
        console.log("[metrics] Metrics refresh triggered", {
            projectId,
            runId,
            scenarioId,
            levels: scenarioId ? "scenario + run" : "run only",
        })
    } catch (error) {
        console.warn("[metrics] Metrics refresh failed:", error)
    }
}
