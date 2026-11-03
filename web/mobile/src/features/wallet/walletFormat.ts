import type {AnalyticsColor} from "@agenta/observability-ui/analytics"

const MUSD_PER_USD = 1_000_000
/** 1 credit = 1 US cent. */
export const MUSD_PER_CREDIT = 10_000

/** Dollars to the cent: "$19.98". */
export const formatUsd = (musd: number): string =>
    `$${(musd / MUSD_PER_USD).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`

/** Credits, the unit people see: "1,234.5". */
export const formatCredits = (musd: number): string =>
    (musd / MUSD_PER_CREDIT).toLocaleString(undefined, {maximumFractionDigits: 1})

/** How each credit kind reads on its tile: a short name, its chart color, and when it runs out. */
interface CreditKind {
    label: string
    color: AnalyticsColor
    lasts: (endTime: string | null) => string
}

const until = (endTime: string | null) =>
    endTime ? `Valid until ${formatDate(endTime)}` : "No expiry"

const CREDIT_KINDS: Record<string, CreditKind> = {
    plan_allowance: {
        label: "Monthly",
        color: "series4",
        lasts: (end) => (end ? `Resets ${formatDate(end)}` : "Monthly"),
    },
    daily_free: {label: "Daily free", color: "series3", lasts: () => "Resets daily"},
    signup_grant: {label: "Signup bonus", color: "series1", lasts: until},
    starter_credits: {label: "Starter credits", color: "series5", lasts: until},
    purchase: {label: "Purchased", color: "series2", lasts: until},
    promotion: {label: "Promotion", color: "success", lasts: until},
    referral_bonus: {label: "Referral bonus", color: "series5", lasts: until},
    contribution_award: {label: "Contribution award", color: "series3", lasts: until},
    goodwill: {label: "Goodwill", color: "series1", lasts: until},
    correction: {label: "Correction", color: "other", lasts: until},
}

/** A kind this view does not know reads as its own words, colored as "other". */
export const creditKind = (kind: string): CreditKind => {
    const known = CREDIT_KINDS[kind]
    if (known) return known
    const words = kind.replace(/_/g, " ").trim()
    return {
        label: words ? words[0].toUpperCase() + words.slice(1) : "Credits",
        color: "other",
        lasts: until,
    }
}

export const formatDate = (iso: string): string =>
    new Date(iso).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        // Days and expiries are UTC boundaries; a local zone would show the day before.
        timeZone: "UTC",
    })
