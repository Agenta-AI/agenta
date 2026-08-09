/**
 * Billing view types.
 *
 * Structural mirrors of the billing API's shapes, declared here so the pages stay standalone —
 * a host passes its own `SubscriptionType` / `DataUsageType` / `BillingPlan` unchanged.
 */

export interface BillingSubscription {
    /** Plan slug. Dynamic at runtime (env-overridable), so never branch on equality with a literal. */
    plan: string
    period_start: number
    period_end: number
    free_trial: boolean
}

/** `null` period means non-periodic (a gauge rather than a window). */
export type BillingUsagePeriod = "yearly" | "monthly" | "daily" | null

export type BillingUsageScope = "organization" | "workspace" | "project" | "user"

export interface BillingUsageMetric {
    value: number
    /** `null` is unlimited. */
    limit: number | null
    free: number
    period?: BillingUsagePeriod
    scope?: BillingUsageScope
    strict: boolean
}

export type BillingUsage = Record<string, BillingUsageMetric | undefined>

export interface BillingPlanPrice {
    base?: {
        amount: number
        currency: string
        starting_at?: boolean
    }
}

export interface BillingPlanOption {
    title: string
    description: string
    price?: BillingPlanPrice
    features: string[]
    plan: string
    /** `custom` is a contact-sales plan — no self-serve switching in or out of it. */
    type?: "standard" | "custom"
}
