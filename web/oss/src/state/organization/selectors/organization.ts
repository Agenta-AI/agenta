import {atom} from "jotai"
import {eagerAtom} from "jotai-eager"
import {atomWithQuery} from "jotai-tanstack-query"

import {queryClient} from "@/oss/lib/api/queryClient"
import {Organization, OrganizationDetails} from "@/oss/lib/Types"
import type {User} from "@/oss/lib/Types"
import {fetchAllOrganizationsList, fetchSingleOrganization} from "@/oss/services/organization/api"
import {appIdentifiersAtom, appStateSnapshotAtom, requestNavigationAtom} from "@/oss/state/appState"
import {userAtom} from "@/oss/state/profile/selectors/user"
import {sessionExistsAtom} from "@/oss/state/session"
import {logAtom} from "@/oss/state/utils/logAtom"

const WORKSPACE_ORG_MAP_KEY = "workspaceOrganizationMap"
const LAST_USED_WORKSPACE_ID_KEY = "lastUsedWorkspaceId"

const readWorkspaceOrganizationMap = (): Record<string, string> => {
    if (typeof window === "undefined") return {}
    try {
        const raw = window.localStorage.getItem(WORKSPACE_ORG_MAP_KEY)
        if (!raw) return {}
        const parsed = JSON.parse(raw)
        return typeof parsed === "object" && parsed !== null ? parsed : {}
    } catch {
        return {}
    }
}

const readLastUsedWorkspaceId = (): string | null => {
    if (typeof window === "undefined") return null
    try {
        const raw = window.localStorage.getItem(LAST_USED_WORKSPACE_ID_KEY)
        if (!raw) return null
        const trimmed = raw.trim()
        return trimmed || null
    } catch {
        return null
    }
}

const cacheLastWorkspaceId = (workspaceId: string | null) => {
    if (typeof window === "undefined") return
    if (!workspaceId) return
    try {
        window.localStorage.setItem(LAST_USED_WORKSPACE_ID_KEY, workspaceId)
    } catch {
        // ignore storage exceptions
    }
}

export const cacheWorkspaceOrganizationPair = (
    workspaceId: string | null,
    organizationId: string | null,
) => {
    if (typeof window === "undefined") return
    if (!workspaceId || !organizationId) return
    cacheLastWorkspaceId(workspaceId)
    const map = readWorkspaceOrganizationMap()
    map[workspaceId] = organizationId
    try {
        window.localStorage.setItem(WORKSPACE_ORG_MAP_KEY, JSON.stringify(map))
    } catch {
        // ignore storage exceptions
    }
}

const resolveOrganizationId = (workspaceId: string | null): string | null => {
    if (!workspaceId) return null
    const map = readWorkspaceOrganizationMap()
    return map[workspaceId] ?? null
}

export const organizationsQueryAtom = atomWithQuery<Organization[]>((get) => {
    const userId = (get(userAtom) as User | null)?.id
    return {
        queryKey: ["organizations", userId || ""],
        queryFn: async () => fetchAllOrganizationsList(),
        staleTime: 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: false,
        enabled: !!userId,
    }
})

const logOrganizations = process.env.NEXT_PUBLIC_LOG_ORG_ATOMS === "true"
const debugOrganizationSelection = process.env.NEXT_PUBLIC_APP_STATE_DEBUG === "true"
logAtom(organizationsQueryAtom, "organizationsQueryAtom", logOrganizations)

export const organizationsAtom = eagerAtom<Organization[]>((get) => {
    const res = (get(organizationsQueryAtom) as any)?.data
    return res ?? []
})

export const selectedOrganizationIdAtom = atom((get) => {
    const snapshot = get(appStateSnapshotAtom)
    const queryOrganizationId = snapshot.query["organization_id"]
    if (typeof queryOrganizationId === "string" && queryOrganizationId) return queryOrganizationId
    const {workspaceId} = get(appIdentifiersAtom)
    const userId = (get(userAtom) as User | null)?.id
    const organizations = get(organizationsAtom)

    // helper: validate a candidate workspace/organization id against current organization list
    const isValidForUser = (candidate: string | null): boolean => {
        if (!candidate) return false

        // direct organization match
        if (organizations && Array.isArray(organizations) && organizations.some((organization) => organization.id === candidate)) return true

        // mapped organization match
        const mappedOrganizationId = resolveOrganizationId(candidate)
        if (
            mappedOrganizationId &&
            organizations &&
            Array.isArray(organizations) &&
            organizations.some((organization) => organization.id === mappedOrganizationId)
        ) {
            return true
        }

        return false
    }

    // 1. If we already have a workspaceId from runtime state, prefer it.
    //    This respects direct navigation (/w/:id) even if we haven't cached a mapping yet.
    if (workspaceId) {
        const resolvedNow = resolveOrganizationId(workspaceId) ?? workspaceId
        return resolvedNow
    }

    // 2. Fallback: use lastUsedWorkspaceId from localStorage,
    //    but ONLY if it's still valid for this signed-in user.
    const cachedLast = readLastUsedWorkspaceId()
    if (cachedLast && isValidForUser(cachedLast)) {
        const resolved = resolveOrganizationId(cachedLast) ?? cachedLast
        return resolved
    }

    // 3. Final fallback: pick a "preferred" workspace/organization for this user
    //    (owned organizations first, then non-demo, etc), and normalize it to organizationId if we can.
    const preferred = resolvePreferredWorkspaceId(userId ?? null, organizations)
    if (preferred) {
        const resolved = resolveOrganizationId(preferred) ?? preferred
        return resolved
    }

    return null
})

