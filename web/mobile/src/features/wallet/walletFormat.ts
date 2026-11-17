import {formatLocale, formatNumber, type CatalogKey, type TranslationValues} from "@agenta/i18n"
import type walletCreditsCatalog from "@agenta/i18n/catalogs/wallet.credits"
import type {AnalyticsColor} from "@agenta/observability-ui/analytics"

const MUSD_PER_USD = 1_000_000
/** 1 credit = 1 US cent. */
export const MUSD_PER_CREDIT = 10_000

/** Dollars to the cent: "$19.98". */
export const formatUsd = (musd: number): string =>
    `$${formatNumber(musd / MUSD_PER_USD, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`

/** Credits, the unit people see: "1,234.5". */
export const formatCredits = (musd: number): string =>
    formatNumber(musd / MUSD_PER_CREDIT, {maximumFractionDigits: 1})

/** A `t` that holds the credits catalog. */
export type CreditsT = (
    key: CatalogKey<typeof walletCreditsCatalog>,
    values?: TranslationValues,
) => string

/** How each credit kind reads on its tile: a short name, its chart color, and when it runs out. */
interface CreditKind {
    label: string
    color: AnalyticsColor
    lasts: (endTime: string | null) => string
}

type CreditsKey = CatalogKey<typeof walletCreditsCatalog>

/** The kinds this view knows: the key of each name and its chart color. */
const CREDIT_KINDS: Record<string, {label: CreditsKey; color: AnalyticsColor}> = {
    plan_allowance: {label: "wallet.credits.kindMonthly", color: "series4"},
    daily_free: {label: "wallet.credits.kindDailyFree", color: "series3"},
    signup_grant: {label: "wallet.credits.kindSignupBonus", color: "series1"},
    starter_credits: {label: "wallet.credits.kindStarterCredits", color: "series5"},
    purchase: {label: "wallet.credits.purchased", color: "series2"},
    promotion: {label: "wallet.credits.kindPromotion", color: "success"},
    referral_bonus: {label: "wallet.credits.kindReferralBonus", color: "series5"},
    contribution_award: {label: "wallet.credits.kindContributionAward", color: "series3"},
    goodwill: {label: "wallet.credits.kindGoodwill", color: "series1"},
    correction: {label: "wallet.credits.kindCorrection", color: "other"},
}

/** A kind this view does not know reads as its own words, colored as "other". */
export const creditKind = (kind: string, t: CreditsT): CreditKind => {
    const until = (endTime: string | null) =>
        endTime
            ? t("wallet.credits.validUntil", {date: formatDate(endTime)})
            : t("wallet.credits.noExpiry")
    const known = Object.hasOwn(CREDIT_KINDS, kind) ? CREDIT_KINDS[kind] : undefined
    if (!known) {
        const words = kind.replace(/_/g, " ").trim()
        return {
            label: words
                ? words[0].toUpperCase() + words.slice(1)
                : t("wallet.credits.kindFallback"),
            color: "other",
            lasts: until,
        }
    }
    const label = t(known.label)
    if (kind === "plan_allowance") {
        return {
            label,
            color: known.color,
            lasts: (end) =>
                end ? t("wallet.credits.resets", {date: formatDate(end)}) : t(known.label),
        }
    }
    if (kind === "daily_free") {
        return {label, color: known.color, lasts: () => t("wallet.credits.resetsDaily")}
    }
    return {label, color: known.color, lasts: until}
}

export const formatDate = (iso: string): string =>
    new Date(iso).toLocaleDateString(formatLocale(), {
        year: "numeric",
        month: "short",
        day: "numeric",
        // Days and expiries are UTC boundaries; a local zone would show the day before.
        timeZone: "UTC",
    })
