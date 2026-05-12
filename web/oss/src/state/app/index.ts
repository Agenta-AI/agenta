export * from "./atoms/fetcher"
export * from "./atoms/templates"
export * from "./atoms/vault"
export * from "./selectors/app"
export * from "./hooks"
export * from "./hooks/useTemplates"
export * from "./hooks/useVaultSecret"

import {invalidateWorkflowsListCache} from "@agenta/entities/workflow"
import {getDefaultStore} from "jotai"

import {appIdentifiersAtom} from "../appState"

import {
    appsQueryAtom,
    routerAppIdAtom,
    routerAppNavigationAtom,
    recentAppIdAtom,
} from "./atoms/fetcher"

export const getAppValues = () => {
    const store = getDefaultStore()
    const appsResult = store.get(appsQueryAtom)
    const apps = Array.isArray(appsResult.data) ? appsResult.data : []
    const identifiers = store.get(appIdentifiersAtom)
    const appId = identifiers.appId || store.get(recentAppIdAtom)
    const currentApp = apps.find((a) => a.id === appId) || null
    return {apps, currentApp}
}

export const resetAppData = () => {
    const store = getDefaultStore()
    invalidateWorkflowsListCache()
    store.set(routerAppIdAtom, null)
    store.set(routerAppNavigationAtom, null)
}
