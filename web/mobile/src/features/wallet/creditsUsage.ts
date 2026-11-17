import type {CatalogKey, TranslationValues} from "@agenta/i18n"
import type walletUsageCatalog from "@agenta/i18n/catalogs/wallet.usage"
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

/** A `t` that holds the usage catalog. */
export type UsageT = (
    key: CatalogKey<typeof walletUsageCatalog>,
    values?: TranslationValues,
) => string

/**
 * The keys that stand for "nothing there" in a group. They name a series, so they stay these
 * words in every language; the chart shows them through `seriesLabel`.
 */
const NO_SESSION = "No session"
const NO_AGENT = "No agent"
const NO_USER = "Automations (no user)"

const sessionId = (session: WalletUsageSession) =>
    session.session_id ? `#${session.session_id.slice(0, 4)}` : NO_SESSION

/** What each group-by reads: the day totals per category, or every charge keyed by its session. */
const GROUPS: Record<
    CreditsUsageGroup,
    {
        label: CatalogKey<typeof walletUsageCatalog>
        from: "days" | "charges"
        key?: (session: WalletUsageSession) => string
    }
> = {
    none: {label: "wallet.usage.groupNone", from: "days"},
    category: {label: "wallet.usage.groupCategory", from: "days"},
    agent: {
        label: "wallet.usage.groupAgent",
        from: "charges",
        key: (s) => s.agent_name ?? s.agent_id ?? NO_AGENT,
    },
    user: {
        label: "wallet.usage.groupUser",
        from: "charges",
        key: (s) => s.user_email ?? s.user_id ?? NO_USER,
    },
    session: {
        label: "wallet.usage.groupSession",
        from: "charges",
        key: (s) => (s.agent_name ? `${s.agent_name} · ${sessionId(s)}` : sessionId(s)),
    },
}

export const creditsUsageGroups = (t: UsageT) =>
    (Object.keys(GROUPS) as CreditsUsageGroup[]).map((key) => ({
        value: key,
        label: t(GROUPS[key].label),
    }))

export const groupLabel = (group: CreditsUsageGroup, t: UsageT) => t(GROUPS[group].label)

/** What a series reads as: the "nothing there" keys are translated, every other key is data. */
const seriesLabel = (key: string, group: CreditsUsageGroup, t: UsageT) => {
    if (group === "none") return t("wallet.usage.creditsUsed")
    if (group === "agent" && key === NO_AGENT) return t("wallet.usage.noAgent")
    if (group === "user" && key === NO_USER) return t("wallet.usage.noUser")
    if (group === "session" && key === NO_SESSION) return t("wallet.usage.noSession")
    return key
}

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
    t: UsageT,
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
                    ? t("wallet.usage.otherSeries", {count: restCount})
                    : t("wallet.usage.unattributed")
                : seriesLabel(s.key, group, t),
        color: analyticsColor(s.key === OTHER_KEY ? "other" : SERIES_COLORS[i]),
        values: s.values,
    }))

    return {days, total, series, partial: spec.from === "charges" && usage.truncated}
}

export const seriesTotal = (series: TimeSeries) => sum(series.values.map((v) => v ?? 0))
