/**
 * The plan catalog, and the two facts the page derives from it: whether the organization is on
 * the free tier, and whether it is on a contact-sales plan.
 *
 * Both need the catalog, not just the subscription — the free tier is whichever slug the
 * pricing map marks `free`, and slugs are env-overridable, so neither can be guessed.
 */

import {useQuery} from "@tanstack/react-query"

import {fetchBillingPlans, fetchBillingPricing} from "./api"
import type {BillingPlanOption} from "./types"

export interface BillingCatalog {
    plans: BillingPlanOption[]
    /** The free tier's slug, or null when the pricing map names none. */
    freePlanSlug: string | null
    isOnFreePlan: boolean
    /** Contact-sales: no self-serve switching in or out of it. */
    isCustomPlan: boolean
    isLoading: boolean
}

export interface UseBillingCatalogParams {
    projectId?: string | null
    /** The organization's current plan slug — what free/custom are judged against. */
    currentPlan?: string | null
    enabled?: boolean
}

export const useBillingCatalog = ({
    projectId,
    currentPlan,
    enabled = true,
}: UseBillingCatalogParams): BillingCatalog => {
    const canQuery = enabled && Boolean(projectId)

    const plans = useQuery({
        queryKey: ["billing", "plans", projectId],
        queryFn: () => fetchBillingPlans(projectId as string),
        staleTime: 1000 * 60 * 10,
        refetchOnWindowFocus: false,
        enabled: canQuery,
    })

    const pricing = useQuery({
        queryKey: ["billing", "pricing"],
        queryFn: fetchBillingPricing,
        staleTime: 1000 * 60 * 10,
        refetchOnWindowFocus: false,
        enabled: canQuery,
    })

    const freePlanSlug =
        Object.entries(pricing.data ?? {}).find(([, entry]) => entry?.free)?.[0] ?? null

    return {
        plans: plans.data ?? [],
        freePlanSlug,
        isOnFreePlan: Boolean(currentPlan && freePlanSlug && currentPlan === freePlanSlug),
        isCustomPlan:
            (plans.data ?? []).find((plan) => plan.plan === currentPlan)?.type === "custom",
        isLoading:
            (plans.isPending && plans.fetchStatus !== "idle") ||
            (pricing.isPending && pricing.fetchStatus !== "idle"),
    }
}
