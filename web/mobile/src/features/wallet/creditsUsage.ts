import {
    OTHER_KEY,
    rankKeys,
    sum,
    topSeries,
    type KeyedSeries,
} from "@agenta/observability/analytics"
import {analyticsColor, SERIES_COLORS, type TimeSeries} from "@agenta/observability-ui/analytics"

import type {WalletUsage, WalletUsageSession} from "./walletApi"
import {MUSD_PER_CREDIT} from "./walletFormat"

export const CREDITS_USAGE_RANGES = [7, 30, 90] as const
export type CreditsUsageRange = (typeof CREDITS_USAGE_RANGES)[number]

export type CreditsUsageGroup = "none" | "category" | "agent" | "user" | "session"

const sessionId = (session: WalletUsageSession) =>
    session.session_id ? `#${session.session_id.slice(0, 4)}` : "No session"

/** What each group-by reads: the day totals per category, or every charge keyed by its session. */
const GROUPS: Record<
    CreditsUsageGroup,
    {label: string; from: "days" | "charges"; key?: (session: WalletUsageSession) => string}
> = {
    none: {label: "None (per day)", from: "days"},
    category: {label: "Category", from: "days"},
    agent: {
        label: "Agent",
        from: "charges",
        key: (s) => s.agent_name ?? s.agent_id ?? "No agent",
    },
    user: {
        label: "User",
        from: "charges",
        key: (s) => s.user_email ?? s.user_id ?? "Automations (no user)",
    },
    session: {
        label: "Session",
        from: "charges",
        key: (s) => (s.agent_name ? `${s.agent_name} · ${sessionId(s)}` : sessionId(s)),
    },
}

export const CREDITS_USAGE_GROUPS = (Object.keys(GROUPS) as CreditsUsageGroup[]).map((key) => ({
    value: key,
    label: GROUPS[key].label,
}))

export const groupLabel = (group: CreditsUsageGroup) => GROUPS[group].label

/** The range's UTC days, oldest first, ending today. */
export const rangeDays = (range: number, now = Date.now()): string[] =>
    Array.from({length: range}, (_, i) =>
        new Date(now - (range - 1 - i) * 86_400_000).toISOString().slice(0, 10),
    )

const TOP = 4

export interface CreditsUsageChart {
    days: string[]
    /** Credits per day, every group together. */
    total: number[]
    series: TimeSeries[]
    /** Whether the group reads charges the API cut off at its limit. */
    partial: boolean
}

/** Credits per day for the range, split by the group: its top four keys, then "Other". */
export const creditsUsageChart = (
    usage: WalletUsage,
    group: CreditsUsageGroup,
    days: string[],
): CreditsUsageChart => {
    const index = new Map(days.map((day, i) => [day, i]))
    const keyed: KeyedSeries = {}
    const add = (key: string, day: string, musd: number) => {
        const i = index.get(day)
        if (i === undefined) return
        keyed[key] ??= days.map(() => 0)
        keyed[key][i] += musd / MUSD_PER_CREDIT
    }

    const total = days.map(() => 0)
    for (const entry of usage.days) {
        const i = index.get(entry.day)
        if (i !== undefined) total[i] += entry.amount_musd / MUSD_PER_CREDIT
    }

    const spec = GROUPS[group]
    if (group === "none") keyed.used = total
    else if (spec.from === "days") for (const d of usage.days) add(d.category, d.day, d.amount_musd)
    else
        for (const session of usage.sessions)
            for (const charge of session.charges)
                add(spec.key!(session), charge.created_at.slice(0, 10), charge.amount_musd)

    const order = rankKeys(keyed)
    const restCount = Math.max(0, order.length - TOP)
    const series = topSeries(keyed, order, TOP, total).map((s, i) => ({
        key: s.key,
        label:
            s.key === OTHER_KEY
                ? restCount
                    ? `Other (${restCount})`
                    : "Unattributed"
                : group === "none"
                  ? "Credits used"
                  : s.key,
        color: analyticsColor(s.key === OTHER_KEY ? "other" : SERIES_COLORS[i]),
        values: s.values,
    }))

    return {days, total, series, partial: spec.from === "charges" && usage.truncated}
}

export const seriesTotal = (series: TimeSeries) => sum(series.values.map((v) => v ?? 0))
