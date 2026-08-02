import type {HealthBand, HealthScore} from "@/oss/services/tracing/lib/agentAnalytics"

import type {ChartColors} from "../hooks/useChartColors"

export const BAND_LABEL: Record<HealthBand, string> = {
    healthy: "Healthy",
    watch: "Watch",
    "at-risk": "At risk",
    insufficient: "Not enough runs",
}

export interface BandVisual {
    ring: string
    pillBg: string
    pillText: string
}

// Ring color + soft pill tones per band, from theme tokens.
export const bandVisual = (band: HealthBand, colors: ChartColors): BandVisual => {
    switch (band) {
        case "healthy":
            return {ring: colors.healthy, pillBg: colors.successBg, pillText: colors.success}
        case "watch":
            return {ring: colors.watch, pillBg: colors.warningBg, pillText: colors.watch}
        case "at-risk":
            return {ring: colors.atRisk, pillBg: colors.errorBg, pillText: colors.failed}
        default:
            return {ring: colors.neutral, pillBg: colors.neutralBg, pillText: colors.axis}
    }
}

// One-line read-out: success rate plus the direction latency and spend are moving.
export const buildHealthProse = (
    health: HealthScore,
    successPct: string,
    latencyUp: boolean,
    costUp: boolean,
): string => {
    if (!health.hasEnoughRuns) return "Not enough runs yet to assess health — collect more."

    const lead = `${successPct}% of runs succeed`
    if (latencyUp && costUp) return `${lead}, but latency and spend are climbing with volume.`
    if (latencyUp) return `${lead}, though latency is trending up.`
    if (costUp) return `${lead}, though spend is trending up.`
    return `${lead}; latency and spend are holding steady.`
}
