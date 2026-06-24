/**
 * Generic scenario metrics — relocated faithfully from the annotation session
 * controller's metrics block. Keyed purely by `{projectId, runId, scenarioId}`
 * (no `activeRunIdAtom`/`projectIdAtom`/session reads).
 *
 * Provides the metrics query/data families plus the `resolveMetricValue` /
 * `resolveMetricStats` helpers and a GENERIC `scenarioMetricForEvaluator` family
 * that resolves value + stats from metrics ONLY (no annotation lookup).
 */

import {queryEvaluationMetrics} from "@agenta/entities/evaluationRun"
import {atom} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import type {ScenarioEvaluatorKey, ScenarioMetricData, ScenarioMetricForEvaluator} from "./types"

// ============================================================================
// KEY TYPES
// ============================================================================

export interface ScenarioMetricsKey {
    projectId: string
    runId: string
    scenarioId: string
}

function scenarioMetricsKeyEqual(a: ScenarioMetricsKey, b: ScenarioMetricsKey): boolean {
    return (
        `${a.projectId}|${a.runId}|${a.scenarioId}` === `${b.projectId}|${b.runId}|${b.scenarioId}`
    )
}

export interface ScenarioMetricForEvaluatorKey extends ScenarioEvaluatorKey {
    projectId: string
    runId: string
}

function serializeScenarioMetricForEvaluatorKey(key: ScenarioMetricForEvaluatorKey): string {
    return `${key.projectId}|${key.runId}|${key.scenarioId}|${key.evaluatorId ?? ""}|${key.evaluatorSlug ?? ""}|${key.path ?? ""}|${key.stepKey ?? ""}`
}

// ============================================================================
// HELPERS (verbatim from annotationSessionController metrics block)
// ============================================================================

/** Deep-merge two plain objects (arrays and primitives are overwritten). */
function mergeDeep(
    target: Record<string, unknown>,
    source: Record<string, unknown>,
): Record<string, unknown> {
    const output: Record<string, unknown> = {...target}
    for (const [key, value] of Object.entries(source ?? {})) {
        if (
            value &&
            typeof value === "object" &&
            !Array.isArray(value) &&
            typeof output[key] === "object" &&
            output[key] !== null &&
            !Array.isArray(output[key])
        ) {
            output[key] = mergeDeep(
                output[key] as Record<string, unknown>,
                value as Record<string, unknown>,
            )
        } else {
            output[key] = value
        }
    }
    return output
}

/**
 * Check if an object is a metric data shape (has a `type` field like "binary",
 * "categorical/multiple", "string", "continuous").
 * These are leaf metric objects that should be resolved to a display value.
 */
function isMetricDataObject(v: Record<string, unknown>): boolean {
    return (
        typeof v.type === "string" &&
        ["binary", "categorical/multiple", "categorical/single", "string", "continuous"].includes(
            v.type as string,
        )
    )
}

/**
 * Extract a display value from a metric data object.
 * - binary: returns the boolean value of the dominant frequency entry
 * - categorical: returns the array of unique values
 * - continuous: returns the mean or first freq value
 * - string: returns the count or freq values
 */
function extractMetricDisplayValue(v: Record<string, unknown>): unknown {
    const type = v.type as string
    const freq = Array.isArray(v.freq) ? v.freq : []

    if (type === "binary") {
        // Find the freq entry with count > 0
        const active = freq.find(
            (f: Record<string, unknown>) => typeof f.count === "number" && f.count > 0,
        )
        return active?.value ?? null
    }
    if (type === "categorical/multiple" || type === "categorical/single") {
        // Return array of values with count > 0
        const activeValues = freq
            .filter((f: Record<string, unknown>) => typeof f.count === "number" && f.count > 0)
            .map((f: Record<string, unknown>) => f.value)
        return activeValues.length > 0 ? activeValues : (v.uniq ?? null)
    }
    if (type === "continuous") {
        if (typeof v.mean === "number") return v.mean
        const active = freq.find(
            (f: Record<string, unknown>) => typeof f.count === "number" && f.count > 0,
        )
        return active?.value ?? null
    }
    if (type === "string") {
        if (freq.length > 0) {
            const active = freq.find(
                (f: Record<string, unknown>) => typeof f.count === "number" && f.count > 0,
            )
            return active?.value ?? null
        }
        return v.count ?? null
    }
    return null
}

