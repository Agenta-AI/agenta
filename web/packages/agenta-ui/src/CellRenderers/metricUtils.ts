/**
 * Shared metric utilities for rendering metric cell values.
 *
 * Consolidates metric formatting, type detection, and value extraction
 * used by both EvalRunDetails and annotation session tables.
 *
 * @packageDocumentation
 */

import {formatCurrency, formatLatency} from "@agenta/shared/utils"

// ============================================================================
// TYPES
// ============================================================================

/** Simple frequency entry returned by backend */
export interface FrequencyEntry<T = unknown> {
    value: T
    count: number
}

/** Stats object returned by backend metrics APIs */
export interface BasicStats {
    mean?: number
    sum?: number
    frequency?: FrequencyEntry[]
    freq?: FrequencyEntry[]
    rank?: FrequencyEntry[]
    count?: number
    type?: string
    unique?: unknown[]
    uniq?: unknown[]
    [key: string]: unknown
}

export const METRIC_PLACEHOLDER = "—"

// ============================================================================
// TYPE DETECTION
// ============================================================================

/** Check if a value is a BasicStats object (has statistical fields) */
export const isBasicStats = (value: unknown): value is BasicStats => {
    if (!value || typeof value !== "object") return false
    const candidate = value as Record<string, unknown>
    if (typeof candidate.mean === "number" || typeof candidate.median === "number") return true
    if (typeof candidate.sum === "number" || typeof candidate.count === "number") return true
    if (
        Array.isArray(candidate.frequency) ||
        Array.isArray(candidate.freq) ||
        Array.isArray(candidate.rank)
    )
        return true
    return false
}

/** Check if a value represents an array/categorical metric */
export const isArrayMetricValue = (value: unknown, metricType?: string): boolean => {
    if (metricType?.toLowerCase?.() === "array") return true
    if (Array.isArray(value)) return true
    if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) return true
    if (typeof value === "object" && value !== null) {
        const v = value as Record<string, unknown>
        return (
            v.type === "categorical/multiple" ||
            (typeof v.type === "string" && (v.type as string).includes("categorical"))
        )
    }
    return false
}

/** Check if stats have distribution data (frequency/rank arrays) */
export const hasDistributionData = (stats: BasicStats | undefined): boolean => {
    return Boolean(
        stats &&
        (Array.isArray(stats.frequency) || Array.isArray(stats.freq) || Array.isArray(stats.rank)),
    )
}

/** Extract BasicStats from a value if it matches the shape */
export const extractBasicStats = (value: unknown): BasicStats | undefined => {
    if (!value || typeof value !== "object") return undefined
    const candidate = value as BasicStats
    if (
        Array.isArray(candidate.frequency) ||
        Array.isArray(candidate.freq) ||
        Array.isArray(candidate.rank) ||
        typeof candidate.count === "number" ||
        typeof candidate.mean === "number"
    ) {
        return candidate
    }
    return undefined
}

// ============================================================================
// FORMATTING
// ============================================================================

/** Format a number to 3 significant figures */
export const format3Sig = (num: number | string): string => {
    if (typeof num !== "number") return String(num)
    if (!Number.isFinite(num)) return String(num)

    const abs = Math.abs(num)
    if (abs === 0) return "0"

    const exponent = Math.floor(Math.log10(abs))

    if (exponent >= 10 || exponent <= -10) {
        return num.toExponential(2)
    }

    const decimals = Math.max(0, 2 - exponent)
    const fixed = num.toFixed(decimals)

    return fixed.replace(/\.?0+$/, "")
}

const formatTokensValue = (value: number | undefined | null): string => {
    if (typeof value !== "number" || !Number.isFinite(value)) return METRIC_PLACEHOLDER
    if (value < 1_000) return Math.round(value).toLocaleString()
    if (value < 1_000_000) return `${(value / 1_000).toFixed(1)}K`
    return `${(value / 1_000_000).toFixed(1)}M`
}

const getMeanFromStats = (stats: BasicStats | undefined): number | undefined => {
    if (!stats) return undefined
    if (typeof stats.mean === "number") return stats.mean
    if (typeof stats.sum === "number" && typeof stats.count === "number" && stats.count > 0) {
        return stats.sum / stats.count
    }
    return undefined
}

const getTotalFromStats = (stats: BasicStats | undefined): number | undefined => {
    if (!stats) return undefined
    if (typeof stats.sum === "number") return stats.sum
    if (typeof stats.mean === "number" && typeof stats.count === "number") {
        return stats.mean * stats.count
    }
    if (typeof stats.count === "number") return stats.count
    return undefined
}

const normalizeDash = (value: string): string => (value === "-" ? METRIC_PLACEHOLDER : value)

