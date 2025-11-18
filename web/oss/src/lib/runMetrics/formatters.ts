import {format3Sig} from "@/oss/components/HumanEvaluations/assets/MetricDetailsPopover/assets/utils"
import {formatCurrency, formatLatency} from "@/oss/lib/helpers/formatters"
import type {BasicStats} from "@/oss/lib/metricUtils"

export const METRIC_PLACEHOLDER = "—"

const formatTokensValue = (value: number | undefined | null): string => {
    if (typeof value !== "number" || !Number.isFinite(value)) return METRIC_PLACEHOLDER
    if (value < 1_000) return Math.round(value).toLocaleString()
    if (value < 1_000_000) return `${(value / 1_000).toFixed(1)}K`
    return `${(value / 1_000_000).toFixed(1)}M`
}

const getMeanFromStats = (stats: BasicStats | undefined): number | undefined => {
    if (!stats) return undefined
    const mean = (stats as Record<string, unknown>).mean
    if (typeof mean === "number") return mean
    const sum = (stats as Record<string, unknown>).sum
    const count = (stats as Record<string, unknown>).count
    if (typeof sum === "number" && typeof count === "number" && count > 0) {
        return sum / count
    }
    return undefined
}

const getTotalFromStats = (stats: BasicStats | undefined): number | undefined => {
    if (!stats) return undefined
    const sum = (stats as Record<string, unknown>).sum
    if (typeof sum === "number") return sum
    const mean = (stats as Record<string, unknown>).mean
    const count = (stats as Record<string, unknown>).count
    if (typeof mean === "number" && typeof count === "number") {
        return mean * count
    }
    if (typeof count === "number") return count
    return undefined
}

const normalizeDash = (value: string): string => (value === "-" ? METRIC_PLACEHOLDER : value)

const METRIC_KEY_PATTERNS: Array<{
    regex: RegExp
    format: (stats: BasicStats | undefined) => string
}> = [
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

export const formatEvaluatorMetricValue = (
    stats: BasicStats | undefined,
    metricKey?: string,
): string => {
    const specialized = formatMetricByKey(metricKey, stats)
    if (specialized !== METRIC_PLACEHOLDER) return specialized
    if (!stats) return METRIC_PLACEHOLDER
    const score = (stats as Record<string, unknown>).score
    if (typeof score === "number") {
        return format3Sig(score)
    }
    const mean = (stats as Record<string, unknown>).mean
    if (typeof mean === "number") {
        return format3Sig(mean)
    }
    const median = (stats as Record<string, unknown>).median
    if (typeof median === "number") {
        return format3Sig(median)
    }
    const value = (stats as Record<string, unknown>).value
    if (typeof value === "number") {
        return format3Sig(value)
    }
    if (value !== undefined && value !== null) {
        return String(value)
    }
    const topCategorical = getTopCategoricalValue(stats)
    if (topCategorical !== undefined && topCategorical !== null) {
        return String(topCategorical)
    }
    const sum = (stats as Record<string, unknown>).sum
    const count = (stats as Record<string, unknown>).count
    if (typeof sum === "number" && typeof count === "number" && count > 0) {
        return format3Sig(sum / count)
    }
    return METRIC_PLACEHOLDER
}

export const formatInvocationMetricValue = (
    metricKey: string,
    stats: BasicStats | undefined,
): string => {
    const specialized = formatMetricByKey(metricKey, stats)
    if (specialized !== METRIC_PLACEHOLDER) return specialized
    return formatEvaluatorMetricValue(stats, metricKey)
}

const getTopCategoricalValue = (stats: BasicStats | undefined): unknown => {
    if (!stats) return undefined
    const rank = (stats as Record<string, any>)?.rank
    if (Array.isArray(rank) && rank.length) {
        const sorted = [...rank].sort(
            (a: any, b: any) => (b?.count ?? 0) - (a?.count ?? 0) || (a?.value === true ? -1 : 1),
        )
        return sorted[0]?.value
    }
    const frequency =
        (stats as Record<string, any>)?.frequency ?? (stats as Record<string, any>)?.freq
    if (Array.isArray(frequency) && frequency.length) {
        const sorted = [...frequency].sort(
            (a: any, b: any) => (b?.count ?? 0) - (a?.count ?? 0) || (a?.value === true ? -1 : 1),
        )
        return sorted[0]?.value
    }
    const unique = (stats as Record<string, any>)?.unique
    if (Array.isArray(unique) && unique.length) {
        return unique[0]
    }
    return undefined
}

export interface FrequencyEntry {
    label: string
    count: number
}

export const buildFrequencyEntries = (stats: BasicStats | undefined): FrequencyEntry[] => {
    if (!stats) return []
    const rawFrequency =
        (stats as Record<string, any>)?.frequency ?? (stats as Record<string, any>)?.freq
    const rawRank = (stats as Record<string, any>)?.rank
    const source = Array.isArray(rawFrequency) && rawFrequency.length ? rawFrequency : rawRank
    if (!Array.isArray(source) || !source.length) return []

    const entries = source
        .map((entry: any) => {
            const label = entry?.value ?? entry?.label ?? entry?.name
            const count = Number(entry?.count ?? entry?.frequency ?? entry?.value ?? 0)
            if (label === undefined || label === null) return null
            return {label: String(label), count}
        })
        .filter(
            (entry: FrequencyEntry | null): entry is FrequencyEntry =>
                entry !== null && entry.label.length > 0,
        )

    if (!entries.length) return []
    return entries.sort((a, b) => b.count - a.count)
}

export const formatPercent = (value: number): string => {
    if (!Number.isFinite(value) || value <= 0) return "0%"
    const percent = value * 100
    if (percent >= 99.95) return "100%"
    if (percent >= 10) return `${percent.toFixed(1)}%`
    return `${percent.toFixed(2)}%`
}
