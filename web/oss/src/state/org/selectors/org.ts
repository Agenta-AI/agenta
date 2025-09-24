import {atom} from "jotai"
import {atomWithStorage} from "jotai/utils"
import {eagerAtom} from "jotai-eager"
import {observe} from "jotai-effect"
import {atomWithQuery} from "jotai-tanstack-query"
import Router from "next/router"

import {queryClient} from "@/oss/lib/api/queryClient"
import {Org, OrgDetails} from "@/oss/lib/Types"
import type {User} from "@/oss/lib/Types"
import {fetchAllOrgsList, fetchSingleOrg} from "@/oss/services/organization/api"

import {userAtom} from "../../profile/selectors/user"
import {sessionExistsAtom} from "../../session"
import {logAtom} from "../../utils/logAtom"
import {stringStorage} from "../../utils/stringStorage"

export const LS_ORG_KEY = "selectedOrg"

// 1) Storage-selected org id (compat)
export const selectedOrgIdStorageAtom = atomWithStorage<string | null>(
    LS_ORG_KEY,
    null,
    stringStorage,
)

// Local override used while navigation updates the URL
const selectedOrgIdOverrideAtom = atom<string | null>(null)

const routeChangePendingAtom = atom(false)

export const orgsQueryAtom = atomWithQuery<Org[]>((get) => {
    const userId = (get(userAtom) as User | null)?.id
    return {
        queryKey: ["orgs", userId || ""],
        queryFn: async () => {
            return await fetchAllOrgsList()
        },
        experimental_prefetchInRender: false,
        staleTime: 1000 * 60,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: false,
        enabled: !!userId,
    }
})

const logOrgs = process.env.NEXT_PUBLIC_LOG_ORG_ATOMS === "true"
logAtom(orgsQueryAtom, "orgsQueryAtom", logOrgs)

// Materialized orgs list from the query
const EmptyOrgs: Org[] = []
export const orgsAtom = eagerAtom<Org[]>((get) => {
    const res = (get(orgsQueryAtom) as any)?.data
    return res ?? EmptyOrgs
})

