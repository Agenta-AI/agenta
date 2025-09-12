import {eagerAtom} from "jotai-eager"

import {ListAppsItem} from "@/oss/lib/Types"
import {appStatusAtom} from "@/oss/state/variant/atoms/appStatus"
import {appStatusLoadingAtom} from "@/oss/state/variant/atoms/fetcher"

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

// Centralized selector to determine if Playground should render for current app
export const shouldRenderPlaygroundAtom = eagerAtom<boolean>((get) => {
    const appId = get(routerAppIdAtom) || get(recentAppIdAtom)
    const q: any = get(appsQueryAtom)
    const isPending = Boolean(q?.isPending)
    const data: ListAppsItem[] = (q?.data as any) ?? []
    const app = appId ? data.find((item) => item.app_id === appId) : null

    // If apps list hasn't loaded yet, allow render (components can handle skeletons)
    if (isPending) return true

    // Block entirely for invalid/legacy apps
    const isInvalid = app && (!app.app_type || String(app.app_type).includes(" (old)"))
    if (isInvalid) return false

    // If no app found, do not block rendering
    if (!app) return true

    // Leverage app service status to decide rendering for custom apps
    const isLoading = get(appStatusLoadingAtom)
    const isUp = get(appStatusAtom)

    // For non-custom apps, render regardless of status checks
    if (app.app_type !== "custom") return true

    // For custom apps: render while loading or if up; block only when definitively down
    if (isLoading) return true
    return Boolean(isUp)
})
