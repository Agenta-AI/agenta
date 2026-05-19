import {atomWithQuery} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {isEE} from "@/oss/lib/helpers/isEE"
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
