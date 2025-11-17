import deepEqual from "fast-deep-equal"
import {atom} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {snakeToCamelCaseKeys} from "@/oss/lib/helpers/casing"
import {canonicalizeMetricKey} from "@/oss/lib/metricUtils"
import {getProjectValues} from "@/oss/state/project"
import createBatchFetcher, {BatchFetcher} from "@/oss/state/utils/createBatchFetcher"

import {resolveValueBySegments, splitPath} from "../utils/valueAccess"

import {
    createMetricProcessor,
    isLegacyValueLeaf,
    isPlainObject,
    type MetricProcessor,
    type MetricScope,
} from "./metricProcessor"
import {activePreviewRunIdAtom, effectiveProjectIdAtom} from "./run"

const deleteMetricsByIds = async ({
    projectId,
    metricIds,
}: {
    projectId: string
    metricIds: string[]
}) => {
    const uniqueMetricIds = Array.from(new Set(metricIds.filter(Boolean)))
    if (!uniqueMetricIds.length) return false

    try {
        await axios.delete(`/preview/evaluations/metrics/`, {
            params: {project_id: projectId},
            data: {metrics_ids: uniqueMetricIds},
        })
        console.info("[EvalRunDetails2] Deleted stale scenario metrics after refresh", {
            projectId,
            metricIds: uniqueMetricIds,
        })
        return true
    } catch (error) {
        console.warn("[EvalRunDetails2] Failed to delete stale scenario metrics", {
            projectId,
            metricIds: uniqueMetricIds,
            error,
        })
        return false
    }
}

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
        const result = processor.processMetric(metric, scope)

        const scenarioId = metric.scenarioId ?? undefined
        if (!scenarioId || !requestedScenarioSet.has(scenarioId)) {
            return
        }

        returnedScenarioCounts.set(scenarioId, (returnedScenarioCounts.get(scenarioId) ?? 0) + 1)

        if (result.shouldRefresh) {
            grouped[scenarioId] = null
            return
        }

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
            processor.markScenarioGap(scenarioId, "missing-scenario-metric")
            grouped[scenarioId] = null
        }
    })

    return grouped
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

                if (!isEvaluatorBucket) {
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
    source: "flat" | "raw" | "raw-prefixed",
) => {
    if (process.env.NEXT_PUBLIC_EVAL_RUN_DEBUG !== "true" || typeof window === "undefined") return
    // console.info("[EvalRunDetails2][MetricLookup] candidate match", {
    //     ...context,
    //     matchedKey,
    //     source,
    // })
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

    const stepCandidates: string[] = []
    if (stepKey) {
        baseCandidates.forEach((candidate) => {
            if (candidate) {
                stepCandidates.push(`${stepKey}.${candidate}`)
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

    const candidates = [...evaluatorCandidates, ...stepCandidates, ...baseCandidates].filter(
        (candidate, index, array) => candidate && array.indexOf(candidate) === index,
    )

    for (const candidate of candidates) {
        if (candidate && Object.prototype.hasOwnProperty.call(flatMap, candidate)) {
            logMetricLookupMatch(context, candidate, "flat")
            return flatMap[candidate]
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
        const matchingKey = Object.keys(flatMap).find((key) => key.endsWith(suffix))
        if (matchingKey) {
            logMetricLookupMatch(context, matchingKey, "flat-suffix")
            return flatMap[matchingKey]
        }
    }

    const resolvedFromRaw = resolveValueBySegments(data.raw, segments)
    if (resolvedFromRaw !== undefined) {
        logMetricLookupMatch(context, canonicalPrimary ?? segments.join("."), "raw")
        return resolvedFromRaw
    }

    if (evaluatorKey) {
        const evaluatorSegments = [evaluatorKey, ...segments]
        const evaluatorResolved = resolveValueBySegments(data.raw, evaluatorSegments)
        if (evaluatorResolved !== undefined) {
            logMetricLookupMatch(context, `${evaluatorKey}.${segments.join(".")}`, "raw-prefixed")
            return evaluatorResolved
        }
    }

    if (canonicalPrimary && data.raw) {
        const prefixedSegments =
            stepKey && canonicalPrimary !== stepKey
                ? stepKey.split(".").filter(Boolean).concat(segments)
                : null
        if (prefixedSegments) {
            const nested = resolveValueBySegments(data.raw, prefixedSegments)
            if (nested !== undefined) return nested
        }
    }

    return undefined
}

export const evaluationMetricBatcherFamily = atomFamily(({runId}: {runId?: string | null} = {}) =>
    atom((get) => {
        const projectId = resolveProjectId(get)
        const effectiveRunId = resolveEffectiveRunId(get, runId)
        if (!projectId || !effectiveRunId) return null

        const cacheKey = `${projectId}:${effectiveRunId}`
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
                            metricPayload.scenario_ids = unique
                            metricPayload.run_ids = [effectiveRunId]
                        } else {
                            metricPayload.run_ids = [effectiveRunId]
                        }

                        const response = await axios.post(
                            `/preview/evaluations/metrics/query`,
                            {
                                metric: {
                                    ...metricPayload,
                                },
                            },
                            {
                                params: {project_id: projectId},
                            },
                        )

                        console.log("evaluationMetricBatcherFamily", {
                            projectId,
                            effectiveRunId,
                            scenarioIds: unique,
                            response,
                        })
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
                            })

                            const grouped = buildGroupedMetrics(unique, entries, processor)
                            const flushResult = await processor.flush({triggerRefresh})
                            return {grouped, flushResult}
                        }

                        const attemptCleanup = async (
                            flushResult: Awaited<ReturnType<typeof processMetrics>>["flushResult"],
                        ) => {
                            const staleMetricIds = flushResult.staleMetricIds ?? []
                            if (!staleMetricIds.length) return false
                            return deleteMetricsByIds({projectId, metricIds: staleMetricIds})
                        }

                        const initial = await processMetrics({
                            entries: await fetchMetrics(),
                            source: "scenario-metric-batcher",
                            triggerRefresh: true,
                        })

                        let grouped = initial.grouped
                        let flushResult = initial.flushResult
                        let cleanupPerformed = await attemptCleanup(flushResult)

                        if (cleanupPerformed || flushResult.refreshed) {
                            const retry = await processMetrics({
                                entries: await fetchMetrics(),
                                source: "scenario-metric-batcher:retry",
                                triggerRefresh: false,
                            })

                            grouped = retry.grouped
                            flushResult = retry.flushResult
                            const retryCleanupPerformed = await attemptCleanup(flushResult)
                            cleanupPerformed = cleanupPerformed || retryCleanupPerformed
                        }

                        if (process.env.NODE_ENV !== "production") {
                            console.debug("[EvalRunDetails2] Scenario metrics refresh state", {
                                projectId,
                                runId: effectiveRunId,
                                cleanupPerformed,
                                refreshed: flushResult.refreshed,
                                staleMetricIds: flushResult.staleMetricIds,
                                refreshedScenarioIds: flushResult.refreshedScenarioIds,
                                missingScenarioIdsAfterAttempts:
                                    flushResult.missingScenarioIdsAfterAttempts,
                            })
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

export const evaluationMetricBatcherAtom = atom((get) => get(evaluationMetricBatcherFamily()))

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
                queryFn: async () => {
                    if (!batcher) {
                        throw new Error("Metric batcher is not initialised")
                    }
                    const value = await batcher(scenarioId)
                    console.log("evaluationMetricQueryAtomFamily", {runId, scenarioId, value})
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
            (queryState) => ({
                isLoading: queryState.isLoading,
                isFetching: queryState.isFetching,
                error: queryState.error,
            }),
            (a, b) =>
                a.isLoading === b.isLoading && a.isFetching === b.isFetching && a.error === b.error,
        ),
)
