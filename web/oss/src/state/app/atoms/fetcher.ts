import {atom} from "jotai"
import {atomFamily, atomWithStorage} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {ListAppsItem, User} from "@/oss/lib/Types"
import {fetchAppContainerURL} from "@/oss/services/api"
import {fetchAllApps} from "@/oss/services/app"

import {userAtom, profileQueryAtom} from "../../profile/selectors/user"
import {projectIdAtom} from "../../project/selectors/project"
import {jwtReadyAtom} from "../../session/jwt"
import {devLog} from "../../utils/devLog"
import {stringStorage} from "../../utils/stringStorage"

const baseRouterAppIdAtom = atom<string | null>(null)

export const routerAppIdAtom = atom(
    (get) => {
        const appId = get(baseRouterAppIdAtom)

        // In test environment, fall back to environment variable if not set
        if (!appId && typeof process !== "undefined" && process.env.NODE_ENV === "test") {
            return process.env.VITEST_TEST_APP_ID || process.env.TEST_APP_ID || null
        }

        return appId
    },
    (get, set, update: string | null) => {
        set(baseRouterAppIdAtom, update)
    },
)

export const LS_APP_KEY = "recentlyVisitedApp"

export const recentAppIdAtom = atomWithStorage<string | null>(LS_APP_KEY, null, stringStorage)

export const appsQueryAtom = atomWithQuery<ListAppsItem[]>((get) => {
    const projectId = get(projectIdAtom)
    const profileState = get(profileQueryAtom)
    const user = get(userAtom) as User | null
    const isProj = !!projectId
    const jwtReady = get(jwtReadyAtom).data ?? false
    const enabled = profileState.isSuccess && jwtReady && !!user?.id && isProj && !!projectId

    return {
        queryKey: ["apps", projectId],
        queryFn: async () => {
            const data = await fetchAllApps()
            return data
        },
        staleTime: 1000 * 60, // 1 minute
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: false,
        enabled,
    }
})

/**
 * Atom family for fetching app container URIs
 * Creates focused atoms for specific app+variant combinations
 */
export const uriQueryAtomFamily = atomFamily((params: {appId: string; variantId?: string}) =>
    atomWithQuery<string>(() => {
        const {appId, variantId} = params

        return {
            queryKey: ["uri", appId, variantId],
            queryFn: async () => {
                const url = await fetchAppContainerURL(appId, variantId)
                return `${url}/run`
            },
            staleTime: 1000 * 60 * 5, // 5 minutes - URIs don't change often
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            refetchOnMount: false,
            enabled: !!variantId, // Only fetch when variantId is provided
            retry: (failureCount, error) => {
                // Don't retry if it's a 404 or similar client error
                if (
                    (error as any)?.response?.status >= 400 &&
                    (error as any)?.response?.status < 500
                ) {
                    return false
                }
                return failureCount < 3
            },
        }
    }),
)

const logApps = process.env.NEXT_PUBLIC_LOG_APP_ATOMS === "true"

;[appsQueryAtom, routerAppIdAtom, recentAppIdAtom].forEach((a, i) =>
    devLog(a as any, ["appsQueryAtom", "routerAppIdAtom", "recentAppIdAtom"][i], logApps),
)