/** Flatten nested metric data to dot-notation keys for easy lookup. */
function flattenMetrics(raw: Record<string, unknown>): {
    flat: Record<string, unknown>
    stats: Record<string, Record<string, unknown>>
} {
    const flat: Record<string, unknown> = {}
    const stats: Record<string, Record<string, unknown>> = {}

    const storeKeys = (
        fullKey: string,
        prefix: string,
        key: string,
        displayValue: unknown,
        statsObj: Record<string, unknown> | null,
    ) => {
        flat[fullKey] = displayValue
        if (statsObj) stats[fullKey] = statsObj

        // Stripped prefix: "query-direct.slug.attributes.ag.data.outputs.isAwesome" → "isAwesome"
        const outputMatch = fullKey.match(
            /(?:attributes\.ag\.data\.outputs\.|data\.outputs\.|outputs\.)(.+)$/,
        )
        if (outputMatch) {
            const outputKey = outputMatch[1]
            if (flat[outputKey] === undefined) {
                flat[outputKey] = displayValue
                if (statsObj) stats[outputKey] = statsObj
            }
        }
        if (prefix && flat[key] === undefined) {
            flat[key] = displayValue
            if (statsObj) stats[key] = statsObj
        }
    }

    const walk = (obj: Record<string, unknown>, prefix: string) => {
        for (const [key, value] of Object.entries(obj)) {
            const fullKey = prefix ? `${prefix}.${key}` : key

            if (value && typeof value === "object" && !Array.isArray(value)) {
                const v = value as Record<string, unknown>

                // Check if it's a metric data shape — extract display value + keep stats
                if (isMetricDataObject(v)) {
                    const displayValue = extractMetricDisplayValue(v)
                    storeKeys(fullKey, prefix, key, displayValue, v)
                    continue
                }

                // Check if it's a stats object with a scalar value
                if (typeof v.mean === "number") {
                    flat[fullKey] = v.mean
                    stats[fullKey] = v
                } else if (typeof v.sum === "number") {
                    flat[fullKey] = v.sum
                    stats[fullKey] = v
                }
                // Recurse into nested objects
                walk(v, fullKey)
            } else {
                flat[fullKey] = value
            }

            // Also store unprefixed key for easier lookup
            if (prefix && flat[key] === undefined) {
                if (value && typeof value === "object" && !Array.isArray(value)) {
                    const v = value as Record<string, unknown>
                    if (typeof v.mean === "number") {
                        flat[key] = v.mean
                        stats[key] = v
                    } else if (typeof v.sum === "number") {
                        flat[key] = v.sum
                        stats[key] = v
                    }
                } else {
                    flat[key] = value
                }
            }
        }
    }

    walk(raw, "")
    return {flat, stats}
}

// ============================================================================
// METRIC RESOLUTION HELPERS (exported for reuse by annotation)
// ============================================================================

/**
 * Resolve a metric value for a specific scenario + evaluator step.
 *
 * Looks up the value from the flattened metrics map using multiple
 * candidate keys (stepKey-prefixed, evaluatorSlug-prefixed, and plain path).
 */
export function resolveMetricValue(
    metrics: ScenarioMetricData | null,
    path: string | null | undefined,
    stepKey: string | null | undefined,
    evaluatorSlug: string | null | undefined,
): unknown {
    if (!metrics || !path) return undefined

    const flat = metrics.flat
    if (!flat || Object.keys(flat).length === 0) return undefined

    // Strip common prefixes from path
    let cleanPath = path
    for (const prefix of ["attributes.ag.data.outputs.", "data.outputs.", "outputs."]) {
        if (cleanPath.startsWith(prefix)) {
            cleanPath = cleanPath.slice(prefix.length)
            break
        }
    }

    // Build candidate keys in priority order
    const candidates: string[] = []

    // Step-prefixed candidates (most specific)
    if (stepKey) {
        candidates.push(`${stepKey}.${cleanPath}`)
        candidates.push(`${stepKey}.${path}`)
    }

    // Evaluator-slug-prefixed candidates
    if (evaluatorSlug) {
        candidates.push(`${evaluatorSlug}.${cleanPath}`)
        candidates.push(`${evaluatorSlug}.${path}`)
    }

    // Plain path candidates
    candidates.push(cleanPath)
    candidates.push(path)

    // Direct lookup
    for (const key of candidates) {
        if (Object.prototype.hasOwnProperty.call(flat, key)) {
            return flat[key]
        }
    }

    // Suffix match — find any key ending with the path
    for (const suffix of [`.${cleanPath}`, `.${path}`]) {
        const matchKey = Object.keys(flat).find((k) => k.endsWith(suffix))
        if (matchKey !== undefined) {
            return flat[matchKey]
        }
    }

    return undefined
}

/**
 * Resolve the full stats object for a metric (for distribution bar rendering).
 * Uses the same candidate-key logic as resolveMetricValue but reads from `stats` map.
 */
