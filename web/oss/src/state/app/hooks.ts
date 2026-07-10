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
 * single always-mounted writer `useCurrentAppLite()` (the sidebar) — two writers
 * with different validity criteria (non-archived-list membership here vs by-id
 * there) ping-ponged the atom into an infinite render loop.
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
 * Lightweight current-app access for always-mounted consumers (e.g. the sidebar)
 * that need only the CURRENT app + recent id — NOT the whole apps catalog.
 *
 * Unlike `useAppsData`, this does NOT subscribe to the apps list (`appsQueryAtom`),
 * so it doesn't force the entire catalog to load on every app-scoped page. The
 * current app is resolved by id (`currentAppQueryAtom`), and recent-app
 * marking/pruning is derived from that single by-id result instead of full-list
 * membership.
 */
export const useCurrentAppLite = () => {
    const currentApp = useAtomValue(currentAppAtom)
    const {isPending: isCurrentAppPending} = useAtomValue(currentAppQueryAtom)
    const [recentAppId, setRecentAppId] = useAtom(recentAppIdAtom)
    const {appId, routeLayer} = useAppState()

    // SOLE authoritative writer for `recentAppIdAtom` (the sidebar that mounts this
    // is present on every app route). Mirrors the old `useAppsData` marking, but
    // resolves "is this a valid app?" by id (`currentApp`) instead of full-list
    // membership — so it doesn't force the whole apps catalog to load.
    //
    // Single writer BY DESIGN: running this alongside another recent-app writer
    // with different criteria (by-id here vs non-archived-list membership in the
    // old `useAppsData` effects) ping-pongs the atom — one marks `appId`, the other
    // prunes it — which is an infinite render loop. `useAppsData`'s writers were
    // removed for exactly this reason.
    useEffect(() => {
        if (routeLayer !== "app" || !appId || isCurrentAppPending) return
        const isValidApp = currentApp?.id === appId && !currentApp?.flags?.is_evaluator
        if (isValidApp) {
            if (recentAppId !== appId) setRecentAppId(appId)
        } else if (recentAppId) {
            setRecentAppId(null)
        }
    }, [routeLayer, appId, currentApp, isCurrentAppPending, recentAppId, setRecentAppId])

    return {currentApp: currentApp ?? null, recentlyVisitedAppId: recentAppId}
}
