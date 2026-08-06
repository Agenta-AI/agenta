import {useCallback} from "react"

import {useAtom, useAtomValue} from "jotai"

import {
    usageQueryAtom,
    subscriptionQueryAtom,
    pricingPlansQueryAtom,
    switchSubscriptionAtom,
    cancelSubscriptionAtom,
    checkoutSubscriptionAtom,
    editSubscriptionAtom,
} from "./atoms"

/**
 * Hook for managing billing usage data
 * Provides the same interface as the original SWR-based useUsageData hook
 */
export const useUsageData = () => {
    const usageQuery = useAtomValue(usageQueryAtom)

    return {
        usage: usageQuery.data,
        isUsageLoading: usageQuery.isPending,
        mutateUsage: usageQuery.refetch,
        error: usageQuery.error,
        isError: usageQuery.isError,
        isSuccess: usageQuery.isSuccess,
    }
}

/**
 * Hook for managing subscription data
 * Provides the same interface as the original SWR-based useSubscriptionData hook
 */
export const useSubscriptionData = () => {
    const subscriptionQuery = useAtomValue(subscriptionQueryAtom)

    return {
        subscription: subscriptionQuery.data,
        isSubLoading: subscriptionQuery.isPending,
        mutateSubscription: subscriptionQuery.refetch,
        error: subscriptionQuery.error,
        isError: subscriptionQuery.isError,
        isSuccess: subscriptionQuery.isSuccess,
    }
}

/**
 * Hook for managing pricing plans data
 * Provides the same interface as the original SWR-based usePricingPlans hook
 */
export const usePricingPlans = () => {
    const plansQuery = useAtomValue(pricingPlansQueryAtom)

    return {
        plans: plansQuery.data,
        isLoadingPlan: plansQuery.isPending,
        error: plansQuery.error,
        isError: plansQuery.isError,
        isSuccess: plansQuery.isSuccess,
        refetch: plansQuery.refetch,
    }
}

/**
 * Hook for managing subscription actions
 * Provides mutation functions for subscription management
 */
export const useSubscriptionActions = () => {
    const [, switchSubscription] = useAtom(switchSubscriptionAtom)
    const [, cancelSubscription] = useAtom(cancelSubscriptionAtom)
    const [, checkoutSubscription] = useAtom(checkoutSubscriptionAtom)
    const [, editSubscription] = useAtom(editSubscriptionAtom)

    const handleSwitchSubscription = useCallback(
        async (payload: {plan: string}) => {
            return await switchSubscription(payload)
        },
        [switchSubscription],
    )

    const handleCancelSubscription = useCallback(async () => {
        return await cancelSubscription()
    }, [cancelSubscription])

    const handleCheckoutSubscription = useCallback(
        async (payload: {plan: string; success_url: string}) => {
            return await checkoutSubscription(payload)
        },
        [checkoutSubscription],
    )

    const handleEditSubscription = useCallback(async () => {
        return await editSubscription()
    }, [editSubscription])

    return {
        switchSubscription: handleSwitchSubscription,
        cancelSubscription: handleCancelSubscription,
        checkoutSubscription: handleCheckoutSubscription,
        editSubscription: handleEditSubscription,
    }
}

/**
 * Combined hook for all billing functionality
 * Provides a comprehensive interface for billing management
 */
export const useBilling = () => {
    const usage = useUsageData()
    const subscription = useSubscriptionData()
    const plans = usePricingPlans()
    const actions = useSubscriptionActions()

    return {
        // Usage data
        usage: usage.usage,
        isUsageLoading: usage.isUsageLoading,
        mutateUsage: usage.mutateUsage,
        usageError: usage.error,

        // Subscription data
        subscription: subscription.subscription,
        isSubLoading: subscription.isSubLoading,
        mutateSubscription: subscription.mutateSubscription,
        subscriptionError: subscription.error,

        // Plans data
        plans: plans.plans,
        isLoadingPlan: plans.isLoadingPlan,
        plansError: plans.error,

        // Actions
        ...actions,
    }
}
