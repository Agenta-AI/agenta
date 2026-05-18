// Plan slugs are dynamic at runtime (env-overridable via AGENTA_ACCESS_PLANS).
// API responses carry plain strings; the `DefaultPlan` enum in `@/oss/lib/Types`
// holds the known default slug constants for use in conditional checks.
export type Plan = string

export interface SubscriptionType {
    plan: Plan
    period_start: number
    period_end: number
    free_trial: boolean
}

export type UsagePeriod = "yearly" | "monthly" | "daily" | null
export type UsageScope = "organization" | "workspace" | "project" | "user"

export interface UsageKeyType {
    value: number
    limit: number | null
    free: number
    period?: UsagePeriod
    scope?: UsageScope
    strict: boolean
}

export interface DataUsageType {
    traces_ingested?: UsageKeyType
    traces_retrieved?: UsageKeyType
    credits_consumed?: UsageKeyType
    users?: UsageKeyType
    [key: string]: UsageKeyType | undefined
}

interface PriceInfo {
    base?: {
        amount: number
        currency: string
        starting_at?: boolean
    }
    users?: {
        tiers: {limit?: number; amount: number; rate?: number}[]
    }
    traces?: {
        tiers: {limit?: number; amount: number; rate?: number}[]
    }
}

export interface BillingPlan {
    title: string
    description: string
    price?: PriceInfo
    features: string[]
    plan: Plan
}
