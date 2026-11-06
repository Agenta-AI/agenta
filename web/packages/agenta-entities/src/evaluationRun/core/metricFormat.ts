/**
 * The old app's metric cell text, copied from `@agenta/ui/cell-renderers` (`formatMetricByKey`,
 * `formatEvaluatorMetricValue`) so /m can use it without that barrel, which loads antd.
 *
 * The list cells and the CSV export of the old app both print a metric with these rules, so the two
 * apps print the same text for the same stats.
 *
 * @packageDocumentation
 */

import {formatCurrency, formatLatency} from "@agenta/shared/utils"

import type {MetricFrequency, MetricStats} from "./metricStats"

export const METRIC_PLACEHOLDER = "—"

/** The old app's 3 significant digits: 1234.5 -> "1235", 0.012345 -> "0.0123". */
export function formatMetricNumber(value: number): string {
    if (!Number.isFinite(value)) return String(value)
    const abs = Math.abs(value)
    if (abs === 0) return "0"
    const exponent = Math.floor(Math.log10(abs))
    if (exponent >= 10 || exponent <= -10) return value.toExponential(2)
    return value.toFixed(Math.max(0, 2 - exponent)).replace(/\.?0+$/, "")
}

const meanOf = (stats: MetricStats | null | undefined) => {
    if (!stats) return undefined
    if (stats.mean !== undefined) return stats.mean
    return stats.sum !== undefined && stats.count ? stats.sum / stats.count : undefined
}

const totalOf = (stats: MetricStats | null | undefined) => {
    if (!stats) return undefined
    if (stats.sum !== undefined) return stats.sum
    if (stats.mean !== undefined && stats.count !== undefined) return stats.mean * stats.count
    return stats.count
}

const formatTokenCount = (value: number | undefined) => {
    if (value === undefined || !Number.isFinite(value)) return METRIC_PLACEHOLDER
    if (value < 1_000) return Math.round(value).toLocaleString()
    if (value < 1_000_000) return `${(value / 1_000).toFixed(1)}K`
    return `${(value / 1_000_000).toFixed(1)}M`
}

const dash = (value: string) => (value === "-" ? METRIC_PLACEHOLDER : value)

/** Cost, duration, tokens and errors print by their key; the first matching rule wins. */
const KEY_RULES: {regex: RegExp; format: (stats: MetricStats | null | undefined) => string}[] = [
    {
        regex: /costs?(\.cumulative)?\.total/i,
        format: (stats) => dash(formatCurrency(meanOf(stats) ?? null)),
    },
    {
        regex: /duration/i,
        format: (stats) => {
            const milliseconds = meanOf(stats)
            return dash(formatLatency(milliseconds === undefined ? null : milliseconds / 1_000))
        },
    },
    {regex: /tokens?(\.cumulative)?\.total/i, format: (stats) => formatTokenCount(meanOf(stats))},
    {regex: /tokens\.prompt/i, format: (stats) => formatTokenCount(meanOf(stats))},
    {regex: /tokens\.completion/i, format: (stats) => formatTokenCount(meanOf(stats))},
    {
        regex: /errors?/i,
        format: (stats) => {
            const total = totalOf(stats)
            return total !== undefined && Number.isFinite(total)
                ? Math.round(total).toLocaleString()
                : METRIC_PLACEHOLDER
        },
    },
]

const byCount = (a: MetricFrequency, b: MetricFrequency) =>
    b.count - a.count || (a.value === true ? -1 : 1)

const isMultiCategory = (stats: MetricStats) =>
    typeof stats.type === "string" && stats.type.includes("categorical")

function topCategory(stats: MetricStats): unknown {
    const multiple = isMultiCategory(stats)
    if (stats.frequency?.length) {
        const sorted = [...stats.frequency].sort(byCount)
        return multiple
            ? sorted.map((entry) => entry.value).filter((value) => value !== undefined)
            : sorted[0]?.value
    }
    if (stats.unique?.length) return multiple ? stats.unique : stats.unique[0]
    return undefined
}

/**
 * One metric as cell text. Cost, duration, tokens and errors by key (means, errors as a total);
 * otherwise the mean, the median, the most frequent value (all values, most frequent first, for a
 * categorical metric), else sum over count.
 */
export function formatMetricValue(
    metricKey: string | null | undefined,
    stats: MetricStats | null | undefined,
): string {
    if (metricKey) {
        const rule = KEY_RULES.find((candidate) => candidate.regex.test(metricKey))
        if (rule) {
            const text = rule.format(stats)
            if (text !== METRIC_PLACEHOLDER) return text
        }
    }
    if (!stats) return METRIC_PLACEHOLDER
    if (stats.mean !== undefined) return formatMetricNumber(stats.mean)
    if (stats.median !== undefined) return formatMetricNumber(stats.median)
    const top = topCategory(stats)
    if (top !== undefined && top !== null) {
        return Array.isArray(top) ? top.map((value) => String(value)).join(", ") : String(top)
    }
    if (stats.sum !== undefined && stats.count) return formatMetricNumber(stats.sum / stats.count)
    return METRIC_PLACEHOLDER
}
