import {useEffect} from "react"

import {bindObservabilityScopeAtom, type ObservabilityScope} from "@agenta/observability"
import {atom, useStore} from "jotai"
import type {NextRouter} from "next/router"

import {currentQuery} from "./bindTraceDrawerSeams"

/** The app the observability screen is narrowed to, or `null` for the whole project. */
export const observabilityAppIdAtom = atom<string | null>(null)

/**
 * Both fields carry the picked app. The package gives `appId` a "last used app" fallback on the
 * old app's project pages, which would send an app id with no matching filter row.
 */
export const mobileObservabilityScopeAtom = atom((get): ObservabilityScope => {
    const appId = get(observabilityAppIdAtom)
    return {appId, routeAppId: appId}
})

/** Writes `?app=` keeping the other params (`trace`, `span`); `null` removes it. */
export const setObservabilityAppInUrl = (router: NextRouter, appId: string | null) => {
    const query = currentQuery(router, window.location.search)
    if (appId) query.app = appId
    else delete query.app
    void router.replace({pathname: router.pathname, query}, undefined, {shallow: true})
}

/**
 * Scopes the traces and sessions queries to `routeAppId` while `enabled`.
 *
 * The scope is set during render, before the children that read it, not only in an effect: the
 * queries read it when their components render, so an effect alone would let a project-wide
 * request go out before the app. The write only happens when the app changed. Leaving the screen
 * puts the scope back to project wide.
 */
export const useObservabilityAppScope = (routeAppId: string | null, enabled: boolean) => {
    const store = useStore()
    const appId = enabled ? routeAppId : null

    if (enabled) {
        store.set(bindObservabilityScopeAtom, mobileObservabilityScopeAtom)
        if (store.get(observabilityAppIdAtom) !== appId) store.set(observabilityAppIdAtom, appId)
    }

    useEffect(() => () => store.set(observabilityAppIdAtom, null), [store])
}