// Helper to read workspace id from URL (router already decodes)
const getWorkspaceIdFromURL = (): string | null => {
    if (typeof window === "undefined") return null
    const isParamToken = (value: string) => /^\[[^/]+\]$/.test(value)

    try {
        const path = window.location.pathname || ""
        let match = /\/w\/([^\/?#]+)/.exec(path)
        let segment = match ? match[1] : null
        if (segment && !isParamToken(segment)) return segment

        const q: any = (Router as any)?.query
        const raw = q?.org_id
        const fromQuery = Array.isArray(raw) ? raw[0] : raw
        if (typeof fromQuery === "string" && fromQuery && !isParamToken(fromQuery)) {
            return fromQuery
        }

        const asPath: string = ((Router as any)?.asPath as string) || ""
        const basePath = asPath.split(/[?#]/)[0] || ""
        match = /\/w\/([^\/?#]+)/.exec(basePath)
        segment = match ? match[1] : null
        if (segment && !isParamToken(segment)) return segment
        return null
    } catch {
        return null
    }
}

const routeChangeVersionAtom = atom(0)
observe((get, set) => {
    if (typeof window === "undefined") return

    const handleStart = () => set(routeChangePendingAtom, true)
    const handleDone = () => {
        set(routeChangePendingAtom, false)
        set(routeChangeVersionAtom, (value) => value + 1)
        set(selectedOrgIdOverrideAtom, null)
    }

    Router.events.on("routeChangeStart", handleStart)
    Router.events.on("routeChangeComplete", handleDone)
    Router.events.on("routeChangeError", handleDone)

    return () => {
        Router.events.off("routeChangeStart", handleStart)
        Router.events.off("routeChangeComplete", handleDone)
        Router.events.off("routeChangeError", handleDone)
    }
})

// 2) URL-selected org id (source of truth)
export const selectedOrgIdURLAtom = eagerAtom<string | null>((get) => {
    get(routeChangeVersionAtom)
    const id = getWorkspaceIdFromURL()
    if (!id) return null
    const orgs = get(orgsAtom)
    const org = orgs.find((org) => org.id === id)
    if (!org) return null
    return id
})

// 3) Unified selected org id atom: prefers URL, keeps storage in sync; setter updates URL
export const selectedOrgIdAtom = atom(
    (get) => {
        const pending = get(routeChangePendingAtom)
        const override = get(selectedOrgIdOverrideAtom)
        const fromUrl = get(selectedOrgIdURLAtom)
        const fromStorage = get(selectedOrgIdStorageAtom)

        let returnValue = override ?? fromStorage
        if (pending && override) {
            returnValue = typeof override === "string" ? override : null
        } else if (fromUrl) {
            returnValue = fromUrl
        }

        return returnValue
    },
    (get, set, next: string | null) => {
        const current = get(selectedOrgIdStorageAtom)
        const value = typeof next === "function" ? (next as any)(current) : next
        // Always sync storage
        set(selectedOrgIdStorageAtom, value)
        // Provide immediate feedback until navigation settles
        set(selectedOrgIdOverrideAtom, value)
        if (value !== null) {
            set(routeChangePendingAtom, true)
        }
    },
)

logAtom(selectedOrgIdAtom, "selectedOrgIdAtom", logOrgs)

type OrgWithMeta = Org & {
    type?: string | null
    is_demo?: boolean | null
}

const isDemoOrg = (org?: Partial<OrgWithMeta>) => {
    if (!org) return false
    if (org.is_demo === true) return true

    const orgType = typeof org.type === "string" ? org.type.toLowerCase() : ""
    if (orgType === "view-only" || orgType === "demo") return true

    const name = typeof org.name === "string" ? org.name.toLowerCase() : ""
    const description = typeof org.description === "string" ? org.description.toLowerCase() : ""

    if (name.includes("demo")) return true
    if (description.includes("demo")) return true

    return false
}

const pickFirstNonDemoOrg = (orgs?: Org[]) => {
    if (!Array.isArray(orgs) || orgs.length === 0) return null
    const nonDemo = orgs.find((org) => !isDemoOrg(org))
    return nonDemo ?? orgs[0]
}

const pickOwnedOrg = (userId: string | null, orgs?: Org[], nonDemoOnly = false) => {
    if (!userId || !Array.isArray(orgs)) return null
    const owned = orgs.filter((o) => o.owner === userId)
    if (!owned.length) return null
    if (!nonDemoOnly) return owned[0]
    const firstNonDemoOwned = owned.find((o) => !isDemoOrg(o))
    return firstNonDemoOwned ?? null
}

// Global effect to ensure selectedOrgId is valid once orgs load
observe((get, set) => {
    const result = get(orgsQueryAtom) as any
    const status: string | undefined = result?.status
    const orgs: Org[] | undefined = result?.data
    const currentId = get(selectedOrgIdAtom)
    const currentUserId = (get(userAtom) as User | null)?.id || null
    const currentOrg = currentId ? orgs?.find((org) => org.id === currentId) : undefined

    if (process.env.NEXT_PUBLIC_LOG_ORG_ATOMS === "true") {
        console.debug("[org] observe orgsQueryAtom", {status, currentId, count: orgs?.length ?? 0})
    }

    // Only act when the query has successfully resolved
    if (status !== "success") return

    // Do not auto-switch while a programmatic selection/navigation is in progress
    const pending = get(routeChangePendingAtom)
    // Or while on the invite acceptance route to avoid overriding the invited org
    const isAcceptRoute = (() => {
        try {
            const p = (Router as any)?.pathname as string | undefined
            const a = (Router as any)?.asPath as string | undefined
            return Boolean(
                (p && p.includes("/workspaces/accept")) || (a && a.includes("/workspaces/accept")),
            )
        } catch {
            return false
        }
    })()

    if (pending || isAcceptRoute) return

    const hasOrgs = Array.isArray(orgs) && orgs.length > 0
    const exists = !!currentOrg
    const preferredNonDemoOwned = pickOwnedOrg(currentUserId, orgs, true)
    const preferredAnyNonDemo = pickFirstNonDemoOrg(orgs)
    const preferredOwnedAny = pickOwnedOrg(currentUserId, orgs, false)
    const preferredId =
        preferredNonDemoOwned?.id ||
        preferredAnyNonDemo?.id ||
        preferredOwnedAny?.id ||
        orgs?.[0]?.id ||
        null
    const shouldUnset = !hasOrgs
    const currentIsDemo = isDemoOrg(currentOrg)

    if (shouldUnset) {
        if (currentId !== null) set(selectedOrgIdAtom, null)
        return
    }

    // Need switch if no current, current not found, or current is a demo org
    const needsSwitch = !currentId || !exists || currentIsDemo

    if (needsSwitch && preferredId) {
        const selected = get(selectedOrgIdAtom)
        if (selected !== preferredId) {
            set(selectedOrgIdAtom, preferredId)
            queryClient.invalidateQueries({queryKey: ["selectedOrg", preferredId]})
        }
    }
})

// Keep storage in sync with URL source of truth when available
observe((get, set) => {
    const fromUrl = get(selectedOrgIdURLAtom)
    const inStorage = get(selectedOrgIdStorageAtom)
    if (fromUrl && fromUrl !== inStorage) {
        set(selectedOrgIdStorageAtom, fromUrl)
    }
})

export const selectedOrgQueryAtom = atomWithQuery<OrgDetails | null>((get) => {
    const id = get(selectedOrgIdAtom)
    const userId = (get(userAtom) as User | null)?.id
    return {
        queryKey: ["selectedOrg", id],
        queryFn: async () => {
            return fetchSingleOrg({orgId: id})
        },
        experimental_prefetchInRender: false,
        staleTime: 1000 * 60,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: false,
        retry: (failureCount, error: any) => {
            // Do not retry on 4xx client errors; retry up to 2 times otherwise
            const status = error?.response?.status
            if (status && status >= 400 && status < 500) return false
            return failureCount < 2
        },
        onError: (error: any) => {
            if (process.env.NEXT_PUBLIC_LOG_ORG_ATOMS === "true") {
                console.debug("[org] selectedOrgQueryAtom error", {
                    status: error?.response?.status,
                    message: error?.message,
                })
            }
        },
        enabled: get(sessionExistsAtom) && !!id && !!userId,
    }
})

logAtom(selectedOrgQueryAtom, "selectedOrgQueryAtom", logOrgs)

export const selectedOrgAtom = eagerAtom<OrgDetails | null>((get) => {
    const res = (get(selectedOrgQueryAtom) as any)?.data
    return res ?? null
})
