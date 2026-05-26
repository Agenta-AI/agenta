import {atom} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {isBillingEnabled, isEE} from "@/oss/lib/helpers/isEE"
import {selectedOrgIdAtom} from "@/oss/state/org"
import {profileQueryAtom} from "@/oss/state/profile/selectors/user"
import {projectIdAtom} from "@/oss/state/project"
import {sessionExistsAtom} from "@/oss/state/session"

export interface PlanFlags {
    rbac?: boolean
    access?: boolean
    domains?: boolean
    sso?: boolean
    hooks?: boolean
    [key: string]: boolean | undefined
}

export interface PlanEntry {
    description?: string
    flags?: PlanFlags
    counters?: Record<string, unknown>
    gauges?: Record<string, unknown>
    throttles?: unknown[]
}

export type PlansCatalog = Record<string, PlanEntry>

export interface RoleEntry {
    role: string
    description?: string | null
    permissions: string[]
}

export type RolesCatalog = Record<"organization" | "workspace" | "project", RoleEntry[]>

export const plansQueryAtom = atomWithQuery((get) => {
    const sessionExists = get(sessionExistsAtom)
    return {
        queryKey: ["access", "plans"],
        queryFn: async (): Promise<PlansCatalog> => {
            const response = await axios.get(`${getAgentaApiUrl()}/access/plans`)
            return response.data
        },
        staleTime: 1000 * 60 * 10,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: true,
        enabled: isEE() && sessionExists,
        retry: (failureCount, error) => {
            if ((error as any)?.response?.status >= 400 && (error as any)?.response?.status < 500) {
                return false
            }
            return failureCount < 2
        },
    }
})

interface CurrentSubscription {
    plan?: string
    period_start?: number
    period_end?: number
    free_trial?: boolean
    type?: string
}

// Same queryKey + queryFn shape as `web/ee/src/state/billing/atoms.ts:subscriptionQueryAtom`
// so React Query treats them as one cache entry. Diverging the queryFn (e.g.
// adding try/catch here) causes whichever atom mounts first to dictate the
// cached shape — the symptom is the EE Billing UI working but `useEntitlements`
// reading stale `undefined` until a hard reload. Keep the two in lockstep.
export const currentSubscriptionQueryAtom = atomWithQuery((get) => {
    const profileQuery = get(profileQueryAtom)
    const user = profileQuery.data as {id?: string} | undefined
    const projectId = get(projectIdAtom)
    const organizationId = get(selectedOrgIdAtom)
    const sessionExists = get(sessionExistsAtom)
    return {
        queryKey: ["billing", "subscription", projectId, user?.id, organizationId],
        queryFn: async (): Promise<CurrentSubscription> => {
            const response = await axios.get(
                `${getAgentaApiUrl()}/billing/subscription?project_id=${projectId}`,
            )
            return response.data
        },
        staleTime: 1000 * 60 * 5,
        refetchOnWindowFocus: true,
        refetchOnReconnect: false,
        refetchOnMount: true,
        enabled: isEE() && sessionExists && !!organizationId && !!user && !!projectId,
        retry: (failureCount, error) => {
            if ((error as any)?.response?.status >= 400 && (error as any)?.response?.status < 500) {
                return false
            }
            return failureCount < 2
        },
    }
})

interface PricingEntry {
    free?: boolean
    trial?: number
    // Remaining keys are Stripe meter slot names — opaque to the frontend.
    [slot: string]: unknown
}

export type PricingMap = Record<string, PricingEntry>

const DEFAULT_FREE_PLAN = "cloud_v0_hobby"
const DEFAULT_TRIAL_PLAN = "cloud_v0_pro"
const DEFAULT_TRIAL_DAYS = 14

export interface CatalogEntry {
    title: string
    description?: string
    plan: string
    type: "standard" | "custom"
    features?: string[]
    price?: PricingEntry
}

export const catalogQueryAtom = atomWithQuery((get) => {
    const sessionExists = get(sessionExistsAtom)
    return {
        queryKey: ["billing", "catalog"],
        queryFn: async (): Promise<CatalogEntry[]> => {
            const response = await axios.get(`${getAgentaApiUrl()}/billing/catalog`)
            return response.data
        },
        staleTime: 1000 * 60 * 10,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: true,
        enabled: isEE() && sessionExists,
        retry: (failureCount, error) => {
            if ((error as any)?.response?.status >= 400 && (error as any)?.response?.status < 500) {
                return false
            }
            return failureCount < 2
        },
    }
})

