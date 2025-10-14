export type Plan = "cloud_v0_hobby" | "cloud_v0_pro" | "cloud_v0_business" | "cloud_v0_enterprise"

export interface SubscriptionType {
    plan: Plan
    period_start: number
    period_end: number
    free_trial: boolean
}

interface UsageKeyType {
    value: number
    limit: number | null
    free: number
    monthly: boolean
    strict: boolean
}

export interface DataUsageType {
    traces: UsageKeyType
    users: UsageKeyType
    prompts: UsageKeyType
    jobs: UsageKeyType
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
