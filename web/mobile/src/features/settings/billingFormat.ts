import {t} from "@agenta/i18n/billing"
import type {BillingPlanOption, BillingSubscription} from "@agenta/settings-ui"

export const CONTACT_URL = "https://cal.com/mahmoud-mabrouk-ogzgey/demo"

/** The tier out of a plan slug: `cloud_v0_pro` and a bare `pro` both read "pro". */
export const planName = (plan?: string | null) => (plan ? (plan.split("_").pop() ?? plan) : null)

export const planPrice = (plan?: BillingPlanOption | null): string | null => {
    const amount = plan?.price?.base?.amount
    if (amount == null) return null
    if (amount === 0) return t("billing.billingFormat.free")
    return plan?.price?.base?.starting_at
        ? t("billing.billingFormat.fromPerMonth", {amount})
        : t("billing.billingFormat.perMonth", {amount})
}

/** The period boundary the backend sent, absent on plans that never renew. */
export const periodEnd = (subscription?: BillingSubscription | null): Date | null =>
    subscription?.period_end ? new Date(subscription.period_end * 1000) : null
