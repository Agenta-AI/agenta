export * from "./atoms/fetcher"
export * from "./atoms/templates"
export * from "./atoms/vault"
export * from "./selectors/app"
export * from "./hooks"
export * from "./hooks/useTemplates"
export * from "./hooks/useURI"
export * from "./hooks/useVaultSecret"

import {getDefaultStore} from "jotai"
import {loadable} from "jotai/vanilla/utils"
import {queryClientAtom} from "jotai-tanstack-query"
import Router from "next/router"

import {ListAppsItem} from "@/oss/lib/Types"

import {appsQueryAtom, routerAppIdAtom, recentAppIdAtom} from "./atoms/fetcher"

export const getAppValues = () => {
    const store = getDefaultStore()
    const appsState = store.get(loadable(appsQueryAtom))
    const rawApps = appsState.state === "hasData" ? appsState.data.data : []
    const apps: ListAppsItem[] = Array.isArray(rawApps) ? rawApps : []
    let appId = store.get(routerAppIdAtom) || store.get(recentAppIdAtom)

    if (!appId && typeof window !== "undefined") {
        try {
            appId = (Router.query.app_id as string) || null
        } catch {
            /* ignore */
        }
    }
    const currentApp = apps.find((a) => a.app_id === appId) || null
    return {apps, currentApp}
}

export const resetAppData = () => {
    const store = getDefaultStore()
    const queryClient = store.get(queryClientAtom)
    queryClient.removeQueries({queryKey: ["apps"]})
    store.set(routerAppIdAtom, null)
}
