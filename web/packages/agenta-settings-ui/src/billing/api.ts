import {axios, getAgentaApiUrl} from "@agenta/shared/api"

import type {BillingUsage} from "./types"

/**
 * The quota read behind the Usage & Billing page, for a host with no billing layer of its own.
 *
 * Read only, and only this one: the plan card needs the subscription *and* the catalog to say
 * which slug is free, and everything that changes a subscription (checkout, switch, cancel, the
 * Stripe portal) belongs to the host that owns the session it happens in.
 */
export const fetchBillingUsage = async (projectId: string): Promise<BillingUsage> => {
    const {data} = await axios.get(`${getAgentaApiUrl()}/billing/usage`, {
        params: {project_id: projectId},
    })
    return data
}
