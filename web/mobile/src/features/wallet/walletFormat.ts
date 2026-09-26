const MUSD_PER_USD = 1_000_000

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
