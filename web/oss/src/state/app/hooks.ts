import {useCallback, useEffect} from "react"

import {useQueryClient} from "@tanstack/react-query"
import {useAtom, useAtomValue} from "jotai"

import {ListAppsItem} from "@/oss/lib/Types"
import {useAppState} from "@/oss/state/appState"

import {appsQueryAtom, recentAppIdAtom} from "./atoms/fetcher"
import {currentAppAtom, appsAtom} from "./selectors/app"

export const useApps = () => useAtom(appsQueryAtom)

export const useAppsData = () => {
    const [{data: apps, isPending, isLoading, error, refetch}] = useAtom(appsQueryAtom)
    const currentApp = useAtomValue(currentAppAtom)
    const [recentAppId, setRecentAppId] = useAtom(recentAppIdAtom)
    const queryClient = useQueryClient()
    const {appId} = useAppState()

    useEffect(() => {
        // Only set recent app from URL when it exists in the filtered apps list
        // This avoids enabling app-sidebar for SDK evaluation apps (filtered out)
        if (!appId) return
        if (Array.isArray(apps)) {
            const exists = (apps as ListAppsItem[]).some((app) => app.app_id === appId)
            if (exists) {
                if (recentAppId !== appId) setRecentAppId(appId)
            } else {
                if (recentAppId) setRecentAppId(null)
            }
        }
        // If apps haven't loaded yet, do nothing here; the fallback effect below will enforce validity once loaded
    }, [appId, apps, recentAppId, setRecentAppId])

    useEffect(() => {
        if (recentAppId && Array.isArray(apps)) {
            const exists = (apps as ListAppsItem[]).some((app) => app.app_id === recentAppId)
            if (!exists) setRecentAppId(null)
        }
    }, [apps, recentAppId, setRecentAppId])

    const reset = useCallback(() => {
        queryClient.removeQueries({queryKey: ["apps"]})
    }, [queryClient])

    return {
        currentApp: currentApp ?? null,
        apps: apps ?? [],
        error,
        isLoading,
        isPending,
        mutate: refetch,
        reset,
        recentlyVisitedAppId: recentAppId,
    }
}

export const useCurrentApp = () => useAtomValue(currentAppAtom)
export const useAppList = () => useAtomValue(appsAtom)
export default function AppListener() {
    return null
}
