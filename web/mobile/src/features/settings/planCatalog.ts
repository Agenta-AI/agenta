import type {BillingPlanOption} from "@agenta/settings-ui"

/** The catalog is passed through unvalidated, so each optional field is checked before use. */
export const isRecommended = (plan: BillingPlanOption) => plan.recommended === true

export const monthlyCredits = (plan: BillingPlanOption): number | null =>
    typeof plan.monthly_credits === "number" &&
    Number.isFinite(plan.monthly_credits) &&
    plan.monthly_credits > 0
        ? plan.monthly_credits
        : null

/** The card's credits line: the catalog's own words, else the monthly grant. */
export const creditsLine = (plan: BillingPlanOption): string | null => {
    if (typeof plan.credits_label === "string" && plan.credits_label.trim())
        return plan.credits_label.trim()
    const monthly = monthlyCredits(plan)
    return monthly ? `${monthly.toLocaleString("en-US")} credits a month` : null
}

/** The shared list from the first entry that carries one. */
export const sharedFeatures = (plans: BillingPlanOption[]): string[] => {
    for (const plan of plans) {
        const list = Array.isArray(plan.shared_features)
            ? plan.shared_features.filter(
                  (feature): feature is string => typeof feature === "string" && feature !== "",
              )
            : []
        if (list.length) return list
    }
    return []
}

/** "Everything in Hobby" leads the list as a heading; the rest are the plan's own lines. */
export const splitLead = (features: string[]): {lead: string | null; items: string[]} =>
    features[0]?.startsWith("Everything in ")
        ? {lead: `${features[0]}, plus:`, items: features.slice(1)}
        : {lead: null, items: features}