export const selectedOrganizationNavigationAtom = atom(null, (get, set, next: string | null) => {
    const {workspaceId} = get(appIdentifiersAtom)
    const target = typeof next === "function" ? (next as any)(workspaceId) : next
    if (!target) {
        set(requestNavigationAtom, {type: "href", href: "/w", method: "replace"})
        return
    }
    if (target === workspaceId) return
    const href = `/w/${encodeURIComponent(target)}`
    set(requestNavigationAtom, {type: "href", href, method: "push"})
})

const isDemoOrganization = (organization?: Partial<Organization>): boolean => {
    if (!organization) return false
    if (organization.is_demo === true) return true
    const type = organization.type?.toLowerCase?.() ?? ""
    if (type === "view-only" || type === "demo") return true
    const name = organization.name?.toLowerCase?.() ?? ""
    const description = organization.description?.toLowerCase?.() ?? ""
    return name.includes("demo") || description.includes("demo")
}

const pickFirstNonDemoOrganization = (organizations?: Organization[]) => {
    if (!Array.isArray(organizations) || organizations.length === 0) return null
    const nonDemo = organizations.find((organization) => !isDemoOrganization(organization))
    return nonDemo ?? organizations[0]
}

export const pickOwnedOrganization = (userId: string | null, organizations?: Organization[], nonDemoOnly = false) => {
    if (!userId || !Array.isArray(organizations)) return null
    const owned = organizations.filter((organization) => organization.owner === userId)
    if (!owned.length) return null
    if (!nonDemoOnly) return owned[0]
    const firstNonDemoOwned = owned.find((organization) => !isDemoOrganization(organization))
    return firstNonDemoOwned ?? null
}

export const resolvePreferredWorkspaceId = (userId: string | null, organizations?: Organization[]) => {
    if (!Array.isArray(organizations) || organizations.length === 0) return null

    const lastWorkspaceId = readLastUsedWorkspaceId()
    if (lastWorkspaceId) {
        const hasDirectOrganizationMatch = organizations.some((organization) => organization.id === lastWorkspaceId)
        if (hasDirectOrganizationMatch) {
            return lastWorkspaceId
        }
        const mappedOrganizationId = resolveOrganizationId(lastWorkspaceId)
        if (mappedOrganizationId) {
            const organizationExists = organizations.some((organization) => organization.id === mappedOrganizationId)
            if (organizationExists) {
                return lastWorkspaceId
            }
        }
    }

    const ownedPreferred = pickOwnedOrganization(userId, organizations, true) ?? pickOwnedOrganization(userId, organizations, false)
    if (ownedPreferred?.id) {
        return ownedPreferred.id
    }

    const fallback = pickFirstNonDemoOrganization(organizations)
    return fallback?.id ?? null
}

export const selectedOrganizationQueryAtom = atomWithQuery<OrganizationDetails | null>((get) => {
    const snapshot = get(appStateSnapshotAtom)
    const queryOrganizationId = snapshot.query["organization_id"]
    const id = (typeof queryOrganizationId === "string" && queryOrganizationId) || get(selectedOrganizationIdAtom)
    const userId = (get(userAtom) as User | null)?.id
    const isWorkspaceRoute =
        snapshot.routeLayer === "workspace" ||
        snapshot.routeLayer === "project" ||
        snapshot.routeLayer === "app"
    const isAcceptRoute = snapshot.pathname.startsWith("/workspaces/accept")
    const enabled =
        !!id &&
        id !== null &&
        get(sessionExistsAtom) &&
        !!userId &&
        isWorkspaceRoute &&
        !isAcceptRoute

    return {
        queryKey: ["selectedOrganization", id],
        queryFn: async () => {
            if (!id) return null
            const organization = await fetchSingleOrganization({organizationId: id})
            return organization
        },
        staleTime: 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: false,
        retry: (failureCount, error: any) => {
            const status = error?.response?.status
            if (status && status >= 400 && status < 500) return false
            return failureCount < 2
        },
        onSuccess: () => {
            if (process.env.NEXT_PUBLIC_LOG_ORG_ATOMS === "true") {
                console.debug("[organization] selectedOrganization fetched", id)
            }
        },
        enabled,
    }
})

logAtom(selectedOrganizationQueryAtom, "selectedOrganizationQueryAtom", logOrganizations)

export const selectedOrganizationAtom = eagerAtom<OrganizationDetails | null>((get) => {
    const res = (get(selectedOrganizationQueryAtom) as any)?.data
    return res ?? null
})

export const resetOrganizationDataAtom = atom(null, async (get) => {
    const qc = queryClient
    await qc.removeQueries({queryKey: ["organizations"]})
    await qc.removeQueries({queryKey: ["selectedOrganization"]})
})