/** Pattern-based metric formatting (cost, duration, tokens, errors) */
const METRIC_KEY_PATTERNS: {
    regex: RegExp
    format: (stats: BasicStats | undefined) => string
}[] = [
    {
        regex: /costs?(\.cumulative)?\.total/i,
        format: (stats) => normalizeDash(formatCurrency(getMeanFromStats(stats) ?? null)),
    },
    {
        regex: /duration/i,
        format: (stats) => {
            const meanMs = getMeanFromStats(stats)
            const seconds = typeof meanMs === "number" ? meanMs / 1_000 : undefined
            return normalizeDash(formatLatency(seconds ?? null))
        },
    },
    {
        regex: /tokens?(\.cumulative)?\.total/i,
        format: (stats) => formatTokensValue(getMeanFromStats(stats) ?? null),
    },
    {
        regex: /tokens\.prompt/i,
        format: (stats) => formatTokensValue(getMeanFromStats(stats) ?? null),
    },
    {
        regex: /tokens\.completion/i,
        format: (stats) => formatTokensValue(getMeanFromStats(stats) ?? null),
    },
    {
        regex: /errors?/i,
        format: (stats) => {
            const total = getTotalFromStats(stats)
            return typeof total === "number" && Number.isFinite(total)
                ? Math.round(total).toLocaleString()
                : METRIC_PLACEHOLDER
        },
    },
]

/** Format a metric by its key pattern (for well-known metrics like cost, duration) */
export const formatMetricByKey = (
    metricKey: string | undefined,
    stats: BasicStats | undefined,
): string => {
    if (!metricKey) return METRIC_PLACEHOLDER
    for (const pattern of METRIC_KEY_PATTERNS) {
        if (pattern.regex.test(metricKey)) {
            return pattern.format(stats)
        }
    }
    return METRIC_PLACEHOLDER
}

const isCategoricalMultiple = (stats: BasicStats | undefined): boolean => {
    if (!stats) return false
    const type = stats.type
    return (
        type === "categorical/multiple" ||
        (typeof type === "string" && type.includes("categorical"))
    )
}

const sortFrequencyEntries = (a: FrequencyEntry, b: FrequencyEntry): number =>
    (b.count ?? 0) - (a.count ?? 0) || (a.value === true ? -1 : 1)

const getTopCategoricalValue = (stats: BasicStats | undefined): unknown => {
    if (!stats) return undefined

    const isMultiple = isCategoricalMultiple(stats)

    const rank = stats.rank
    if (Array.isArray(rank) && rank.length) {
        const sorted = [...rank].sort(sortFrequencyEntries)
        if (isMultiple) {
            return sorted.map((entry) => entry.value).filter((v) => v !== undefined)
        }
        return sorted[0]?.value
    }
    const frequency = stats.frequency ?? stats.freq
    if (Array.isArray(frequency) && frequency.length) {
        const sorted = [...frequency].sort(sortFrequencyEntries)
        if (isMultiple) {
            return sorted.map((entry) => entry.value).filter((v) => v !== undefined)
        }
        return sorted[0]?.value
    }
    const unique = stats.unique ?? stats.uniq
    if (Array.isArray(unique) && unique.length) {
        if (isMultiple) return unique
        return unique[0]
    }
    return undefined
}

/** Format a BasicStats value for display (evaluator/annotation metrics) */
export const formatEvaluatorMetricValue = (
    stats: BasicStats | undefined,
    metricKey?: string,
): string => {
    const specialized = formatMetricByKey(metricKey, stats)
    if (specialized !== METRIC_PLACEHOLDER) return specialized
    if (!stats) return METRIC_PLACEHOLDER
    const score = stats.score
    if (typeof score === "number") return format3Sig(score)
    if (typeof stats.mean === "number") return format3Sig(stats.mean)
    const median = stats.median
    if (typeof median === "number") return format3Sig(median)
    const value = stats.value
    if (typeof value === "number") return format3Sig(value)
    if (value !== undefined && value !== null) return String(value)
    const topCategorical = getTopCategoricalValue(stats)
    if (topCategorical !== undefined && topCategorical !== null) {
        if (Array.isArray(topCategorical)) {
            return topCategorical.map((v) => String(v)).join(", ")
        }
        return String(topCategorical)
    }
    if (typeof stats.sum === "number" && typeof stats.count === "number" && stats.count > 0) {
        return format3Sig(stats.sum / stats.count)
    }
    return METRIC_PLACEHOLDER
}

/** Metric formatter config used by formatMetricValue */
interface MetricFormatter {
    prefix?: string
    suffix?: string
    decimals?: number
    multiplier?: number
}

