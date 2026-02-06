import {atom} from "jotai"
import {atomWithMutation, atomWithQuery} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {User} from "@/oss/lib/Types"
import {selectedOrgIdAtom} from "@/oss/state/org"
import {profileQueryAtom} from "@/oss/state/profile/selectors/user"
import {projectIdAtom} from "@/oss/state/project"
import {sessionExistsAtom} from "@/oss/state/session"

import {BillingPlan, DataUsageType, SubscriptionType} from "../../services/billing/types"

/**
 * Query atom for fetching billing usage data
 * Only enabled when user is authenticated and project is not default
 */
export const usageQueryAtom = atomWithQuery((get) => {
    const profileQuery = get(profileQueryAtom)
    const user = profileQuery.data as User | undefined
    const projectId = get(projectIdAtom)

    return {
        queryKey: ["billing", "usage", projectId, user?.id],
        queryFn: async () => {
            const response = await axios.get(
                `${getAgentaApiUrl()}/billing/usage?project_id=${projectId}`,
            )
            return response.data as DataUsageType
        },
        staleTime: 1000 * 60 * 2, // 2 minutes
        refetchOnWindowFocus: true,
        refetchOnReconnect: false,
        refetchOnMount: true,
        enabled: !!user && !!projectId,
        retry: (failureCount, error) => {
            // Don't retry on client errors
            if ((error as any)?.response?.status >= 400 && (error as any)?.response?.status < 500) {
                return false
            }
            return failureCount < 2
        },
    }
})

/**
 * Query atom for fetching subscription data
 * Only enabled when user is authenticated and project is not default
 */
export const subscriptionQueryAtom = atomWithQuery((get) => {
    const profileQuery = get(profileQueryAtom)
    const user = profileQuery.data as User | undefined
    const projectId = get(projectIdAtom)
    const organizationId = get(selectedOrgIdAtom)
    const sessionExists = get(sessionExistsAtom)

    return {
        queryKey: ["billing", "subscription", projectId, user?.id, organizationId],
        queryFn: async () => {
            const response = await axios.get(
                `${getAgentaApiUrl()}/billing/subscription?project_id=${projectId}`,
            )
            return response.data as SubscriptionType
        },
        staleTime: 1000 * 60 * 5, // 5 minutes
        refetchOnWindowFocus: true,
        refetchOnReconnect: false,
        refetchOnMount: true,
        enabled: sessionExists && !!organizationId && !!user && !!projectId,
        retry: (failureCount, error) => {
            // Don't retry on client errors
            if ((error as any)?.response?.status >= 400 && (error as any)?.response?.status < 500) {
                return false
            }
            return failureCount < 2
        },
    }
})

/**
 * Query atom for fetching pricing plans
 * Only enabled when user is authenticated and project is not default
 */
export const pricingPlansQueryAtom = atomWithQuery((get) => {
    const profileQuery = get(profileQueryAtom)
    const user = profileQuery.data as User | undefined
    const projectId = get(projectIdAtom)

    return {
        queryKey: ["billing", "plans", projectId, user?.id],
        queryFn: async () => {
            const response = await axios.get(
                `${getAgentaApiUrl()}/billing/plans?project_id=${projectId}`,
            )
            return response.data as BillingPlan[]
        },
        staleTime: 1000 * 60 * 10, // 10 minutes - plans don't change often
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: true,
        enabled: !!user && !!projectId,
        retry: (failureCount, error) => {
            // Don't retry on client errors
            if ((error as any)?.response?.status >= 400 && (error as any)?.response?.status < 500) {
                return false
            }
            return failureCount < 2
        },
    }
})

/**
 * Mutation atom for switching subscription plans
 */
export const switchSubscriptionMutationAtom = atomWithMutation(() => ({
    mutationFn: async (payload: {plan: string}) => {
        const store = await import("jotai").then((m) => m.getDefaultStore())
        const projectId = store.get(projectIdAtom)

        const response = await axios.post(
            `${getAgentaApiUrl()}/billing/plans/switch?plan=${payload.plan}&project_id=${projectId}`,
        )
        return response.data
    },
    onSuccess: () => {
        // Subscription data will be invalidated by the hook
    },
}))

/**
 * Mutation atom for canceling subscription
 */
export const cancelSubscriptionMutationAtom = atomWithMutation(() => ({
    mutationFn: async () => {
        const store = await import("jotai").then((m) => m.getDefaultStore())
        const projectId = store.get(projectIdAtom)

        const response = await axios.post(
            `${getAgentaApiUrl()}/billing/subscription/cancel?project_id=${projectId}`,
        )
        return response.data
    },
    onSuccess: () => {
        // Subscription data will be invalidated by the hook
    },
}))

/**
 * Mutation atom for creating new subscription checkout
 */
export const checkoutSubscriptionMutationAtom = atomWithMutation(() => ({
    mutationFn: async (payload: {plan: string; success_url: string}) => {
        const response = await axios.post(
            `${getAgentaApiUrl()}/billing/stripe/checkouts/?plan=${payload.plan}&success_url=${payload.success_url}`,
        )
        return response.data
    },
}))

/**
 * Mutation atom for editing subscription info (Stripe portal)
 */
export const editSubscriptionMutationAtom = atomWithMutation(() => ({
    mutationFn: async () => {
        const response = await axios.post(`${getAgentaApiUrl()}/billing/stripe/portals/`)
        return response.data
    },
}))

/**
 * Action atom for switching subscription with automatic data refresh
 */
export const switchSubscriptionAtom = atom(null, async (get, set, payload: {plan: string}) => {
    const switchMutation = get(switchSubscriptionMutationAtom)

    try {
        const result = await switchMutation.mutateAsync(payload)

        // Refetch subscription and usage data after successful switch
        set(subscriptionQueryAtom)
        set(usageQueryAtom)

        return result
    } catch (error) {
        console.error("Failed to switch subscription:", error)
        throw error
    }
})

/**
 * Action atom for canceling subscription with automatic data refresh
 */
export const cancelSubscriptionAtom = atom(null, async (get, set) => {
    const cancelMutation = get(cancelSubscriptionMutationAtom)

    try {
        const result = await cancelMutation.mutateAsync()

        // Refetch subscription and usage data after successful cancellation
        set(subscriptionQueryAtom)
        set(usageQueryAtom)

        return result
    } catch (error) {
        console.error("Failed to cancel subscription:", error)
        throw error
    }
})

/**
 * Action atom for checkout with no automatic refresh (redirect expected)
 */
export const checkoutSubscriptionAtom = atom(
    null,
    async (get, set, payload: {plan: string; success_url: string}) => {
        const checkoutMutation = get(checkoutSubscriptionMutationAtom)

        try {
            const result = await checkoutMutation.mutateAsync(payload)
            return result
        } catch (error) {
            console.error("Failed to create checkout:", error)
            throw error
        }
    },
)

/**
 * Action atom for editing subscription info (Stripe portal)
 */
export const editSubscriptionAtom = atom(null, async (get, set) => {
    const editMutation = get(editSubscriptionMutationAtom)

    try {
        const result = await editMutation.mutateAsync()
        return result
    } catch (error) {
        console.error("Failed to open subscription portal:", error)
        throw error
    }
})
