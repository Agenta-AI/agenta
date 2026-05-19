interface UsedMetric {
    limit: number
    used: number
}
export interface UsageProgressBarProps {
    label: string
    isUnlimited?: boolean
    strict?: boolean
    limit: number
    used: number
    free: number
    /** "yearly" | "monthly" | "daily" | null — null means non-periodic (gauge). */
    period?: "yearly" | "monthly" | "daily" | null
    /** "organization" | "workspace" | "project" | "user". */
    scope?: "organization" | "workspace" | "project" | "user"
}
