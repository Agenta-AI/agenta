import {useMemo} from "react"

import {useAtomValue} from "jotai"

import {currentSubscriptionQueryAtom, plansQueryAtom} from "@/oss/state/access/atoms"

export enum Feature {
    ACCESS = "access",
    DOMAINS = "domains",
    SSO = "sso",
    RBAC = "rbac",
    HOOKS = "hooks",
    AUDIT = "audit",
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
    const hasAudit = !!flags?.audit

    // Both queries must resolve before flags are meaningful. While either is
    // pending, every `has*` read returns `false`, which is indistinguishable
    // from "feature disabled" — callers that gate UI on these should defer
    // rendering until `isLoading` is false to avoid a flash of the locked
    // state on first paint / soft navigation.
    const isLoading = subscriptionQuery.isPending || plansQuery.isPending

    return {
        hasAccessControl,
        hasDomains,
        hasSSO,
        hasRBAC,
        hasHooks,
        hasAudit,
        plan,
        isLoading,
    }
}
