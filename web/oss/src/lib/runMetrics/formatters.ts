/**
 * @deprecated Use utilities from `@agenta/ui/cell-renderers` instead.
 * This file re-exports for backward compatibility.
 */
import {
    METRIC_PLACEHOLDER,
    isBasicStats,
    formatMetricByKey,
    formatEvaluatorMetricValue,
    format3Sig,
    buildFrequencyChartData,
    type BasicStats,
    type FrequencyEntry,
} from "@agenta/ui/cell-renderers"

export {
    METRIC_PLACEHOLDER,
    isBasicStats,
    formatMetricByKey,
    formatEvaluatorMetricValue,
    format3Sig,
    buildFrequencyChartData,
    type BasicStats,
    type FrequencyEntry,
}

export const formatInvocationMetricValue = (
    metricKey: string,
    stats: BasicStats | undefined,
): string => {
    const specialized = formatMetricByKey(metricKey, stats)
    if (specialized !== METRIC_PLACEHOLDER) return specialized
    return formatEvaluatorMetricValue(stats, metricKey)
}

export const formatPercent = (value: number): string => {
    if (!Number.isFinite(value) || value <= 0) return "0%"
    const percent = value * 100
    if (percent >= 99.95) return "100%"
    if (percent >= 10) return `${percent.toFixed(1)}%`
    return `${percent.toFixed(2)}%`
}

export interface FrequencyEntryLocal {
    label: string
    count: number
}

export const buildFrequencyEntries = (stats: BasicStats | undefined): FrequencyEntryLocal[] => {
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
            (entry: FrequencyEntryLocal | null): entry is FrequencyEntryLocal =>
                entry !== null && entry.label.length > 0,
        )

    if (!entries.length) return []
    return entries.sort((a, b) => b.count - a.count)
}
