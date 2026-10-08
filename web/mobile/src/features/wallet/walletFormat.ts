const MUSD_PER_USD = 1_000_000
/** 1 credit = 1 US cent. */
const MUSD_PER_CREDIT = 10_000

/** Compact dollars for the sidebar: "$19.98". */
export const formatUsd = (musd: number): string =>
    `$${(musd / MUSD_PER_USD).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`

/** Exact dollars for the debug view: every micro-dollar shown, "$0.003037". */
export const formatUsdExact = (musd: number): string =>
    `$${(musd / MUSD_PER_USD).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 6,
    })}`

export const formatMusd = (musd: number | null | undefined): string =>
    musd === null || musd === undefined ? "—" : `${musd.toLocaleString()} musd`

export const formatCount = (value: number | null | undefined): string =>
    value === null || value === undefined ? "—" : value.toLocaleString()

export const formatDateTime = (iso: string | null | undefined): string =>
    iso ? new Date(iso).toLocaleString() : "—"

/** A sandbox interval's time and size: "60 s · 2 vCPU · 4 GiB". */
export const formatSandbox = (
    seconds: number | null | undefined,
    vcpu: number | null | undefined,
    memoryGib: number | null | undefined,
): string =>
    seconds === null || seconds === undefined
        ? "—"
        : `${seconds.toLocaleString()} s · ${vcpu ?? "?"} vCPU · ${memoryGib ?? "?"} GiB`

/** A tool action's billable count: "3 results", "1 call". */
export const formatUnits = (
    quantity: number | null | undefined,
    unit: string | null | undefined,
): string => {
    if (quantity === null || quantity === undefined || !unit) return "—"
    const singular = unit.endsWith("s") ? unit.slice(0, -1) : unit
    return `${quantity.toLocaleString()} ${quantity === 1 ? singular : unit}`
}

/** Credits, the unit people see: "1,234.5". */
export const formatCredits = (musd: number): string =>
    (musd / MUSD_PER_CREDIT).toLocaleString(undefined, {maximumFractionDigits: 1})

const CREDIT_KIND_LABELS: Record<string, string> = {
    signup_grant: "Signup bonus",
    daily_free: "Daily free credits",
    plan_allowance: "Monthly plan credits",
    purchase: "Purchased credits",
    starter_credits: "Starter credits",
}

/** A credit's kind in plain words; a kind this view does not know reads as its own words. */
export const creditKindLabel = (kind: string): string => {
    const known = CREDIT_KIND_LABELS[kind]
    if (known) return known
    const words = kind.replace(/_/g, " ").trim()
    return words ? words[0].toUpperCase() + words.slice(1) : "Credits"
}

export const formatDate = (iso: string): string =>
    new Date(iso).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        // Days and expiries are UTC boundaries; a local zone would show the day before.
        timeZone: "UTC",
    })