const METRIC_FORMATTERS: Record<string, MetricFormatter> = {
    cost: {prefix: "$", decimals: 6},
    costs: {prefix: "$", decimals: 6},
    price: {prefix: "$", decimals: 4},
    totalCost: {prefix: "$", decimals: 4},
    "attributes.ag.metrics.costs.cumulative.total": {prefix: "$", decimals: 4},
    latency: {decimals: 2, suffix: "s", multiplier: 0.001},
    duration: {decimals: 2, suffix: "s", multiplier: 0.001},
    "duration.total": {decimals: 2, suffix: "s", multiplier: 0.001},
    "attributes.ag.metrics.duration.cumulative": {decimals: 2, suffix: "s", multiplier: 0.001},
    "attributes.ag.metrics.tokens.cumulative.total": {decimals: 0},
    "attributes.ag.metrics.errors.cumulative": {decimals: 0},
    accuracy: {suffix: "%", decimals: 2},
    recall: {suffix: "%", decimals: 2},
    precision: {suffix: "%", decimals: 2},
}

/** Format a scalar metric value using key-based formatters */
export function formatMetricValueByKey(metricKey: string, value: unknown): string {
    if (value == null) return ""

    if (Array.isArray(value)) {
        return value.map((v) => formatMetricValueByKey(metricKey, v)).join(", ")
    }

    if (typeof value === "boolean") return value ? "true" : "false"

    const numValue = typeof value === "number" ? value : parseFloat(String(value))
    const segments = metricKey.split(".")

    for (const segment of segments) {
        const fmt = METRIC_FORMATTERS[segment]
        if (fmt) {
            const finalVal = fmt.multiplier ? numValue * fmt.multiplier : numValue
            const formatted = Number.isFinite(finalVal)
                ? finalVal.toFixed(fmt.decimals ?? 2)
                : String(value)
            return `${fmt.prefix ?? ""}${formatted}${fmt.suffix ?? ""}`
        }
    }

    const directFmt = METRIC_FORMATTERS[metricKey]
    if (directFmt) {
        const finalVal = directFmt.multiplier ? numValue * directFmt.multiplier : numValue
        const formatted = Number.isFinite(finalVal)
            ? finalVal.toFixed(directFmt.decimals ?? 2)
            : String(value)
        return `${directFmt.prefix ?? ""}${formatted}${directFmt.suffix ?? ""}`
    }

    if (typeof value === "number") return format3Sig(value)
    return String(value)
}

/**
 * Format a metric value for cell display.
 *
 * Handles all metric types: null, arrays, booleans, stats objects, scalars.
 */
export const formatMetricDisplay = ({
    value,
    metricKey,
    metricType,
}: {
    value: unknown
    metricKey?: string
    metricType?: string
}): string => {
    if (value === null || value === undefined) return METRIC_PLACEHOLDER

    if (Array.isArray(value)) {
        const formattedItems = value
            .map((item) => formatMetricDisplay({value: item, metricKey, metricType}))
            .filter((item) => item && item !== METRIC_PLACEHOLDER)
        return formattedItems.length ? formattedItems.join(", ") : METRIC_PLACEHOLDER
    }

    if (typeof value === "boolean") return String(value)

    if (typeof value === "object" && value !== null) {
        if (isBasicStats(value)) {
            const formatted = formatEvaluatorMetricValue(value, metricKey)
            if (formatted !== METRIC_PLACEHOLDER) return formatted
        }
        try {
            return JSON.stringify(value)
        } catch {
            return String(value)
        }
    }

    if (typeof value === "number" || typeof value === "string") {
        if (metricType === "boolean") return String(value)
        const formatted = formatMetricValueByKey(metricKey ?? "", value as number | string)
        return formatted || METRIC_PLACEHOLDER
    }

    try {
        return JSON.stringify(value)
    } catch {
        return String(value)
    }
}

// ============================================================================
// FREQUENCY/CHART DATA
// ============================================================================

interface NormalizedStats extends BasicStats {
    distribution?: FrequencyEntry[]
    binSize?: number
    min?: number
    max?: number
}

