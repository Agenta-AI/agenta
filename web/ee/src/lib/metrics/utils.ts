// Shared helpers for metric key humanisation and sorting
// ------------------------------------------------------
// This centralises the logic used in various tables (virtualised scenario table,
// human-evaluation runs table, etc.) so we have a single source of truth when we
// add new invocation-level metrics.

export interface MetricConfig {
    /** Which field in BasicStats to use when sorting / displaying primary value */
    primary: string
    /** Human-readable column title */
    label: string
}

const TOKEN_ORDER = ["promptTokens", "completionTokens", "totalTokens"] as const

/**
 * Given a flattened invocation metric key (e.g. "latency", "totalCost",
 * "duration.total", "promptTokens" …) return:
 *   1. primary aggregation key to read from BasicStats
 *   2. human-friendly title string used for column headers
 */
export const getMetricConfig = (key: string): MetricConfig => {
    // Common most-used names first for performance/readability
    if (key === "latency") {
        return {primary: "mean", label: "Latency (mean)"}
    }
    if (key === "totalCost" || key === "cost") {
        return {primary: "sum", label: "Cost (total)"}
    }

    // Token counts (camelCase like promptTokens -> "Prompt tokens (total)")
    if (key.endsWith("Tokens")) {
        const words = key
            .replace(/Tokens$/, " tokens")
            .replace(/([A-Z])/g, " $1")
            .trim()
        const capitalised = words.charAt(0).toUpperCase() + words.slice(1)
        return {primary: "sum", label: `${capitalised} (total)`}
    }

    // Dotted keys from step summariser e.g. duration.total => Duration (total)
    if (key.includes(".")) {
        const [base, sub] = key.split(".")
        const capitalised = base.charAt(0).toUpperCase() + base.slice(1)
        const primary = sub === "total" ? "sum" : sub
        return {primary, label: `${capitalised} (${sub})`}
    }

    // Fallback – treat as numeric mean
    const capitalised = key.charAt(0).toUpperCase() + key.slice(1)
    const primary = key === "errors" ? "count" : "mean"
    return {primary, label: `${capitalised} (${primary})`}
}

/**
 * Provide a stable sort priority for invocation metric keys so that tables show
 * them in a predictable order:
 *   0. cost
 *   1. duration.*
 *   2. token metrics (prompt, completion, total, then any other token key)
 *   3. others alphabetical
 */
export const metricPriority = (key: string): [number, number] => {
    const lc = key.toLowerCase()
    if (lc.includes("cost")) return [0, 0]
    if (lc.includes("duration")) return [1, 0]
    const tokenIdx = TOKEN_ORDER.indexOf(key as (typeof TOKEN_ORDER)[number])
    if (tokenIdx !== -1) return [2, tokenIdx]
    if (key.endsWith("Tokens") || lc.includes("token")) return [2, 99]
    return [3, 0]
}
