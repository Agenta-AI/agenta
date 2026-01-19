import {useMemo} from "react"

import {useSubscriptionDataWrapper} from "./useSubscriptionDataWrapper"

type Plan = "cloud_v0_hobby" | "cloud_v0_pro" | "cloud_v0_business" | "cloud_v0_enterprise"

export enum Feature {
    ACCESS = "access",
    DOMAINS = "domains",
    SSO = "sso",
    RBAC = "rbac",
    HOOKS = "hooks",
}

/**
 * Check if a feature is entitled for a given plan
 */
const isFeatureEntitled = (plan: Plan | undefined, feature: Feature): boolean => {
    if (!plan) return false

    // Hobby and Pro plans have no access to ACCESS, DOMAINS, or SSO
    if (plan === "cloud_v0_hobby" || plan === "cloud_v0_pro") {
        return false
    }

    // Business and Enterprise have access to all features
    if (plan === "cloud_v0_business" || plan === "cloud_v0_enterprise") {
        return true
    }

    return false
}

/**
 * Hook to check entitlements for various features
 */
export const useEntitlements = () => {
    const {subscription} = useSubscriptionDataWrapper()

    const hasAccessControl = useMemo(
        () => isFeatureEntitled(subscription?.plan, Feature.ACCESS),
        [subscription?.plan],
    )

    const hasDomains = useMemo(
        () => isFeatureEntitled(subscription?.plan, Feature.DOMAINS),
        [subscription?.plan],
    )

    const hasSSO = useMemo(
        () => isFeatureEntitled(subscription?.plan, Feature.SSO),
        [subscription?.plan],
    )

    const hasRBAC = useMemo(
        () => isFeatureEntitled(subscription?.plan, Feature.RBAC),
        [subscription?.plan],
    )

    const hasHooks = useMemo(
        () => isFeatureEntitled(subscription?.plan, Feature.HOOKS),
        [subscription?.plan],
    )

    return {
        hasAccessControl,
        hasDomains,
        hasSSO,
        hasRBAC,
        hasHooks,
        plan: subscription?.plan,
    }
}