/** Normalize stats object keys (freq→frequency, uniq→unique) */
const normalizeStats = (value: BasicStats | undefined): NormalizedStats | undefined => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value as undefined
    const next: NormalizedStats = {...value}

    if (Array.isArray(next.freq)) {
        next.frequency = next.freq.map((entry: FrequencyEntry) => ({
            value: entry?.value,
            count: (entry?.count as number) ?? 0,
        }))
        delete next.freq
    }

    if (Array.isArray(next.uniq)) {
        next.unique = next.uniq
        delete next.uniq
    }

    if (Array.isArray(next.frequency)) {
        next.frequency = next.frequency.map((entry: FrequencyEntry) => ({
            value: entry?.value,
            count: (entry?.count as number) ?? 0,
        }))
        next.frequency.sort((a: FrequencyEntry, b: FrequencyEntry) => {
            const countDiff = (b.count ?? 0) - (a.count ?? 0)
            if (countDiff !== 0) return countDiff
            const aIsTrue = a.value === true
            const bIsTrue = b.value === true
            if (aIsTrue && !bIsTrue) return -1
            if (!aIsTrue && bIsTrue) return 1
            const aIsFalse = a.value === false
            const bIsFalse = b.value === false
            if (aIsFalse && !bIsFalse) return -1
            if (!aIsFalse && bIsFalse) return 1
            return String(a.value).localeCompare(String(b.value))
        })
        next.rank = next.frequency
        if (!Array.isArray(next.unique) || !next.unique.length) {
            next.unique = next.frequency.map((entry: FrequencyEntry) => entry.value)
        }
    } else if (Array.isArray(next.rank)) {
        next.rank = next.rank.map((entry: FrequencyEntry) => ({
            value: entry?.value,
            count: (entry?.count as number) ?? 0,
        }))
    }

    return next
}

/** Build frequency chart data from stats (for categorical/binary metrics) */
export const buildFrequencyChartData = (
    stats: Record<string, unknown>,
): {label: string | number; value: number}[] => {
    const normalized = normalizeStats(stats as BasicStats)

    const frequency = Array.isArray(normalized?.frequency) ? normalized.frequency : []
    if (frequency.length) {
        return frequency.map((entry: FrequencyEntry) => ({
            label: (entry?.value as string | number) ?? "",
            value: Number(entry?.count ?? 0),
        }))
    }

    const rank = Array.isArray(normalized?.rank) ? normalized.rank : []
    if (rank.length) {
        return rank.map((entry: FrequencyEntry) => ({
            label: (entry?.value as string | number) ?? "",
            value: Number(entry?.count ?? 0),
        }))
    }

    return []
}

// ============================================================================
// TAG HELPERS
// ============================================================================

/** Color palette for category tags */
export const TAG_COLORS = ["green", "blue", "purple", "orange", "cyan", "magenta", "gold", "lime"]
export const getTagColor = (index: number) => TAG_COLORS[index % TAG_COLORS.length]

/** Format a category label for display */
export const formatCategoryLabel = (value: unknown): string => {
    if (value === null || value === undefined) return "—"
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    try {
        return JSON.stringify(value)
    } catch {
        return String(value)
    }
}

/**
 * Parse metric values into tag entries for categorical rendering.
 *
 * Handles: stats objects, arrays, JSON array strings, comma/newline-separated strings.
 */
export const parseArrayTags = (
    value: unknown,
    statsValue?: BasicStats,
    maxTags = 3,
): {label: string; count: number}[] => {
    // First try to get from stats (aggregated view)
    if (statsValue) {
        const fromStats = buildFrequencyChartData(statsValue)
        if (fromStats.length > 0) {
            return fromStats
                .map((entry) => ({
                    label: formatCategoryLabel(entry.label),
                    count: Number(entry.value) || 0,
                }))
                .filter((entry) => Number.isFinite(entry.count))
                .slice(0, maxTags)
        }
    }

    // Handle arrays
    if (Array.isArray(value)) {
        return value
            .map((v) => formatCategoryLabel(v))
            .filter((v) => v !== "—")
            .map((label) => ({label, count: 1}))
            .slice(0, maxTags)
    }

    // Handle JSON array strings
    if (typeof value === "string" && value.startsWith("[")) {
        try {
            const parsed = JSON.parse(value)
            if (Array.isArray(parsed)) {
                return parsed
                    .map((v) => formatCategoryLabel(v))
                    .filter((v) => v !== "—")
                    .map((label) => ({label, count: 1}))
                    .slice(0, maxTags)
            }
        } catch {
            // Not valid JSON
        }
    }

    // Handle comma-separated strings
    if (typeof value === "string" && value.includes(",")) {
        return value
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean)
            .map((label) => ({label, count: 1}))
            .slice(0, maxTags)
    }

    // Handle newline-separated strings
    if (typeof value === "string" && value.includes("\n")) {
        return value
            .split("\n")
            .map((v) => v.trim())
            .filter(Boolean)
            .map((label) => ({label, count: 1}))
            .slice(0, maxTags)
    }

    // Single value
    if (value && typeof value === "string" && value !== "—") {
        return [{label: value, count: 1}]
    }

    return []
}
