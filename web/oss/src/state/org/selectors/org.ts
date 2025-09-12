import {atomWithStorage} from "jotai/utils"
import {eagerAtom} from "jotai-eager"
import {observe} from "jotai-effect"
import {atomWithQuery} from "jotai-tanstack-query"

import {queryClient} from "@/oss/lib/api/queryClient"
import {Org, OrgDetails} from "@/oss/lib/Types"
import type {User} from "@/oss/lib/Types"
import {fetchAllOrgsList, fetchSingleOrg} from "@/oss/services/organization/api"

import {userAtom} from "../../profile/selectors/user"
import {sessionExistsAtom} from "../../session"
import {logAtom} from "../../utils/logAtom"
import {stringStorage} from "../../utils/stringStorage"

export const LS_ORG_KEY = "selectedOrg"

export const selectedOrgIdAtom = atomWithStorage<string | null>(LS_ORG_KEY, null, stringStorage)

export const orgsQueryAtom = atomWithQuery<Org[]>((get) => {
    const userId = (get(userAtom) as User | null)?.id
    return {
        queryKey: ["orgs", userId || ""],
        queryFn: async () => {
            const data = await fetchAllOrgsList()
            return data
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
logAtom(selectedOrgIdAtom, "selectedOrgIdAtom", logOrgs)

// Global effect to ensure selectedOrgId is valid once orgs load
observe((get, set) => {
    const result = get(orgsQueryAtom) as any
    const status: string | undefined = result?.status
    const orgs: Org[] | undefined = result?.data
    const currentId = get(selectedOrgIdAtom)

    if (process.env.NEXT_PUBLIC_LOG_ORG_ATOMS === "true") {
        console.debug("[org] observe orgsQueryAtom", {status, currentId, count: orgs?.length ?? 0})
    }

    // Only act when the query has successfully resolved
    if (status !== "success") return

    const hasOrgs = Array.isArray(orgs) && orgs.length > 0
    const exists = currentId ? orgs?.some((o) => o.id === currentId) : false

    if (!hasOrgs) {
        if (currentId !== null) set(selectedOrgIdAtom, null)
    } else if (!currentId || !exists) {
        const orgId = orgs![0].id
        const selected = get(selectedOrgIdAtom)

        if (selected !== orgId) {
            set(selectedOrgIdAtom, orgs![0].id)
            queryClient.invalidateQueries({queryKey: ["selectedOrg", orgId]})
        }
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

const EmptyOrgs: Org[] = []
export const orgsAtom = eagerAtom<Org[]>((get) => {
    const res = (get(orgsQueryAtom) as any)?.data
    return res ?? EmptyOrgs
})

export const selectedOrgAtom = eagerAtom<OrgDetails | null>((get) => {
    const res = (get(selectedOrgQueryAtom) as any)?.data
    return res ?? null
})
