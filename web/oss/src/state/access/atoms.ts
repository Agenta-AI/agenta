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
            const response = await axios.get(`${getAgentaApiUrl()}/access/plans`, {
                _ignoreError: true,
            } as any)
            return response.data
        },
        staleTime: 1000 * 60 * 10,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        enabled: isEE() && sessionExists,
        retry: false,
    }
})

interface CurrentSubscription {
    plan?: string
    period_start?: number
    period_end?: number
    free_trial?: boolean
    type?: string
}

// Same queryKey shape as `web/ee/src/state/billing/atoms.ts:subscriptionQueryAtom`
// so React Query dedupes the request across the two consumers (the EE Billing
// UI's hook and `useEntitlements`). Keep the shapes aligned if either side
// changes.
export const currentSubscriptionQueryAtom = atomWithQuery((get) => {
    const profileQuery = get(profileQueryAtom)
    const user = profileQuery.data as {id?: string} | undefined
    const projectId = get(projectIdAtom)
    const organizationId = get(selectedOrgIdAtom)
    const sessionExists = get(sessionExistsAtom)
    return {
        queryKey: ["billing", "subscription", projectId, user?.id, organizationId],
        queryFn: async (): Promise<CurrentSubscription | null> => {
            try {
                const response = await axios.get(
                    `${getAgentaApiUrl()}/billing/subscription?project_id=${projectId}`,
                    {_ignoreError: true} as any,
                )
                return response.data
            } catch {
                return null
            }
        },
        staleTime: 1000 * 60 * 5,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        enabled: isEE() && sessionExists && !!organizationId && !!user && !!projectId,
        retry: false,
    }
})

export const rolesQueryAtom = atomWithQuery((get) => {
    const sessionExists = get(sessionExistsAtom)
    return {
        queryKey: ["access", "roles"],
        queryFn: async (): Promise<RolesCatalog> => {
            const response = await axios.get(`${getAgentaApiUrl()}/access/roles`, {
                _ignoreError: true,
            } as any)
            return response.data
        },
        staleTime: 1000 * 60 * 10,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        enabled: isEE() && sessionExists,
        retry: false,
    }
})
