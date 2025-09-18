import {useCallback, useEffect} from "react"

import {useQueryClient} from "@tanstack/react-query"
import {useAtom, useSetAtom, useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {ListAppsItem} from "@/oss/lib/Types"

import {appsQueryAtom, routerAppIdAtom, recentAppIdAtom} from "./atoms/fetcher"
import {currentAppAtom, appsAtom} from "./selectors/app"

export const useApps = () => useAtom(appsQueryAtom)

export const useAppsData = () => {
    const router = useRouter()
    const [{data: apps, isPending, isLoading, error, refetch}] = useAtom(appsQueryAtom)
    const currentApp = useAtomValue(currentAppAtom)
    const [recentAppId, setRecentAppId] = useAtom(recentAppIdAtom)
    const setRouterAppId = useSetAtom(routerAppIdAtom)
    const queryClient = useQueryClient()

    useEffect(() => {
        const id = router.query.app_id as string | undefined
        setRouterAppId(id || null)
        if (id) setRecentAppId(id)
    }, [router.query.app_id, setRouterAppId, setRecentAppId])

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

const AppListener = () => {
    const router = useRouter()
    const setAppId = useSetAtom(routerAppIdAtom)
    const setRecent = useSetAtom(recentAppIdAtom)
    useEffect(() => {
        const id = router.query.app_id as string | undefined
        setAppId(id || null)
        if (id) setRecent(id)
    }, [router.query.app_id, setAppId, setRecent])
    return null
}

export default AppListener
