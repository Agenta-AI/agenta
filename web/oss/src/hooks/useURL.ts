import {useCallback} from "react"

import {useAtomValue} from "jotai"

import {useAppNavigation, useAppState} from "@/oss/state/appState"
import {urlAtom} from "@/oss/state/url"

const useURL = () => {
    const url = useAtomValue(urlAtom)
    const navigation = useAppNavigation()
    const appState = useAppState()

    const buildUrl = useCallback(
        ({
            workspaceName,
            appId: _appId,
            path = "",
            query = {},
            isAppUrl = false,
            onlyWs = false,
        }: {
            workspaceName?: string
            appId?: string
            path?: string
            query?: Record<string, any>
            isAppUrl?: boolean
            onlyWs?: boolean
        } = {}) => {
            // Treat workspaceName param as an id for URL purposes
            const wsId = workspaceName || url.workspaceId
            const organization = `${url.baseOrganizationURL}/${encodeURIComponent(wsId)}`
            let target = organization

            if (!onlyWs) {
                if (url.projectId) {
                    target += `/p/${url.projectId}/apps`
                } else {
                    // If project is not ready yet, fall back to organization root
                    return organization
                }
            }

            if (isAppUrl) {
                target += `/${encodeURIComponent(_appId || url.appId)}`
            }

            if (path) {
                target += path.startsWith("/") ? path : `/${path}`
            }

            const searchParams = new URLSearchParams(query as any)
            const queryString = searchParams.toString()
            if (queryString) {
                target += `?${queryString}`
            }

            return target
        },
        [url.appId, url.workspaceId, url.projectId, url.baseOrganizationURL],
    )

    const redirectUrl = useCallback(
        (params?: Parameters<typeof buildUrl>[0]) => {
            const url = buildUrl(params)
            navigation.push(url)
        },
        [buildUrl, navigation],
    )

    // Determine if the given path (or current asPath) is a valid app route
    const isValidAppRoute = useCallback(
        (path?: string) => {
            const pathOnly = (path ?? appState.asPath ?? "").split("?")[0]
            const isAtOrganizationRoot = pathOnly === "/w"
            const isAtWsRoot = /^\/w\/[^/]+$/.test(pathOnly)
            const isAtWsProjectRoot = /^\/w\/[^/]+\/p\/?$/.test(pathOnly)
            const hasReadyBase = Boolean(url.baseAppURL)
            const isUnderAppBase = hasReadyBase && pathOnly.startsWith(url.baseAppURL)
            // Fallback regex when baseAppURL isn't ready yet
            const matchesValidAppPattern = /^\/w\/[^/]+\/p\/[^/]+\/apps(\/|$)/.test(pathOnly)
            const validLocation = hasReadyBase ? isUnderAppBase : matchesValidAppPattern
            return !isAtOrganizationRoot && !isAtWsRoot && !isAtWsProjectRoot && validLocation
        },
        [appState.asPath, url.baseAppURL],
    )

    return {
        appId: url.appId,
        workspaceId: url.workspaceId,
        workspaceName: url.workspaceName,
        baseURL: url.baseAppURL,
        buildUrl,
        redirectUrl,
        baseOrganizationURL: url.baseOrganizationURL,
        organizationURL: url.organizationURL,
        baseProjectURL: url.baseProjectURL,
        projectURL: url.projectURL,
        baseAppURL: url.baseAppURL,
        recentlyVisitedAppURL: url.recentlyVisitedAppURL,
        appURL: url.appURL,
        isValidAppRoute,
    }
}

export default useURL
