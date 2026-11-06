/**
 * Run-level metric aggregation, copied from the old app (web/oss `EvalRunDetails/atoms/runMetrics.ts`,
 * `flattenRunLevelMetricData` and `mergeBasicStats`) as pure functions.
 *
 * The metrics API returns one run-level row per run: `data[stepKey][metricKey]` is a stat blob. The
 * screens look a metric up either per step (`{stepKey}.{metricKey}`, an evaluator column) or by the
 * metric key alone (`attributes.ag.metrics.duration.cumulative`, an invocation column). This module
 * builds that flat map once per run.
 *
 * One deliberate difference from the old app: the old flatten merges every step into the key-only
 * entry after it has set the invocation step's value, so an evaluator step that comes after the
 * invocation step in the response is averaged in. On the parity data that turned the app's 522 ms
 * mean into 261 ms. Here the key-only entry of an invocation metric (`attributes.ag.metrics.*`)
 * comes from the invocation step only, as the old code's own comment intends.
 *
 * @packageDocumentation
 */

import {normalizeMetricStats, type MetricFrequency, type MetricStats} from "./metricStats"

/** Keys under this prefix are invocation analytics; every step reports them. */
export const INVOCATION_METRIC_PREFIX = "attributes.ag.metrics."

/** A run-level stat map: `{stepKey}.{metricKey}` and `{metricKey}` to their stats. */
export type RunStatsMap = Record<string, MetricStats>

const addFrequencies = (a?: MetricFrequency[], b?: MetricFrequency[]) => {
    if (!a?.length && !b?.length) return a ?? b
    const counts = new Map<string, {value: unknown; count: number}>()
    for (const entry of [...(a ?? []), ...(b ?? [])]) {
        const key = JSON.stringify(entry.value)
        const current = counts.get(key)
        counts.set(key, {value: entry.value, count: (current?.count ?? 0) + entry.count})
    }
    return [...counts.values()].sort((x, y) => y.count - x.count)
}

const unionValues = (a?: unknown[], b?: unknown[]) => {
    if (!a?.length && !b?.length) return a ?? b
    const seen = new Map<string, unknown>()
    for (const value of [...(a ?? []), ...(b ?? [])]) seen.set(JSON.stringify(value), value)
    return [...seen.values()]
}

const sumOf = (stats: MetricStats): number | undefined =>
    stats.sum ??
    (stats.mean !== undefined && stats.count !== undefined ? stats.mean * stats.count : undefined)

/**
 * Two stat blobs as one: counts and sums add up and the mean is the new sum over the new count;
 * min and max widen; frequencies add up per value; unique values join. A median and a histogram do
 * not combine, so the merged blob keeps the first one's.
 */
export function mergeMetricStats(
    current: MetricStats | undefined,
    incoming: MetricStats,
): MetricStats {
    if (!current) return {...incoming}
    const result: MetricStats = {...current}
    if (incoming.count !== undefined) result.count = (current.count ?? 0) + incoming.count

    const currentSum = sumOf(current)
    const incomingSum = sumOf(incoming)
    if (currentSum !== undefined || incomingSum !== undefined) {
        result.sum = (currentSum ?? 0) + (incomingSum ?? 0)
        if (result.count) result.mean = result.sum / result.count
    }
    const mins = [current.min, incoming.min].filter((v): v is number => v !== undefined)
    if (mins.length) result.min = Math.min(...mins)
    const maxes = [current.max, incoming.max].filter((v): v is number => v !== undefined)
    if (maxes.length) result.max = Math.max(...maxes)

    const frequency = addFrequencies(current.frequency, incoming.frequency)
    if (frequency) result.frequency = frequency
    const unique = unionValues(current.unique, incoming.unique)
    if (unique) result.unique = unique
    return result
}

interface StatsMapRun {
    data?: {steps?: readonly {key: string; type?: string | null}[] | null} | null
}

