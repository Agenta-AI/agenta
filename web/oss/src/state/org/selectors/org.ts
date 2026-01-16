import {atom} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import {queryClient} from "@/oss/lib/api/queryClient"
import {Org, OrgDetails} from "@/oss/lib/Types"
import type {User} from "@/oss/lib/Types"
import {fetchAllOrgsList, fetchSingleOrg} from "@/oss/services/organization/api"
import {appIdentifiersAtom, appStateSnapshotAtom, requestNavigationAtom} from "@/oss/state/appState"
import {userAtom} from "@/oss/state/profile/selectors/user"
import {sessionExistsAtom} from "@/oss/state/session"
import {logAtom} from "@/oss/state/utils/logAtom"

const WORKSPACE_ORG_MAP_KEY = "workspaceOrgMap"
const LAST_USED_WORKSPACE_ID_KEY = "lastUsedWorkspaceId"

const readWorkspaceOrgMap = (): Record<string, string> => {
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

export const clearWorkspaceOrgCache = (workspaceId: string | null) => {
    if (typeof window === "undefined") return
    if (!workspaceId) return

    try {
        const map = readWorkspaceOrgMap()
        if (map[workspaceId]) {
            delete map[workspaceId]
            if (Object.keys(map).length === 0) {
                window.localStorage.removeItem(WORKSPACE_ORG_MAP_KEY)
            } else {
                window.localStorage.setItem(WORKSPACE_ORG_MAP_KEY, JSON.stringify(map))
            }
        }
    } catch {
        // ignore storage exceptions
    }

    try {
        const lastUsed = readLastUsedWorkspaceId()
        if (lastUsed === workspaceId) {
            window.localStorage.removeItem(LAST_USED_WORKSPACE_ID_KEY)
        }
    } catch {
        // ignore storage exceptions
    }
}

export const cacheWorkspaceOrgPair = (
    workspaceId: string | null,
    organizationId: string | null,
) => {
    if (typeof window === "undefined") return
    if (!workspaceId || !organizationId) return
    cacheLastWorkspaceId(workspaceId)
    const map = readWorkspaceOrgMap()
    map[workspaceId] = organizationId
    try {
        window.localStorage.setItem(WORKSPACE_ORG_MAP_KEY, JSON.stringify(map))
    } catch {
        // ignore storage exceptions
    }
}

const resolveOrgId = (workspaceId: string | null): string | null => {
    if (!workspaceId) return null
    const map = readWorkspaceOrgMap()
    return map[workspaceId] ?? null
}

export const orgsQueryAtom = atomWithQuery<Org[]>((get) => {
    const userId = (get(userAtom) as User | null)?.id
    return {
        queryKey: ["orgs", userId || ""],
        queryFn: async () => fetchAllOrgsList(),
        staleTime: 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: false,
        enabled: !!userId,
    }
})

const logOrgs = process.env.NEXT_PUBLIC_LOG_ORG_ATOMS === "true"
logAtom(orgsQueryAtom, "orgsQueryAtom", logOrgs)

export const orgsAtom = atom<Org[]>((get) => {
    const res = (get(orgsQueryAtom) as any)?.data
    const orgs = res ?? []
    // Sort organizations to ensure demo orgs are always last
    return sortOrgsWithDemoLast(orgs)
})

export const selectedOrgIdAtom = atom((get) => {
    const snapshot = get(appStateSnapshotAtom)
    const queryOrgId = snapshot.query["organization_id"]
    if (typeof queryOrgId === "string" && queryOrgId) return queryOrgId
    const {workspaceId} = get(appIdentifiersAtom)
    const userId = (get(userAtom) as User | null)?.id
    const orgs = get(orgsAtom)

    // helper: validate a candidate workspace/org id against current org list
    const isValidForUser = (candidate: string | null): boolean => {
        if (!candidate) return false

        // direct org match
        if (orgs && Array.isArray(orgs) && orgs.some((org) => org.id === candidate)) return true

        // mapped org match
        const mappedOrgId = resolveOrgId(candidate)
        if (
            mappedOrgId &&
            orgs &&
            Array.isArray(orgs) &&
            orgs.some((org) => org.id === mappedOrgId)
        ) {
            return true
        }

        return false
    }

    // 1. If we already have a workspaceId from runtime state, prefer it.
    //    This respects direct navigation (/w/:id) even if we haven't cached a mapping yet.
    if (workspaceId) {
        const resolvedNow = resolveOrgId(workspaceId) ?? workspaceId
        return resolvedNow
    }

    // 2. Fallback: use lastUsedWorkspaceId from localStorage,
    //    but ONLY if it's still valid for this signed-in user.
    const cachedLast = readLastUsedWorkspaceId()
    if (cachedLast && isValidForUser(cachedLast)) {
        const resolved = resolveOrgId(cachedLast) ?? cachedLast
        return resolved
    }

    // 3. Final fallback: pick a "preferred" workspace/org for this user
    //    (owned orgs first, then non-demo, etc), and normalize it to orgId if we can.
    const preferred = resolvePreferredWorkspaceId(userId ?? null, orgs)
    if (preferred) {
        const resolved = resolveOrgId(preferred) ?? preferred
        return resolved
    }

    return null
})

const normalizeOrgIdentifier = async (
    id: string,
    get: (a: any) => any,
): Promise<{orgId: string; workspaceId: string | null}> => {
    const orgs = get(orgsAtom) as Org[]

    if (Array.isArray(orgs) && orgs.some((org) => org.id === id)) {
        return {orgId: id, workspaceId: null}
    }

    const mapped = resolveOrgId(id)
    if (mapped) {
        return {orgId: mapped, workspaceId: id}
    }

    return {orgId: id, workspaceId: null}
}

export const selectedOrgNavigationAtom = atom(null, (get, set, next: string | null) => {
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

const isDemoOrg = (org?: Partial<Org>): boolean => {
    if (!org) return false
    if (org?.flags?.["is_demo"] === true) return true
    return false
}

/**
 * Sorts organizations to ensure demo orgs are always last
 * Non-demo orgs maintain their original order, demo orgs are moved to the end
 */
const sortOrgsWithDemoLast = (orgs: Org[]): Org[] => {
    const nonDemoOrgs = orgs.filter((org) => !isDemoOrg(org))
    const demoOrgs = orgs.filter((org) => isDemoOrg(org))
    return [...nonDemoOrgs, ...demoOrgs]
}

const pickFirstNonDemoOrg = (orgs?: Org[]) => {
    if (!Array.isArray(orgs) || orgs.length === 0) return null
    const nonDemo = orgs.find((org) => !isDemoOrg(org))
    // Only fall back to demo org if there are no non-demo orgs at all
    return nonDemo ?? orgs[0]
}

export const pickOwnedOrg = (userId: string | null, orgs?: Org[], nonDemoOnly = false) => {
    if (!userId || !Array.isArray(orgs)) return null
    const owned = orgs.filter((org) => org.owner_id === userId)
    if (!owned.length) return null

    if (!nonDemoOnly) return owned[0]
    const firstNonDemoOwned = owned.find((org) => !isDemoOrg(org))
    return firstNonDemoOwned ?? null
}

export const resolvePreferredWorkspaceId = (userId: string | null, orgs?: Org[]) => {
    if (!Array.isArray(orgs) || orgs.length === 0) return null

    // 1. Prefer last-used workspace if still valid AND not a demo org
    const lastWorkspaceId = readLastUsedWorkspaceId()
    if (lastWorkspaceId) {
        const hasDirectOrgMatch = orgs.some((org) => org.id === lastWorkspaceId)
        if (hasDirectOrgMatch) {
            const lastOrg = orgs.find((org) => org.id === lastWorkspaceId)
            // Only use last-used if it's not a demo org, unless it's the only org
            if (lastOrg && (!isDemoOrg(lastOrg) || orgs.length === 1)) {
                return lastWorkspaceId
            }
        }
        const mappedOrgId = resolveOrgId(lastWorkspaceId)
        if (mappedOrgId) {
            const orgExists = orgs.some((org) => org.id === mappedOrgId)
            if (orgExists) {
                const lastOrg = orgs.find((org) => org.id === mappedOrgId)
                // Only use last-used if it's not a demo org, unless it's the only org
                if (lastOrg && (!isDemoOrg(lastOrg) || orgs.length === 1)) {
                    return lastWorkspaceId
                }
            }
        }
    }

    // 2. Prefer an owned non-demo org
    const ownedNonDemo = pickOwnedOrg(userId, orgs, true)
    if (ownedNonDemo?.id) {
        return ownedNonDemo.id
    }

    // 3. Fall back to first non-demo org (not owned by user)
    const firstNonDemo = pickFirstNonDemoOrg(orgs)
    if (firstNonDemo?.id && !isDemoOrg(firstNonDemo)) {
        return firstNonDemo.id
    }

    // 4. Only as absolute last resort: use owned demo org
    const ownedDemo = pickOwnedOrg(userId, orgs, false)
    if (ownedDemo?.id && isDemoOrg(ownedDemo)) {
        return ownedDemo.id
    }

    // 5. Final fallback: any demo org (only if it's the only option)
    const anyOrg = orgs[0]
    return anyOrg?.id ?? null
}

export const selectedOrgQueryAtom = atomWithQuery<OrgDetails | null>((get) => {
    const snapshot = get(appStateSnapshotAtom)
    const queryOrgId = snapshot.query["organization_id"]
    const id = (typeof queryOrgId === "string" && queryOrgId) || get(selectedOrgIdAtom)
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
        queryKey: ["selectedOrg", id],
        queryFn: async () => {
            if (!id) return null
            const {orgId} = await normalizeOrgIdentifier(id, get)
            const org = await fetchSingleOrg({organizationId: orgId})
            if (org?.default_workspace?.id && org?.id) {
                cacheWorkspaceOrgPair(org.default_workspace.id, org.id)
            }
            return org
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
                console.debug("[org] selectedOrg fetched", id)
            }
        },
        enabled,
    }
})

logAtom(selectedOrgQueryAtom, "selectedOrgQueryAtom", logOrgs)

export const selectedOrgAtom = atom<OrgDetails | null>((get) => {
    const res = (get(selectedOrgQueryAtom) as any)?.data
    return res ?? null
})

export const resetOrganizationDataAtom = atom(null, async (get) => {
    const qc = queryClient
    await qc.removeQueries({queryKey: ["orgs"]})
    await qc.removeQueries({queryKey: ["selectedOrg"]})
})
