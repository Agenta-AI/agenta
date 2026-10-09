import type {BillingPlanOption, BillingSubscription} from "@agenta/settings-ui"

/** The tier out of a plan slug: `cloud_v0_pro` and a bare `pro` both read "pro". */
export const planName = (plan?: string | null) => (plan ? (plan.split("_").pop() ?? plan) : null)

export const planPrice = (plan?: BillingPlanOption | null): string | null => {
    const amount = plan?.price?.base?.amount
    if (amount == null) return null
    return amount === 0
        ? "Free"
        : `${plan?.price?.base?.starting_at ? "From " : ""}$${amount} / month`
}

/** The period boundary the backend sent, absent on plans that never renew. */
export const periodEnd = (subscription?: BillingSubscription | null): Date | null =>
    subscription?.period_end ? new Date(subscription.period_end * 1000) : null

export const formatDay = (date: Date) =>
    date.toLocaleDateString("en-US", {month: "short", day: "numeric", year: "numeric"})