interface StatsMapMetric {
    scenario_id?: string | null
    timestamp?: string | null
    data?: Record<string, unknown> | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * Which run-level row to read. `static`: the static row (no scenario, no timestamp), else the
 * newest timestamped row; the run page's summary reads this. `latest`: the newest timestamped row,
 * else the static row; the old app's runs list shows a live run's latest window this way.
 */
export type RunLevelRowPreference = "static" | "latest"

/** The run-level row of a run's metrics, by `prefer` (`static` by default). */
export function runLevelMetricRow<T extends StatsMapMetric>(
    metrics: readonly T[],
    prefer: RunLevelRowPreference = "static",
): T | null {
    const runLevel = metrics.filter((metric) => !metric.scenario_id)
    const staticRow = runLevel.find((metric) => !metric.timestamp)
    if (staticRow && prefer === "static") return staticRow
    const timed = runLevel
        .filter((metric) => metric.timestamp && Number.isFinite(Date.parse(metric.timestamp)))
        .sort((a, b) => Date.parse(b.timestamp ?? "") - Date.parse(a.timestamp ?? ""))
    return timed[0] ?? staticRow ?? null
}

/**
 * Flatten one run's run-level metric row. Every stat lands under `{stepKey}.{metricKey}`. The
 * key-only entry of an evaluator metric merges every step that reports it (the old app's rule); the
 * key-only entry of an invocation metric is the invocation step's, else the first step's that has it.
 */
export function buildRunStatsMap(
    run: StatsMapRun | null | undefined,
    metrics: readonly StatsMapMetric[],
    prefer: RunLevelRowPreference = "static",
): RunStatsMap {
    const row = runLevelMetricRow(metrics, prefer)
    const data = isRecord(row?.data) ? row.data : {}
    const invocationStepKey =
        run?.data?.steps?.find((step) => step.type === "invocation")?.key ?? null

    const map: RunStatsMap = {}
    const invocationKeysSet = new Set<string>()
    for (const [stepKey, stepData] of Object.entries(data)) {
        if (!isRecord(stepData)) continue
        for (const [metricKey, raw] of Object.entries(stepData)) {
            const stats = normalizeMetricStats(raw)
            if (!stats) continue
            map[`${stepKey}.${metricKey}`] = stats
            if (!metricKey.startsWith(INVOCATION_METRIC_PREFIX)) {
                map[metricKey] = mergeMetricStats(map[metricKey], stats)
            }
        }
    }
    // Invocation metrics: the invocation step wins; a run without one (live) takes the first step.
    const stepOrder = [
        ...(invocationStepKey && isRecord(data[invocationStepKey]) ? [invocationStepKey] : []),
        ...Object.keys(data).filter((key) => key !== invocationStepKey),
    ]
    for (const stepKey of stepOrder) {
        const stepData = data[stepKey]
        if (!isRecord(stepData)) continue
        for (const metricKey of Object.keys(stepData)) {
            if (
                !metricKey.startsWith(INVOCATION_METRIC_PREFIX) ||
                invocationKeysSet.has(metricKey)
            ) {
                continue
            }
            const stats = map[`${stepKey}.${metricKey}`]
            if (!stats) continue
            invocationKeysSet.add(metricKey)
            map[metricKey] = stats
        }
    }
    return map
}

/**
 * The stats of one metric. With a step key only that step's entry counts, so two runs with
 * different evaluators never match each other's metric (the old app's rule); without one the
 * key-only entry.
 */
export function selectRunMetricStats(
    map: RunStatsMap,
    {metricKey, stepKey}: {metricKey: string; stepKey?: string | null},
): MetricStats | null {
    if (stepKey) return map[`${stepKey}.${metricKey}`] ?? null
    return map[metricKey] ?? null
}

/** The mean and the total of an invocation metric; either may be missing. */
export function invocationMetricValues(stats: MetricStats | null | undefined): {
    mean: number | undefined
    total: number | undefined
} {
    if (!stats) return {mean: undefined, total: undefined}
    const mean =
        stats.mean ?? (stats.sum !== undefined && stats.count ? stats.sum / stats.count : undefined)
    return {mean, total: sumOf(stats)}
}
