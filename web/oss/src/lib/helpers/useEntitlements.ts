import {useMemo} from "react"

import {DefaultPlan} from "@/oss/lib/Types"

import {useSubscriptionDataWrapper} from "./useSubscriptionDataWrapper"

// Runtime plan slugs are dynamic (env-overridable via AGENTA_ACCESS_PLANS).
// API responses carry plain strings; the `DefaultPlan` enum in `@/oss/lib/Types`
// is used as a labeled set of known default slug constants.
type Plan = string

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
    if (plan === DefaultPlan.Hobby || plan === DefaultPlan.Pro) {
        return false
    }

    // Business, Enterprise, and self-hosted enterprise have access to all features
    if (
        plan === DefaultPlan.Business ||
        plan === DefaultPlan.Enterprise ||
        plan === DefaultPlan.SelfHostedEnterprise
    ) {
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
