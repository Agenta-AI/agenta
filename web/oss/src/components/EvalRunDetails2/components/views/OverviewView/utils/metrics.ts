import {
    buildBooleanHistogram,
    isBooleanMetricStats,
} from "@/oss/components/EvalRunDetails2/utils/metricDistributions"
import {
    canonicalizeMetricKey,
    getMetricDisplayName,
    getMetricValueWithAliases,
} from "@/oss/lib/metricUtils"
import type {BasicStats} from "@/oss/lib/metricUtils"

// import {, isBooleanMetricStats} from "../../../utils/metricDistributions"
import {INVOCATION_METRIC_KEYS, INVOCATION_METRIC_LABELS} from "../constants"

const UPPERCASE_TOKENS = new Set(["json", "csv", "xml", "html", "id", "llm", "api", "url"])

export const format3Sig = (value: number) => {
    if (!Number.isFinite(value)) return String(value)
    const abs = Math.abs(value)
    if (abs !== 0 && (abs < 0.001 || abs >= 1000)) return value.toExponential(2)
    const s = value.toPrecision(3)
    return String(Number(s))
}

export const humanizeWord = (raw: string) => {
    const lower = raw.toLowerCase()
    if (UPPERCASE_TOKENS.has(lower)) return lower.toUpperCase()
    if (lower === "outputs") return "Output"
    if (lower === "inputs") return "Input"
    if (lower === "success") return "Success"
    if (lower === "contains") return "Contains"
    return lower.charAt(0).toUpperCase() + lower.slice(1)
}

export const humanizeMetricPath = (metricPath: string) => {
    const canonical = canonicalizeMetricKey(metricPath)
    if (canonical.startsWith("attributes.ag.metrics.")) {
        return getMetricDisplayName(canonical)
    }

    const trimmed = canonical
        .replace(/^attributes\.ag\.data\.outputs\./, "")
        .replace(/^attributes\.ag\.data\./, "")
        .replace(/^attributes\.ag\./, "")
        .replace(/^attributes\./, "")

    const segments = trimmed
        .split(".")
        .map((segment) => segment.replace(/[-_]/g, " ").trim())
        .filter(Boolean)

    if (segments.length === 0) {
        return getMetricDisplayName(canonical)
    }

    const focusSegments = segments.length > 2 ? segments.slice(-2) : segments
    const words = focusSegments.join(" ").split(/\s+/).filter(Boolean).map(humanizeWord)

    return words.join(" ")
}

export const humanizeEvaluatorName = (label: string) =>
    label
        .split(/[\s_-]+/)
        .filter(Boolean)
        .map(humanizeWord)
        .join(" ")

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
