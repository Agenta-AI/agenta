import {formatCompactNumber, formatCurrency} from "@agenta/shared/utils"

// Latency values are milliseconds; show ms under a second, seconds above.
export const formatLatency = (ms: number): string => {
    if (!Number.isFinite(ms) || ms <= 0) return "0ms"
    if (ms < 1000) return `${Math.round(ms)}ms`
    return `${(ms / 1000).toFixed(2)}s`
}

export const formatRuns = (value: number): string => formatCompactNumber(value)

export const formatCost = (value: number): string => formatCurrency(value)

export const formatTokens = (value: number): string => formatCompactNumber(value)
