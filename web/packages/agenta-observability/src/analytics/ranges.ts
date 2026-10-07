import type {AnalyticsRangeKey} from "./types"

export interface AnalyticsRangeOption {
    key: AnalyticsRangeKey
    label: string
    days: number
}

export const ANALYTICS_RANGES: AnalyticsRangeOption[] = [
    {key: "24h", label: "Last 24 hours", days: 1},
    {key: "7d", label: "Last 7 days", days: 7},
    {key: "30d", label: "Last 30 days", days: 30},
    {key: "90d", label: "Last 90 days", days: 90},
]

export const ANALYTICS_RANGE = Object.fromEntries(
    ANALYTICS_RANGES.map((r) => [r.key, r]),
) as Record<AnalyticsRangeKey, AnalyticsRangeOption>

/** Trace retention per cloud plan (api/ee entitlements). Unknown plans keep every range open. */
const PLAN_RETENTION_DAYS: Record<string, {days: number; name: string}> = {
    cloud_v0_hobby: {days: 7, name: "Hobby"},
    cloud_v0_pro: {days: 30, name: "Pro"},
    cloud_v0_business: {days: 90, name: "Business"},
}

export interface AnalyticsRetention {
    days: number
    planName: string
}

export const planRetention = (plan: string | null | undefined): AnalyticsRetention | null => {
    const entry = plan ? PLAN_RETENTION_DAYS[plan] : undefined
    return entry ? {days: entry.days, planName: entry.name} : null
}

export const isRangeLocked = (range: AnalyticsRangeOption, retention: AnalyticsRetention | null) =>
    Boolean(retention && range.days > retention.days)

/** The widest open range up to 7 days: the page's starting range. */
export const defaultRange = (retention: AnalyticsRetention | null): AnalyticsRangeKey =>
    [...ANALYTICS_RANGES].reverse().find((r) => r.days <= 7 && !isRangeLocked(r, retention))?.key ??
    "24h"
