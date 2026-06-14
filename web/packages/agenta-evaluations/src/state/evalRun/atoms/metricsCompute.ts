/* eslint-disable @typescript-eslint/no-explicit-any -- relocated eval-run parity data layer (WP-4e-2b); reads dynamic backend-shaped payloads, logic unchanged */
import {canonicalizeMetricKey} from "@agenta/shared/metrics"

import {snakeToCamelCaseKeys} from "../utils/casing"
import {resolveValueBySegments, splitPath} from "../utils/valueAccess"

import {isLegacyValueLeaf, isPlainObject, type MetricProcessor} from "./metricProcessor"
import type {MetricScope} from "./metricProcessor"

export interface EvaluationMetricEntry {
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

export const buildGroupedMetrics = (
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

// NOTE (latent runtime bug, typed as-is per WP-4e-2a): `applyAggregatesToRaw` is
// referenced below but is not defined or imported anywhere in the codebase. At runtime
// this throws a ReferenceError whenever `buildRunLevelMetricData` is invoked. We declare
// it (emits no JS) to make the type-check faithful WITHOUT altering the runtime behavior.
// Do not "fix" by adding an implementation — that would change behavior. See QA flag.
declare const applyAggregatesToRaw: (
    raw: Record<string, any>,
    aggregates: ReturnType<typeof computeAggregatedMetrics>,
) => Record<string, any>

export const buildRunLevelMetricData = (rawMetrics: any[]): RunLevelMetricData => {
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

export const mergeDeep = (
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

export const flattenMetrics = (raw: Record<string, any>): Record<string, any> => {
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

export const computeAggregatedMetrics = (raw: Record<string, any>) => {
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

export const extractMetricValueFromData = (
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
