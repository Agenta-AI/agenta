// Re-export the new atom-based billing hooks and actions
export {
    useUsageData,
    useSubscriptionData,
    usePricingPlans,
    useSubscriptionActions,
    useBilling,
} from "../../state/billing"

// Legacy function exports for backward compatibility
// These now use direct API calls for backward compatibility
import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {getProjectValues} from "@/oss/state/project"

/**
 * @deprecated Use useSubscriptionActions().switchSubscription instead
 * Legacy function for switching subscription plans
 */
export const switchSubscription = async (payload: {plan: string}) => {
    const {projectId} = getProjectValues()
    const response = await axios.post(
        `${getAgentaApiUrl()}/billing/plans/switch?plan=${payload.plan}&project_id=${projectId}`,
    )
    return response
}

/**
 * @deprecated Use useSubscriptionActions().cancelSubscription instead
 * Legacy function for canceling subscription
 */
export const cancelSubscription = async () => {
    const {projectId} = getProjectValues()
    const response = await axios.post(
        `${getAgentaApiUrl()}/billing/subscription/cancel?project_id=${projectId}`,
    )
    return response
}

/**
 * @deprecated Use useSubscriptionActions().checkoutSubscription instead
 * Legacy function for creating new subscription checkout
 */
export const checkoutNewSubscription = async (payload: {plan: string; success_url: string}) => {
    const response = await axios.post(
        `${getAgentaApiUrl()}/billing/stripe/checkouts/?plan=${payload.plan}&success_url=${payload.success_url}`,
    )
    return response
}

/**
 * @deprecated Use useSubscriptionActions().editSubscription instead
 * Legacy function for editing subscription info
 */
export const editSubscriptionInfo = async () => {
    const response = await axios.post(`${getAgentaApiUrl()}/billing/stripe/portals/`)
    return response
}
