import {eagerAtom} from "jotai-eager"

import {ListAppsItem} from "@/oss/lib/Types"

import {appsQueryAtom, routerAppIdAtom, recentAppIdAtom} from "../atoms/fetcher"

const EmptyApps: ListAppsItem[] = []
export const appsAtom = eagerAtom<ListAppsItem[]>((get) => {
    const res = (get(appsQueryAtom) as any)?.data
    return res ?? EmptyApps
})

export const selectedAppIdAtom = eagerAtom<string | null>((get) => {
    return get(routerAppIdAtom) || get(recentAppIdAtom) || null
})

export const currentAppAtom = eagerAtom<ListAppsItem | null>((get) => {
    const apps = get(appsAtom) as ListAppsItem[]
    const appId = get(routerAppIdAtom) || get(recentAppIdAtom)
    if (!appId) return null
    return apps.find((a) => a.app_id === appId) || null
})

// Convenience re-exports for consumers needing raw ID atoms
export {routerAppIdAtom, recentAppIdAtom}

// Note: shouldRenderPlaygroundAtom has been moved to the Playground module
// to break the transitive dependency on legacy variant atoms.
// Import from: @/oss/components/Playground/state/atoms/playgroundAppAtoms

/**
 * Current app context - provides full context for current app
 * Used by: Components that need current app info
 */
export const currentAppContextAtom = eagerAtom((get) => {
    const currentApp = get(currentAppAtom)
    const selectedId = get(selectedAppIdAtom)
    const {isLoading} = get(appsQueryAtom)

    return {
        app: currentApp,
        appId: selectedId,
        appName: currentApp?.app_name || null,
        appType: currentApp?.app_type || null,
        hasApp: !!currentApp,
        loading: isLoading,
    }
})
