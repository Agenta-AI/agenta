import type {ChartDatum, MetricFormatter} from "../types"

/**
 * Transforms the input data into an array of ChartDatum objects for chart rendering.
 * - If `extra.distribution` is an array of numbers, returns them as ChartDatum with indices as names.
 * - If `extra.distribution` is an array of objects, filters and maps them to ChartDatum based on `count` or `value`.
 * - If `extra.percentiles` is an object, converts its entries to ChartDatum.
 * - If `extra.iqrs` is an object, converts its entries to ChartDatum.
 *
 * @param {Record<string, any>} extra - The input data containing distribution, percentiles, or iqrs.
 * @returns {ChartDatum[]} An array of ChartDatum objects for use in charts.
 */
export const buildChartData = (extra: Record<string, any>): ChartDatum[] => {
    // distribution could be array of objects or numbers
    // 1️⃣ Numeric histogram or object counts ------------------------------------
    if (Array.isArray(extra.distribution)) {
        let data: ChartDatum[] = []
        if (extra.distribution.every((d) => typeof d === "number")) {
            // If binSize & min are provided, label bins as ranges e.g. "0–0.1"
            if (typeof extra.binSize === "number" && typeof extra.min === "number") {
                data = extra.distribution.map((v: number, idx: number) => {
                    const minNum = Number(extra.min)
                    const start = minNum + idx * extra.binSize
                    const end = start + extra.binSize
                    return {
                        name: `${format3Sig(start)}–${format3Sig(end)}`,
                        value: v,
                        edge: start, // Changed from end to start
                    }
                })
            } else {
                data = extra.distribution.map((v: number, idx: number) => ({
                    name: String(idx),
                    value: v,
                }))
            }
        } else if (extra.distribution.every((d) => typeof d === "object" && d != null)) {
            if (extra.distribution.every((d: any) => typeof d.value === "number")) {
                // If binSize & min are provided, label bins as ranges e.g. "0–0.1"
                if (typeof extra.binSize === "number" && typeof extra.min === "number") {
                    data = extra.distribution.map((d: any, idx: number) => {
                        const minNum = Number(extra.min)
                        const start = minNum + idx * extra.binSize
                        const end = start + extra.binSize

                        return {
                            name: `${format3Sig(start)}–${format3Sig(end)}`,
                            value: d.count ?? d.value ?? 0,
                            edge: start,
                        }
                    })
                } else {
                    data = extra.distribution.map((d: any) => ({
                        name: String(d.value),
                        value: d.count ?? d.value ?? 0,
                    }))
                }
            } else {
                data = extra.distribution
                    .filter((d: any) => (d.count ?? d.value ?? 0) > 0)
                    .map((d: any, idx: number) => ({
                        name:
                            typeof d.value === "number"
                                ? Number(d.value).toPrecision(3)
                                : String(idx),
                        value: Number(d.count ?? d.value ?? 0),
                    }))
            }
        }
        // If we only have a single point, add a zero baseline to avoid Recharts/decimal.js errors
        if (data.length === 1) {
            data = [{name: "", value: 0}, ...data]
        }
        return data
    }

    // 2️⃣ Categorical metrics: use frequency (all labels) falling back to rank ---
    const catArray = Array.isArray(extra.frequency)
        ? extra.frequency
        : Array.isArray(extra.rank)
          ? extra.rank
          : null
    if (Array.isArray(catArray)) {
        const sorted = [...catArray].sort((a: any, b: any) => (b.count ?? 0) - (a.count ?? 0))
        return sorted.map((d: any) => ({name: String(d.value), value: Number(d.count ?? 0)}))
    }

    // 3️⃣ Percentiles / IQRs ----------------------------------------------------
    if (extra.percentiles && typeof extra.percentiles === "object") {
        return Object.entries(extra.percentiles).map(([k, v]) => ({name: k, value: Number(v)}))
    }
    if (extra.iqrs && typeof extra.iqrs === "object") {
        return Object.entries(extra.iqrs).map(([k, v]) => ({name: k, value: Number(v)}))
    }
    return []
}

/**
 * Registry mapping metric keys (full string match or RegExp string) to a formatter.
 * Extend this map according to your metric naming conventions.
 */
export const METRIC_FORMATTERS: Record<string, MetricFormatter> = {
    // currency-like costs
    cost: {prefix: "$", decimals: 6},
    costs: {prefix: "$", decimals: 6},
    price: {prefix: "$", decimals: 4},
    totalCost: {prefix: "$", decimals: 4},
    "attributes.ag.metrics.costs.cumulative.total": {prefix: "$", decimals: 4},
    // latency
    latency: {decimals: 2, suffix: "s", multiplier: 0.001},
    duration: {decimals: 2, suffix: "s", multiplier: 0.001},
    "duration.total": {decimals: 2, suffix: "s", multiplier: 0.001},
    "attributes.ag.metrics.duration.cumulative": {decimals: 2, suffix: "s", multiplier: 0.001},
    "attributes.ag.metrics.tokens.cumulative.total": {decimals: 0},
    "attributes.ag.metrics.errors.cumulative": {decimals: 0},

    // percentages
    accuracy: {suffix: "%", decimals: 2},
    recall: {suffix: "%", decimals: 2},
    precision: {suffix: "%", decimals: 2},
}

export const format3Sig = (num: number | string): string => {
    if (typeof num !== "number") return String(num)
    if (!Number.isFinite(num)) return String(num)

    const abs = Math.abs(num)
    if (abs === 0) return "0"

    const exponent = Math.floor(Math.log10(abs))

    // Use scientific notation if exponent >= 10 or <= -10
    if (exponent >= 10 || exponent <= -10) {
        return num.toExponential(2)
    }

    // Use fixed-point notation with 3 significant digits
    const decimals = Math.max(0, 2 - exponent)
    const fixed = num.toFixed(decimals)

    // Strip trailing zeros and possible trailing decimal point
    return fixed.replace(/\.?0+$/, "")
}

/**
 * Format a metric value using the mapping above.
 * Falls back to the raw value when the metric has no formatter or value is non-numeric.
 */
export function formatMetricValue(metricKey: string, value: unknown): string {
    if (value == null) {
        return ""
    }

    if (Array.isArray(value)) {
        return value.map((v) => formatMetricValue(metricKey, v)).join(", ")
    }

    if (typeof value === "boolean") {
        return value ? "true" : "false"
    }

    if (typeof value === "object") {
        try {
            return JSON.stringify(value, null, 2)
        } catch (error) {
            return String(value)
        }
    }

    if (typeof value !== "string" && typeof value !== "number") {
        return String(value)
    }

    const fmt = METRIC_FORMATTERS[metricKey] || {
        decimals: 2,
    }

    if (fmt?.format) {
        return fmt.format(value)
    }

    if (typeof value !== "number") {
        const numericValue = Number(value)
        if (Number.isNaN(numericValue)) {
            return String(value)
        }
        const adjusted = fmt.multiplier ? numericValue * fmt.multiplier : numericValue
        const rounded = Number.isFinite(adjusted) ? format3Sig(adjusted) : format3Sig(value)
        return `${fmt.prefix ?? ""}${rounded}${fmt.suffix ?? ""}`
    }

    const adjusted = fmt.multiplier ? value * fmt.multiplier : value
    const rounded = Number.isFinite(adjusted) ? format3Sig(adjusted) : format3Sig(value)
    return `${fmt.prefix ?? ""}${rounded}${fmt.suffix ?? ""}`
}
