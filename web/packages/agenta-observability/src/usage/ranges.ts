import type {UsageRangeKey} from "./types"

export interface UsageRangeOption {
    key: UsageRangeKey
    label: string
    days: number
}

export const USAGE_RANGES: UsageRangeOption[] = [
    {key: "24h", label: "Last 24 hours", days: 1},
    {key: "7d", label: "Last 7 days", days: 7},
    {key: "30d", label: "Last 30 days", days: 30},
    {key: "90d", label: "Last 90 days", days: 90},
]

export const USAGE_RANGE = Object.fromEntries(USAGE_RANGES.map((r) => [r.key, r])) as Record<
    UsageRangeKey,
    UsageRangeOption
>

/** Trace retention per cloud plan (api/ee entitlements). Unknown plans keep every range open. */
const PLAN_RETENTION_DAYS: Record<string, {days: number; name: string}> = {
    cloud_v0_hobby: {days: 7, name: "Hobby"},
    cloud_v0_pro: {days: 30, name: "Pro"},
    cloud_v0_business: {days: 90, name: "Business"},
}

export interface UsageRetention {
    days: number
    planName: string
}

export const planRetention = (plan: string | null | undefined): UsageRetention | null => {
    const entry = plan ? PLAN_RETENTION_DAYS[plan] : undefined
    return entry ? {days: entry.days, planName: entry.name} : null
}

export const isRangeLocked = (range: UsageRangeOption, retention: UsageRetention | null) =>
    Boolean(retention && range.days > retention.days)

/** The widest open range up to 30 days: the page's starting range. */
export const defaultRange = (retention: UsageRetention | null): UsageRangeKey =>
    [...USAGE_RANGES].reverse().find((r) => r.days <= 30 && !isRangeLocked(r, retention))?.key ??
    "24h"
