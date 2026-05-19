import {useMemo} from "react"

import {useAtomValue} from "jotai"

import {currentSubscriptionQueryAtom, plansQueryAtom} from "@/oss/state/access/atoms"

export enum Feature {
    ACCESS = "access",
    DOMAINS = "domains",
    SSO = "sso",
    RBAC = "rbac",
    HOOKS = "hooks",
}

/**
 * Read entitlements from the access-controls catalog returned by
 * `/api/access/plans`, keyed by the org's current plan slug from
 * `/api/billing/subscription`. The previous implementation hardcoded
 * a slug allowlist (Hobby/Pro/Business/Enterprise) and broke for any
 * deployment using `AGENTA_ACCESS_PLANS` with custom slugs.
 */
export const useEntitlements = () => {
    const subscriptionQuery = useAtomValue(currentSubscriptionQueryAtom)
    const plansQuery = useAtomValue(plansQueryAtom)

    const plan = subscriptionQuery.data?.plan
    const flags = useMemo(() => {
        if (!plan) return undefined
        return plansQuery.data?.[plan]?.flags
    }, [plan, plansQuery.data])

    const hasAccessControl = !!flags?.access
    const hasDomains = !!flags?.domains
    const hasSSO = !!flags?.sso
    const hasRBAC = !!flags?.rbac
    const hasHooks = !!flags?.hooks

    return {
        hasAccessControl,
        hasDomains,
        hasSSO,
        hasRBAC,
        hasHooks,
        plan,
    }
}
