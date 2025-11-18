import {
    buildBooleanHistogram,
    isBooleanMetricStats,
} from "@/oss/components/EvalRunDetails2/utils/metricDistributions"
import {getMetricValueWithAliases} from "@/oss/lib/metricUtils"
import type {BasicStats} from "@/oss/lib/metricUtils"

// import {, isBooleanMetricStats} from "../../../utils/metricDistributions"
import {INVOCATION_METRIC_KEYS, INVOCATION_METRIC_LABELS} from "../constants"

export const format3Sig = (value: number) => {
    if (!Number.isFinite(value)) return String(value)
    const abs = Math.abs(value)
    if (abs !== 0 && (abs < 0.001 || abs >= 1000)) return value.toExponential(2)
    const s = value.toPrecision(3)
    return String(Number(s))
}

export const toBooleanPercentage = (stats: BasicStats | undefined, scenarioCount?: number) => {
    if (!stats || !isBooleanMetricStats(stats)) return null
    const histogram = buildBooleanHistogram(stats, scenarioCount)
    const pct = histogram.percentages.true
    if (!Number.isFinite(pct)) return null
    return pct
}

export const resolveMetricValue = (
    stats: BasicStats | undefined,
    scenarioCount?: number,
): {value: number; formatted: string; type: "boolean" | "numeric"} | null => {
    if (!stats) return null
    if (isBooleanMetricStats(stats)) {
        const histogram = buildBooleanHistogram(stats, scenarioCount)
        const pct = histogram.percentages.true
        if (!Number.isFinite(pct)) return null
        return {value: pct, formatted: `${pct.toFixed(2)}%`, type: "boolean"}
    }
    if (typeof stats.mean === "number") {
        return {value: stats.mean, formatted: format3Sig(stats.mean), type: "numeric"}
    }
    if (typeof stats.median === "number") {
        return {value: stats.median, formatted: format3Sig(stats.median), type: "numeric"}
    }
    if (typeof stats.max === "number") {
        return {value: stats.max, formatted: format3Sig(stats.max), type: "numeric"}
    }
    return null
}

export const collectInvocationFallbackMetrics = (
    statsMap: Record<string, BasicStats | undefined>,
) =>
    INVOCATION_METRIC_KEYS.map((key) => ({
        key,
        label: INVOCATION_METRIC_LABELS[key],
        stats: getMetricValueWithAliases(statsMap, key) as BasicStats | undefined,
    }))
