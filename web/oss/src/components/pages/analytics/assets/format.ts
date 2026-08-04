import {formatCompactNumber, formatCurrency} from "@agenta/shared/utils"

// Latency values are milliseconds; ms under a second, then compact seconds so the
// axis labels stay narrow (one decimal under 10s, whole seconds above).
export const formatLatency = (ms: number): string => {
    // Bare "0" at the origin: the axis climbs into seconds, so "0ms" among "40s"/"80s"
    // reads as a mixed-unit scale.
    if (!Number.isFinite(ms) || ms <= 0) return "0"
    if (ms < 1000) return `${Math.round(ms)}ms`
    const s = ms / 1000
    return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`
}

export const formatRuns = (value: number): string => formatCompactNumber(value)

export const formatCost = (value: number): string => formatCurrency(value)

export const formatTokens = (value: number): string => formatCompactNumber(value)
