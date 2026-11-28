/**
 * Pure helpers over the stat blobs the evaluation metrics API returns: normalize them, summarize
 * them as one number, turn them into chart rows, and format the invocation totals.
 *
 * A stat blob looks like `{type: "binary", count, freq: [{value, count}], uniq}` or
 * `{type: "numeric/continuous", count, mean, min, max, hist: [{interval: [from, to], count}]}`.
 *
 * @packageDocumentation
 */

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

/** USD. 2 decimals from $1, else 3 significant digits ("$0.000123"). */
const costDigits = (value: number) =>
    Math.abs(value) >= 1 || value === 0
        ? {minimumFractionDigits: 2, maximumFractionDigits: 2}
        : {maximumSignificantDigits: 3}

export function formatCost(value: number): string {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        ...costDigits(value),
    }).format(value)
}

/** A cost rounded as {@link formatCost} prints it, by the same `Intl` rounding. */
export function roundCost(value: number): number {
    return Number(
        new Intl.NumberFormat("en-US", {useGrouping: false, ...costDigits(value)}).format(value),
    )
}

/**
 * `milliseconds` under 1 s as "N ms", else "N.NN s". Milliseconds, the unit of the duration
 * metric (`attributes.ag.metrics.duration.cumulative`) and of the trace durations.
 */
export function formatDuration(milliseconds: number): string {
    if (Math.abs(milliseconds) < 1000) return `${Math.round(milliseconds)} ms`
    return `${(milliseconds / 1000).toFixed(2)} s`
}

/** A duration in milliseconds rounded as {@link formatDuration} prints it. */
export function roundDuration(milliseconds: number): number {
    if (Math.abs(milliseconds) < 1000) return Math.round(milliseconds)
    return Number((milliseconds / 1000).toFixed(2)) * 1000
}

/** "950", "12.3K", "4.5M". */
export function formatTokens(value: number): string {
    const abs = Math.abs(value)
    if (abs >= 1_000_000) return `${format3Sig(value / 1_000_000)}M`
    if (abs >= 1_000) return `${format3Sig(value / 1_000)}K`
    return String(Math.round(value))
}

/** A token count rounded as {@link formatTokens} prints it. */
export function roundTokens(value: number): number {
    const abs = Math.abs(value)
    if (abs >= 1_000_000) return Number((value / 1_000_000).toPrecision(3)) * 1_000_000
    if (abs >= 1_000) return Number((value / 1_000).toPrecision(3)) * 1_000
    return Math.round(value)
}
