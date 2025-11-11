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
        if (appId) setRecentAppId(appId)
    }, [appId, setRecentAppId])

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
