import {canonicalizeMetricKey, getMetricDisplayName} from "@/oss/lib/metricUtils"

const UPPERCASE_TOKENS = new Set(["json", "csv", "xml", "html", "id", "llm", "api", "url"])

const humanizeWord = (raw: string) => {
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
