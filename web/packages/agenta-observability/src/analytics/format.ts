import type {AnalyticsMetric} from "./types"

const grouped = (value: number, digits = 0) =>
    value.toLocaleString("en-US", {minimumFractionDigits: digits, maximumFractionDigits: digits})

export const formatMoney = (value: number | null | undefined) => {
    if (value == null) return "—"
    if (value >= 1000) return `$${grouped(value)}`
    if (value >= 10) return `$${grouped(value, 2)}`
    if (value >= 1) return `$${value.toFixed(2)}`
    return `$${value.toFixed(3)}`
}

export const formatCompact = (value: number) => {
    const abs = Math.abs(value)
    const short = (n: number, unit: string) => `${n.toFixed(1).replace(/\.0$/, "")}${unit}`
    if (abs >= 1e9) return short(value / 1e9, "B")
    if (abs >= 1e6) return short(value / 1e6, "M")
    if (abs >= 1e3) return short(value / 1e3, "k")
    return Number.isInteger(value) ? String(value) : short(value, "")
}

export const formatCount = (value: number) => grouped(Math.round(value))

/** `short` is for axis ticks and chart labels. */
export const formatMetric = (
    metric: AnalyticsMetric | "failrate",
    value: number | null | undefined,
    short = false,
) => {
    if (value == null || Number.isNaN(value)) return "—"
    switch (metric) {
        case "cost":
            if (!short) return formatMoney(value)
            if (value >= 1000) return `$${formatCompact(value)}`
            if (value >= 10) return `$${Math.round(value)}`
            return value >= 1 ? `$${value.toFixed(1)}` : `$${value.toFixed(2)}`
        case "avgcost":
            return `$${value.toFixed(short ? 2 : 3)}`
        case "success":
        case "failrate":
            return `${value.toFixed(short ? 0 : 1)}%`
        case "tokens":
            return formatCompact(value)
        default:
            return short ? formatCompact(value) : formatCount(value)
    }
}

export const sharePercent = (part: number, total: number) =>
    total ? `${Math.round((part / total) * 100)}%` : ""

/** A tick ceiling of 1, 2, 2.5 or 5 times a power of ten. */
export const niceMax = (value: number) => {
    if (!(value > 0)) return 1
    const exp = Math.pow(10, Math.floor(Math.log10(value)))
    const f = value / exp
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp
}
