import {atom} from "jotai"
import {atomFamily, atomWithStorage} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {ListAppsItem, User} from "@/oss/lib/Types"
import {fetchAppContainerURL} from "@/oss/services/api"
import {fetchAllApps} from "@/oss/services/app"
import {appIdentifiersAtom, appStateSnapshotAtom, requestNavigationAtom} from "@/oss/state/appState"
import {activeInviteAtom} from "@/oss/state/url/auth"

import {selectedOrgIdAtom} from "../../org"
import {userAtom, profileQueryAtom} from "../../profile/selectors/user"
import {projectIdAtom} from "../../project/selectors/project"
import {jwtReadyAtom} from "../../session/jwt"
import {devLog} from "../../utils/devLog"
import {stringStorage} from "../../utils/stringStorage"
import {LS_APP_KEY} from "../assets/constants"

const baseRouterAppIdAtom = atom<string | null>(null)

const shouldResetEvaluationContextOnAppSwitch = ({
    restPath,
    pathname,
}: {
    restPath: string[]
    pathname: string
}) =>
    (restPath[0] === "evaluations" && restPath[1] === "results") ||
    pathname.includes("/evaluations/results")

export const routerAppIdAtom = atom(
    (get) => {
        const derived = get(appIdentifiersAtom).appId
        if (derived) return derived
        const fallback = get(baseRouterAppIdAtom)
        if (fallback) return fallback
        if (typeof process !== "undefined" && process.env.NODE_ENV === "test") {
            return process.env.VITEST_TEST_APP_ID || process.env.TEST_APP_ID || null
        }
        return null
    },
    (get, set, update: string | null) => {
        const next =
            typeof update === "function" ? (update as any)(get(baseRouterAppIdAtom)) : update
        set(baseRouterAppIdAtom, next)
    },
)

export const routerAppNavigationAtom = atom(null, (get, set, next: string | null) => {
    const identifiers = get(appIdentifiersAtom)
    const {workspaceId, projectId, appId: current} = identifiers
    if (!workspaceId || !projectId) return

    if (!next) {
        const href = `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(projectId)}/apps`
        set(requestNavigationAtom, {type: "href", href, method: "replace"})
        return
    }

    if (next === current) return

    const base = `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(projectId)}/apps/${encodeURIComponent(next)}`
    const snapshot = get(appStateSnapshotAtom)
    const rest = snapshot.routeLayer === "app" ? snapshot.restPath : []
    const nextRest = shouldResetEvaluationContextOnAppSwitch({
        restPath: rest,
        pathname: snapshot.pathname,
    })
        ? ["evaluations"]
        : rest
    const href = nextRest.length ? `${base}/${nextRest.join("/")}` : `${base}/overview`
    set(requestNavigationAtom, {type: "href", href, method: "push"})
})

export const recentAppIdAtom = atomWithStorage<string | null>(LS_APP_KEY, null, stringStorage)

export const appsQueryAtom = atomWithQuery<ListAppsItem[]>((get) => {
    const projectId = get(projectIdAtom)
    const profileState = get(profileQueryAtom)
    const user = get(userAtom) as User | null
    const isProj = !!projectId
    const jwtReady = get(jwtReadyAtom).data ?? false
    const organizationId = get(selectedOrgIdAtom)
    const activeInvite = get(activeInviteAtom)
    const enabled =
        profileState.isSuccess &&
        jwtReady &&
        !!user?.id &&
        isProj &&
        !!projectId &&
        !!organizationId &&
        !activeInvite

    return {
        queryKey: ["apps", projectId],
        queryFn: async () => {
            const data = await fetchAllApps(projectId)
            return data.filter((app) => app.app_type !== "custom (sdk)")
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
    atomWithQuery<string>((get) => {
        const {appId, variantId} = params
        const projectId = get(projectIdAtom)

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
            enabled: !!projectId && !!variantId, // Only fetch when variantId is provided
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

export const appDetailQueryAtomFamily = atomFamily((appId: string | null) =>
    atomWithQuery<ListAppsItem | null>((get) => {
        const projectId = get(projectIdAtom)

        return {
            queryKey: ["app", appId, projectId],
            queryFn: async () => {
                if (!appId) return null
                const {data} = await axios.get(
                    `${getAgentaApiUrl()}/apps/${encodeURIComponent(appId)}?project_id=${projectId}`,
                )
                return data as ListAppsItem
            },
            staleTime: 1000 * 60,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            refetchOnMount: false,
            enabled: !!projectId && !!appId,
        }
    }),
)

const logApps = process.env.NEXT_PUBLIC_LOG_APP_ATOMS === "true"

;[appsQueryAtom, routerAppIdAtom, recentAppIdAtom].forEach((a, i) =>
    devLog(a as any, ["appsQueryAtom", "routerAppIdAtom", "recentAppIdAtom"][i], logApps),
)
