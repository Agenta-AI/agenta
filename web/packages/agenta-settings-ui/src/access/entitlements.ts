/**
 * Plan entitlements — which paid features this organization's plan includes.
 *
 * Read from the access-controls catalog (`/access/plans`), keyed by the plan slug on the
 * current subscription (`/billing/subscription`). Never branch on a slug literal: slugs are
 * env-overridable via `AGENTA_ACCESS_PLANS`, which is exactly what a hardcoded
 * Hobby/Pro/Business allowlist got wrong.
 *
 * For a host with no entitlement layer of its own. The desktop resolves the same two
 * responses through its own jotai atoms, which also gate them behind its idle-boot pass and
 * share the subscription with the billing UI.
 */

import {axios, getAgentaApiUrl} from "@agenta/shared/api"
import {useQuery} from "@tanstack/react-query"

export interface PlanFlags {
    access?: boolean
    domains?: boolean
    sso?: boolean
    rbac?: boolean
    hooks?: boolean
    audit?: boolean
    [key: string]: boolean | undefined
}

export type PlansCatalog = Record<string, {flags?: PlanFlags} | undefined>

export interface Entitlements {
    hasAccessControl: boolean
    hasDomains: boolean
    hasSSO: boolean
    hasRBAC: boolean
    hasHooks: boolean
    hasAudit: boolean
    /**
     * Either response is still in flight. Every `has*` reads `false` until both land, which is
     * indistinguishable from "not included" — defer the locked state on it or it flashes.
     */
    isLoading: boolean
}

const NO_ENTITLEMENTS: Entitlements = {
    hasAccessControl: false,
    hasDomains: false,
    hasSSO: false,
    hasRBAC: false,
    hasHooks: false,
    hasAudit: false,
    isLoading: false,
}

export const fetchAccessPlans = async (): Promise<PlansCatalog> => {
    const {data} = await axios.get(`${getAgentaApiUrl()}/access/plans`)
    return data
}

export const fetchCurrentSubscription = async (
    projectId: string,
): Promise<{plan?: string} | null> => {
    const {data} = await axios.get(`${getAgentaApiUrl()}/billing/subscription`, {
        params: {project_id: projectId},
    })
    return data
}

export interface UseEntitlementsParams {
    projectId?: string | null
    /** Off on OSS, and off where the billing service is not deployed — both leave every flag false. */
    enabled?: boolean
}

export const useEntitlements = ({
    projectId,
    enabled = true,
}: UseEntitlementsParams): Entitlements => {
    const canQuery = enabled && Boolean(projectId)

    const plans = useQuery({
        queryKey: ["access", "plans"],
        queryFn: fetchAccessPlans,
        staleTime: 1000 * 60 * 10,
        refetchOnWindowFocus: false,
        enabled: canQuery,
    })

    const subscription = useQuery({
        queryKey: ["billing", "subscription", projectId],
        queryFn: () => fetchCurrentSubscription(projectId as string),
        staleTime: 1000 * 60 * 5,
        refetchOnWindowFocus: false,
        enabled: canQuery,
    })

    if (!canQuery) return NO_ENTITLEMENTS

    const plan = subscription.data?.plan
    const flags = plan ? plans.data?.[plan]?.flags : undefined

    return {
        hasAccessControl: !!flags?.access,
        hasDomains: !!flags?.domains,
        hasSSO: !!flags?.sso,
        hasRBAC: !!flags?.rbac,
        hasHooks: !!flags?.hooks,
        hasAudit: !!flags?.audit,
        // A disabled query stays `pending` forever, so pair it with `fetchStatus`.
        isLoading:
            (plans.isPending && plans.fetchStatus !== "idle") ||
            (subscription.isPending && subscription.fetchStatus !== "idle"),
    }
}
