/**
 * The billing endpoints the Usage & Billing page needs, for a host with no billing layer of
 * its own. The desktop reaches the same routes through its own jotai atoms.
 */

import {axios, getAgentaApiUrl} from "@agenta/shared/api"

import type {BillingPlanOption, BillingUsage} from "./types"

/** Per-quota consumption for the current period. */
export const fetchBillingUsage = async (projectId: string): Promise<BillingUsage> => {
    const {data} = await axios.get(`${getAgentaApiUrl()}/billing/usage`, {
        params: {project_id: projectId},
    })
    return data
}

/** The plans on offer — what the plan chooser lists. */
export const fetchBillingPlans = async (projectId: string): Promise<BillingPlanOption[]> => {
    const {data} = await axios.get(`${getAgentaApiUrl()}/billing/plans`, {
        params: {project_id: projectId},
    })
    return Array.isArray(data) ? data : []
}

/** Per-slug pricing metadata. Only read here for which slug is the free tier. */
export const fetchBillingPricing = async (): Promise<
    Record<string, {free?: boolean; trial?: number} | undefined>
> => {
    const {data} = await axios.get(`${getAgentaApiUrl()}/billing/pricing`)
    return data ?? {}
}

/** Paid → paid. Switching to the free tier goes through cancellation instead. */
export const switchBillingPlan = async ({
    plan,
    projectId,
}: {
    plan: string
    projectId: string
}): Promise<void> => {
    await axios.post(`${getAgentaApiUrl()}/billing/plans/switch`, null, {
        params: {plan, project_id: projectId},
    })
}

/** Ends auto-renewal; the plan reverts to the free tier at the period boundary. */
export const cancelBillingSubscription = async (projectId: string): Promise<void> => {
    await axios.post(`${getAgentaApiUrl()}/billing/subscription/cancel`, null, {
        params: {project_id: projectId},
    })
}

/** Free (or no subscription) → paid. Returns the Stripe Checkout URL to send the payer to. */
export const checkoutBillingSubscription = async ({
    plan,
    successUrl,
}: {
    plan: string
    successUrl: string
}): Promise<string | null> => {
    const {data} = await axios.post(`${getAgentaApiUrl()}/billing/stripe/checkouts/`, null, {
        params: {plan, success_url: successUrl},
    })
    return data?.checkout_url ?? null
}

/** Returns the Stripe customer-portal URL — invoices, payment methods, cancellation. */
export const openBillingPortal = async (): Promise<string | null> => {
    const {data} = await axios.post(`${getAgentaApiUrl()}/billing/stripe/portals/`)
    return data?.portal_url ?? null
}
