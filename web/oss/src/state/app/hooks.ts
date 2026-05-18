import {useCallback, useEffect} from "react"

import {invalidateWorkflowsListCache, type Workflow} from "@agenta/entities/workflow"
import {useAtom, useAtomValue} from "jotai"

import {useAppState} from "@/oss/state/appState"

import {appsQueryAtom, recentAppIdAtom} from "./atoms/fetcher"
import {currentAppAtom, appsAtom} from "./selectors/app"

/**
 * @deprecated for new code. Use `useWorkflowsData()` from `@/oss/state/workflow`
 * for workflow-typed access (returns combined apps + evaluators with per-type
 * filters and unified loading state). Existing callers remain supported —
 * `useAppsData()` still returns apps only and is the authoritative writer for
 * `recentAppIdAtom`.
 */
export const useAppsData = () => {
    const {data: apps, isPending, isLoading, error, refetch} = useAtomValue(appsQueryAtom)
    const currentApp = useAtomValue(currentAppAtom)
    const [recentAppId, setRecentAppId] = useAtom(recentAppIdAtom)
    const {appId, routeLayer} = useAppState()

    useEffect(() => {
        // Only set recent app when user is actually on an app-level route (routeLayer === "app")
        // This avoids updating recentAppId when appId comes from query params (e.g., ?app_id=...)
        // on project-level pages like evaluation results
        if (!appId) return
        if (routeLayer !== "app") return
        if (Array.isArray(apps)) {
            const exists = (apps as Workflow[]).some((app) => app.id === appId)
            if (exists) {
                if (recentAppId !== appId) setRecentAppId(appId)
            } else {
                if (recentAppId) setRecentAppId(null)
            }
        }
        // If apps haven't loaded yet, do nothing here; the fallback effect below will enforce validity once loaded
    }, [appId, apps, recentAppId, routeLayer, setRecentAppId])

    useEffect(() => {
        if (recentAppId && Array.isArray(apps)) {
            const exists = (apps as Workflow[]).some((app) => app.id === recentAppId)
            if (!exists) setRecentAppId(null)
        }
    }, [apps, recentAppId, setRecentAppId])

    const reset = useCallback(() => {
        invalidateWorkflowsListCache()
    }, [])

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