export function resolveMetricStats(
    metrics: ScenarioMetricData | null,
    path: string | null | undefined,
    stepKey: string | null | undefined,
    evaluatorSlug: string | null | undefined,
): Record<string, unknown> | undefined {
    if (!metrics || !path) return undefined

    const statsMap = metrics.stats
    if (!statsMap || Object.keys(statsMap).length === 0) return undefined

    let cleanPath = path
    for (const prefix of ["attributes.ag.data.outputs.", "data.outputs.", "outputs."]) {
        if (cleanPath.startsWith(prefix)) {
            cleanPath = cleanPath.slice(prefix.length)
            break
        }
    }

    const candidates: string[] = []
    if (stepKey) {
        candidates.push(`${stepKey}.${cleanPath}`)
        candidates.push(`${stepKey}.${path}`)
    }
    if (evaluatorSlug) {
        candidates.push(`${evaluatorSlug}.${cleanPath}`)
        candidates.push(`${evaluatorSlug}.${path}`)
    }
    candidates.push(cleanPath)
    candidates.push(path)

    for (const key of candidates) {
        if (Object.prototype.hasOwnProperty.call(statsMap, key)) {
            return statsMap[key]
        }
    }

    for (const suffix of [`.${cleanPath}`, `.${path}`]) {
        const matchKey = Object.keys(statsMap).find((k) => k.endsWith(suffix))
        if (matchKey !== undefined) {
            return statsMap[matchKey]
        }
    }

    return undefined
}

// ============================================================================
// FAMILIES
// ============================================================================

/**
 * Per-scenario metrics query — fetches from `POST /evaluations/metrics/query`.
 *
 * Each scenario has metrics produced by evaluator steps. Keyed purely by
 * `{projectId, runId, scenarioId}` (no session reads).
 */
export const scenarioMetricsQueryAtomFamily = atomFamily(
    ({projectId, runId, scenarioId}: ScenarioMetricsKey) =>
        atomWithQuery<ScenarioMetricData | null>(() => ({
            queryKey: ["evaluations", "scenario-metrics", projectId, runId, scenarioId],
            queryFn: async (): Promise<ScenarioMetricData | null> => {
                if (!projectId || !runId || !scenarioId) return null

                // Single scenario belongs to exactly one run, so constraining by
                // run_id here is a redundant (behavior-equivalent) narrowing — routed
                // through the typed/zod entities fetcher instead of raw axios.
                const rawMetrics = await queryEvaluationMetrics({
                    projectId,
                    runId,
                    scenarioIds: [scenarioId],
                })

                if (rawMetrics.length === 0) return null

                // Merge all metric entries for this scenario
                let merged: Record<string, unknown> = {}
                for (const entry of rawMetrics) {
                    const data = entry.data ?? entry
                    if (data && typeof data === "object") {
                        merged = mergeDeep(merged, data as Record<string, unknown>)
                    }
                }

                const {flat, stats} = flattenMetrics(merged)
                return {raw: merged, flat, stats}
            },
            enabled: Boolean(projectId && runId && scenarioId),
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
        })),
    scenarioMetricsKeyEqual,
)

/**
 * Resolved metrics data for a scenario.
 * Returns the flat + raw metric data (or null if not loaded).
 */
export const scenarioMetricsAtomFamily = atomFamily(
    ({projectId, runId, scenarioId}: ScenarioMetricsKey) =>
        atom<ScenarioMetricData | null>((get) => {
            if (!projectId || !runId || !scenarioId) return null
            const query = get(scenarioMetricsQueryAtomFamily({projectId, runId, scenarioId}))
            return query.data ?? null
        }),
    scenarioMetricsKeyEqual,
)

/**
 * GENERIC metric resolution for an evaluator in a scenario.
 * Resolves value + stats from metrics ONLY (no annotation lookup — that stays in
 * the annotation package's own wrapper).
 */
export const scenarioMetricForEvaluatorAtomFamily = atomFamily(
    (key: ScenarioMetricForEvaluatorKey) =>
        atom<ScenarioMetricForEvaluator>((get) => {
            const metrics = get(
                scenarioMetricsAtomFamily({
                    projectId: key.projectId,
                    runId: key.runId,
                    scenarioId: key.scenarioId,
                }),
            )

            const value = resolveMetricValue(
                metrics,
                key.path ?? null,
                key.stepKey ?? null,
                key.evaluatorSlug ?? null,
            )

            const stats = resolveMetricStats(
                metrics,
                key.path ?? null,
                key.stepKey ?? null,
                key.evaluatorSlug ?? null,
            )

            return {value, stats}
        }),
    (a, b) =>
        serializeScenarioMetricForEvaluatorKey(a) === serializeScenarioMetricForEvaluatorKey(b),
)
