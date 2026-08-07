import {useCallback, useEffect} from "react"

import {invalidateWorkflowsListCache} from "@agenta/entities/workflow"
import {useAtom, useAtomValue} from "jotai"

import {useAppState} from "@/oss/state/appState"

import {appsQueryAtom, currentAppQueryAtom, recentAppIdAtom} from "./atoms/fetcher"
import {currentAppAtom, appsAtom} from "./selectors/app"

/**
 * @deprecated for new code. Use `useWorkflowsData()` from `@/oss/state/workflow`
 * for workflow-typed access (returns combined apps + evaluators with per-type
 * filters and unified loading state). Existing callers remain supported —
 * `useAppsData()` still returns apps only.
 *
 * NOTE: this no longer WRITES `recentAppIdAtom`. Recent-app tracking moved to the
 * single always-mounted writer `useRecentAppTracker()` (mounted by Layout) — two
 * writers with different validity criteria (non-archived-list membership here vs
 * by-id there) ping-ponged the atom into an infinite render loop.
 */
export const useAppsData = () => {
    const {data: apps, isPending, isLoading, error, refetch} = useAtomValue(appsQueryAtom)
    const currentApp = useAtomValue(currentAppAtom)
    const recentAppId = useAtomValue(recentAppIdAtom)

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

/**
 * Marks/prunes `recentAppIdAtom` from the current route. Writer-only: mount once
 * in an always-rendered spot (Layout); consumers read the atom directly.
 *
 * Validity is resolved by id (`currentAppQueryAtom`), not full-list membership,
 * so it doesn't force the whole apps catalog to load on every app-scoped page.
 *
 * SOLE authoritative writer BY DESIGN: a second writer with different validity
 * criteria (e.g. the old `useAppsData` list-membership effects) ping-pongs the
 * atom — one marks `appId`, the other prunes it — an infinite render loop.
 */
export const useRecentAppTracker = () => {
    const currentApp = useAtomValue(currentAppAtom)
    const {isPending: isCurrentAppPending} = useAtomValue(currentAppQueryAtom)
    const [recentAppId, setRecentAppId] = useAtom(recentAppIdAtom)
    const {appId, routeLayer} = useAppState()

    useEffect(() => {
        if (routeLayer !== "app" || !appId || isCurrentAppPending) return
        const isValidApp = currentApp?.id === appId && !currentApp?.flags?.is_evaluator
        if (isValidApp) {
            if (recentAppId !== appId) setRecentAppId(appId)
        } else if (recentAppId) {
            setRecentAppId(null)
        }
    }, [routeLayer, appId, currentApp, isCurrentAppPending, recentAppId, setRecentAppId])
}