export const pricingQueryAtom = atomWithQuery((get) => {
    const sessionExists = get(sessionExistsAtom)
    return {
        queryKey: ["billing", "pricing"],
        queryFn: async (): Promise<PricingMap> => {
            const response = await axios.get(`${getAgentaApiUrl()}/billing/pricing`)
            return response.data
        },
        staleTime: 1000 * 60 * 10,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: true,
        enabled: isEE() && sessionExists,
        retry: (failureCount, error) => {
            if ((error as any)?.response?.status >= 400 && (error as any)?.response?.status < 500) {
                return false
            }
            return failureCount < 2
        },
    }
})

const planSlugExists = (
    slug: string,
    plans?: PlansCatalog,
    pricing?: PricingMap,
    catalog?: CatalogEntry[],
) => {
    return Boolean(
        plans?.[slug] || pricing?.[slug] || catalog?.some((entry) => entry.plan === slug),
    )
}

// Derived: the slug of the deployment's free plan (the one with
// `{"free": true}` in AGENTA_BILLING_PRICING). Used by UI gates like the
// upgrade banner. Mirrors the backend fallback to `cloud_v0_hobby` when
// no plan is explicitly marked free and `cloud_v0_hobby` exists.
export const freePlanSlugAtom = atom((get): string | null => {
    const pricing = get(pricingQueryAtom).data
    const plans = get(plansQueryAtom).data
    const catalog = get(catalogQueryAtom).data

    if (pricing) {
        for (const [slug, entry] of Object.entries(pricing)) {
            if (entry?.free) return slug
        }
    }

    if (planSlugExists(DEFAULT_FREE_PLAN, plans, pricing, catalog)) {
        return DEFAULT_FREE_PLAN
    }

    return null
})

// Derived: trial plan and duration. Mirrors the backend fallback to
// `cloud_v0_pro` / 14 days when no plan is explicitly marked trial and
// `cloud_v0_pro` exists.
export const trialPlanAtom = atom((get): {plan: string; days: number} | null => {
    const pricing = get(pricingQueryAtom).data
    const plans = get(plansQueryAtom).data
    const catalog = get(catalogQueryAtom).data

    if (pricing) {
        for (const [slug, entry] of Object.entries(pricing)) {
            if (typeof entry?.trial === "number") return {plan: slug, days: entry.trial}
        }
    }

    if (planSlugExists(DEFAULT_TRIAL_PLAN, plans, pricing, catalog)) {
        return {plan: DEFAULT_TRIAL_PLAN, days: DEFAULT_TRIAL_DAYS}
    }

    return null
})

// Derived: `true` when the current subscription is on the free plan, OR when
// billing is disabled entirely (no billing → no paid-vs-free distinction, so
// treat the deployment as universally "free" for UI gates like "show upgrade
// button" or "hide auto-renew date"). Without this, self-hosted deployments
// without billing would render the paid-plan UI by default.
export const isOnFreePlanAtom = atom((get): boolean => {
    if (!isBillingEnabled()) return true
    const plan = get(currentSubscriptionQueryAtom).data?.plan
    const freeSlug = get(freePlanSlugAtom)
    return Boolean(plan && freeSlug && plan === freeSlug)
})

// Derived: catalog entry for the current subscription's plan, if any.
// Useful for UI gates that depend on the plan's `type` (standard vs custom).
export const currentCatalogEntryAtom = atom((get): CatalogEntry | null => {
    const plan = get(currentSubscriptionQueryAtom).data?.plan
    const catalog = get(catalogQueryAtom).data
    if (!plan || !catalog) return null
    return catalog.find((entry) => entry.plan === plan) ?? null
})

export const rolesQueryAtom = atomWithQuery((get) => {
    const sessionExists = get(sessionExistsAtom)
    return {
        queryKey: ["access", "roles"],
        queryFn: async (): Promise<RolesCatalog> => {
            const response = await axios.get(`${getAgentaApiUrl()}/access/roles`)
            return response.data
        },
        staleTime: 1000 * 60 * 10,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: true,
        enabled: isEE() && sessionExists,
        retry: (failureCount, error) => {
            if ((error as any)?.response?.status >= 400 && (error as any)?.response?.status < 500) {
                return false
            }
            return failureCount < 2
        },
    }
})
