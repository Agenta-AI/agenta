/**
 * Pure helpers over the stat blobs the evaluation metrics API returns: normalize them, summarize
 * them as one number, turn them into chart rows, and format the invocation totals.
 *
 * A stat blob looks like `{type: "binary", count, freq: [{value, count}], uniq}` or
 * `{type: "numeric/continuous", count, mean, min, max, hist: [{interval: [from, to], count}]}`.
 *
 * @packageDocumentation
 */

import type {RadarAxis} from "@agenta/ui/components/presentational/charts"

export interface MetricFrequency {
    value: unknown
    count: number
}

export interface MetricBin {
    /** `[from, to]` of the bin, as the API sent it. */
    interval: readonly [number, number]
    count: number
}

/** A stat blob with the API's short names spelled out. Every field is optional. */
export interface MetricStats {
    type?: string
    count?: number
    mean?: number
    median?: number
    sum?: number
    min?: number
    max?: number
    frequency?: MetricFrequency[]
    unique?: unknown[]
    distribution?: MetricBin[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const finite = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined

function readFrequency(raw: unknown): MetricFrequency[] | undefined {
    if (!Array.isArray(raw)) return undefined
    return raw.flatMap((item) => {
        if (!isRecord(item)) return []
        const count = finite(item.count)
        return count === undefined ? [] : [{value: item.value, count}]
    })
}

function readBins(raw: unknown): MetricBin[] | undefined {
    if (!Array.isArray(raw)) return undefined
    return raw.flatMap((item) => {
        if (!isRecord(item) || !Array.isArray(item.interval)) return []
        const from = finite(item.interval[0])
        const to = finite(item.interval[1])
        const count = finite(item.count)
        if (from === undefined || to === undefined || count === undefined) return []
        return [{interval: [from, to] as const, count}]
    })
}

/**
 * Read a raw stat blob. `freq`, `uniq` and `hist` become `frequency`, `unique` and
 * `distribution`. Anything that is not an object gives null.
 */
export function normalizeMetricStats(raw: unknown): MetricStats | null {
    if (!isRecord(raw)) return null
    const stats: MetricStats = {}
    if (typeof raw.type === "string") stats.type = raw.type
    for (const key of ["count", "mean", "median", "sum", "min", "max"] as const) {
        const value = finite(raw[key])
        if (value !== undefined) stats[key] = value
    }
    const frequency = readFrequency(raw.freq ?? raw.frequency)
    if (frequency) stats.frequency = frequency
    const unique = raw.uniq ?? raw.unique
    if (Array.isArray(unique)) stats.unique = unique
    const distribution = readBins(raw.hist ?? raw.distribution)
    if (distribution) stats.distribution = distribution
    return stats
}

const AGGREGATABLE_TYPES = new Set([
    "numeric/continuous",
    "numeric/discrete",
    "binary",
    "categorical/single",
    "categorical/multiple",
])
const NOT_AGGREGATABLE_TYPES = new Set(["string", "json"])

/**
 * True when the overview can chart this metric. The API type decides when it is known; legacy
 * blobs without a type count when they have a mean, median, sum, max or a non-empty frequency.
 */
export function isAggregatableMetric(stats: MetricStats | null | undefined): boolean {
    if (!stats) return false
    if (stats.type && NOT_AGGREGATABLE_TYPES.has(stats.type)) return false
    if (stats.type && AGGREGATABLE_TYPES.has(stats.type)) return true
    if (
        stats.mean !== undefined ||
        stats.median !== undefined ||
        stats.sum !== undefined ||
        stats.max !== undefined
    ) {
        return true
    }
    return (stats.frequency?.length ?? 0) > 0
}

export function isBooleanMetricStats(stats: MetricStats | null | undefined): boolean {
    if (!stats) return false
    if (stats.type === "binary") return true
    if (stats.type) return false
    const values = stats.frequency ?? []
    return values.length > 0 && values.every((item) => typeof item.value === "boolean")
}

/** Percent of `true`, 0..100. The base is `scenarioCount`, else the sum of the counts. */
export function booleanTruePercent(
    stats: MetricStats | null | undefined,
    scenarioCount?: number,
): number | null {
    const frequency = stats?.frequency
    if (!frequency?.length) return null
    const trueCount = frequency
        .filter((item) => item.value === true)
        .reduce((sum, item) => sum + item.count, 0)
    const total = scenarioCount ?? frequency.reduce((sum, item) => sum + item.count, 0)
    if (!total) return null
    return (trueCount / total) * 100
}

/** 3 significant digits, without a trailing exponent or zeros: 1234.5 -> "1230", 0.12345 -> "0.123". */
export function format3Sig(value: number): string {
    if (!Number.isFinite(value)) return "—"
    if (value === 0) return "0"
    return String(Number(value.toPrecision(3)))
}

export interface MetricSummary {
    value: number
    formatted: string
    kind: "boolean" | "numeric"
    label: "mean" | "median" | "max" | "true"
}

/**
 * One number for a metric. Boolean: percent of true, 2 decimals and "%". Numeric: the mean, else
 * the median, else the max, with 3 significant digits.
 */
export function metricSummary(
    stats: MetricStats | null | undefined,
    scenarioCount?: number,
): MetricSummary | null {
    if (!stats) return null
    if (isBooleanMetricStats(stats)) {
        const percent = booleanTruePercent(stats, scenarioCount)
        if (percent === null) return null
        return {value: percent, formatted: `${percent.toFixed(2)}%`, kind: "boolean", label: "true"}
    }
    for (const label of ["mean", "median", "max"] as const) {
        const value = stats[label]
        if (value !== undefined) {
            return {value, formatted: format3Sig(value), kind: "numeric", label}
        }
    }
    return null
}

export interface MetricBar {
    category: string
    value: number
}

/**
 * Histogram rows. Each label comes from its own bin's interval, so a bin the API left out (an
 * empty one) does not shift the labels of the bins after it.
 */
export function histogramBars(stats: MetricStats | null | undefined): MetricBar[] {
    return (stats?.distribution ?? []).map(({interval: [from, to], count}) => ({
        category: from === to ? format3Sig(from) : `${format3Sig(from)}–${format3Sig(to)}`,
        value: count,
    }))
}

const frequencyLabel = (value: unknown): string => {
    if (value === true) return "true"
    if (value === false) return "false"
    if (value === null || value === undefined) return "—"
    return typeof value === "string" ? value : JSON.stringify(value)
}

const booleanRank = (value: unknown) => (value === true ? 0 : value === false ? 1 : 2)

/** Category rows: by count, most first; on a tie `true` before `false`, then by label. */
export function frequencyBars(stats: MetricStats | null | undefined, limit?: number): MetricBar[] {
    const rows = [...(stats?.frequency ?? [])].sort(
        (a, b) =>
            b.count - a.count ||
            booleanRank(a.value) - booleanRank(b.value) ||
            frequencyLabel(a.value).localeCompare(frequencyLabel(b.value)),
    )
    return rows
        .slice(0, limit ?? rows.length)
        .map((item) => ({category: frequencyLabel(item.value), value: item.count}))
}

/** One metric of one run, as the radar reads it. */
export interface RadarMetricInput {
    /** Same id across runs: the axis key. */
    id: string
    kind: "evaluator" | "invocation"
    /** Axis title, for example "Exact match: success" or "Duration". */
    name: string
    stats: MetricStats | null
}

/** The invocation axes the radar adds, in order, when there are fewer than 3 evaluator axes. */
export const RADAR_FALLBACK_INVOCATION_IDS = ["duration", "cost"] as const

/**
 * Radar axes over the runs in `runIds` (the series keys). Evaluator axes come first; Duration and
 * Cost invocation axes are added when there are fewer than 3 evaluator axes. A boolean axis has a
 * max of 100; a numeric axis has the largest `max` over the runs, else `max(mean, 1)`. A run with
 * no value on an axis gets null, not 0.
 */
export function radarAxes(
    metricsByRun: Readonly<Record<string, readonly RadarMetricInput[]>>,
    runIds: readonly string[],
): RadarAxis[] {
    const order: RadarMetricInput[] = []
    const seen = new Set<string>()
    for (const runId of runIds) {
        for (const metric of metricsByRun[runId] ?? []) {
            if (seen.has(metric.id)) continue
            seen.add(metric.id)
            order.push(metric)
        }
    }
    const toAxis = (axisMetric: RadarMetricInput): RadarAxis | null => {
        const statsByRun = runIds.map(
            (runId) =>
                (metricsByRun[runId] ?? []).find((metric) => metric.id === axisMetric.id)?.stats ??
                null,
        )
        const isBoolean = statsByRun.some((stats) => isBooleanMetricStats(stats))
        const rawByRun = statsByRun.map((stats) =>
            isBoolean ? booleanTruePercent(stats) : (metricSummary(stats)?.value ?? null),
        )
        if (rawByRun.every((raw) => raw === null)) return null

        let max = 100
        if (!isBoolean) {
            const maxes = statsByRun.flatMap((stats) =>
                stats?.max !== undefined ? [stats.max] : [],
            )
            const means = rawByRun.flatMap((raw) => (raw === null ? [] : [raw]))
            max = maxes.length ? Math.max(...maxes) : Math.max(...means, 1)
            if (max <= 0) max = 1
        }

        const values: Record<string, {normalized: number; raw: number} | null> = {}
        runIds.forEach((runId, index) => {
            const raw = rawByRun[index]
            values[runId] =
                raw === null ? null : {raw, normalized: Math.min(Math.max(raw / max, 0), 1)}
        })
        return {name: axisMetric.name, max, values}
    }

    // Count only axes that carry a value: a categorical metric draws no axis, so it must not
    // keep the invocation axes out.
    const evaluatorAxes = order
        .filter((metric) => metric.kind === "evaluator")
        .flatMap((metric) => toAxis(metric) ?? [])
    if (evaluatorAxes.length >= 3) return evaluatorAxes
    const invocationAxes = RADAR_FALLBACK_INVOCATION_IDS.flatMap((id) =>
        order.filter((metric) => metric.kind === "invocation" && metric.id === id),
    ).flatMap((metric) => toAxis(metric) ?? [])
    return [...evaluatorAxes, ...invocationAxes]
}

/** USD. 2 decimals from $1, else 3 significant digits ("$0.000123"). */
export function formatCost(value: number): string {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        ...(Math.abs(value) >= 1 || value === 0
            ? {minimumFractionDigits: 2, maximumFractionDigits: 2}
            : {maximumSignificantDigits: 3}),
    }).format(value)
}

/**
 * `milliseconds` under 1 s as "N ms", else "N.NN s". Milliseconds, the unit of the duration
 * metric (`attributes.ag.metrics.duration.cumulative`) and of the trace durations.
 */
export function formatDuration(milliseconds: number): string {
    if (Math.abs(milliseconds) < 1000) return `${Math.round(milliseconds)} ms`
    return `${(milliseconds / 1000).toFixed(2)} s`
}

/** "950", "12.3K", "4.5M". */
export function formatTokens(value: number): string {
    const abs = Math.abs(value)
    if (abs >= 1_000_000) return `${format3Sig(value / 1_000_000)}M`
    if (abs >= 1_000) return `${format3Sig(value / 1_000)}K`
    return String(Math.round(value))
}
