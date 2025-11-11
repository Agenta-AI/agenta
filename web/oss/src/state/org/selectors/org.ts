import {atom} from "jotai"
import {eagerAtom} from "jotai-eager"
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

export const cacheWorkspaceOrgPair = (workspaceId: string | null, orgId: string | null) => {
    if (typeof window === "undefined") return
    if (!workspaceId || !orgId) return
    const map = readWorkspaceOrgMap()
    map[workspaceId] = orgId
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
const debugOrgSelection = process.env.NEXT_PUBLIC_APP_STATE_DEBUG === "true"
logAtom(orgsQueryAtom, "orgsQueryAtom", logOrgs)

export const orgsAtom = eagerAtom<Org[]>((get) => {
    const res = (get(orgsQueryAtom) as any)?.data
    return res ?? []
})

export const selectedOrgIdAtom = atom((get) => {
    const snapshot = get(appStateSnapshotAtom)
    const queryOrgId = snapshot.query["org_id"]
    if (typeof queryOrgId === "string" && queryOrgId) return queryOrgId
    const {workspaceId} = get(appIdentifiersAtom)
    return resolveOrgId(workspaceId) ?? workspaceId
})

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
    if (org.is_demo === true) return true
    const type = org.type?.toLowerCase?.() ?? ""
    if (type === "view-only" || type === "demo") return true
    const name = org.name?.toLowerCase?.() ?? ""
    const description = org.description?.toLowerCase?.() ?? ""
    return name.includes("demo") || description.includes("demo")
}

const pickFirstNonDemoOrg = (orgs?: Org[]) => {
    if (!Array.isArray(orgs) || orgs.length === 0) return null
    const nonDemo = orgs.find((org) => !isDemoOrg(org))
    return nonDemo ?? orgs[0]
}

export const pickOwnedOrg = (userId: string | null, orgs?: Org[], nonDemoOnly = false) => {
    if (!userId || !Array.isArray(orgs)) return null
    const owned = orgs.filter((org) => org.owner === userId)
    if (!owned.length) return null
    if (!nonDemoOnly) return owned[0]
    const firstNonDemoOwned = owned.find((org) => !isDemoOrg(org))
    return firstNonDemoOwned ?? null
}

export const resolvePreferredWorkspaceId = (userId: string | null, orgs?: Org[]) => {
    if (!Array.isArray(orgs) || orgs.length === 0) return null

    const ownedPreferred = pickOwnedOrg(userId, orgs, true) ?? pickOwnedOrg(userId, orgs, false)
    if (ownedPreferred?.id) {
        return ownedPreferred.id
    }

    const fallback = pickFirstNonDemoOrg(orgs)
    return fallback?.id ?? null
}

export const selectedOrgQueryAtom = atomWithQuery<OrgDetails | null>((get) => {
    const snapshot = get(appStateSnapshotAtom)
    const queryOrgId = snapshot.query["org_id"]
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
            const org = await fetchSingleOrg({orgId: id})
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

export const selectedOrgAtom = eagerAtom<OrgDetails | null>((get) => {
    const res = (get(selectedOrgQueryAtom) as any)?.data
    return res ?? null
})

export const resetOrgDataAtom = atom(null, async (get) => {
    const qc = queryClient
    await qc.removeQueries({queryKey: ["orgs"]})
    await qc.removeQueries({queryKey: ["selectedOrg"]})
})
