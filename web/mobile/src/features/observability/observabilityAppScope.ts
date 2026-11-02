import {useEffect} from "react"

import {bindObservabilityScopeAtom, type ObservabilityScope} from "@agenta/observability"
import {atom, useStore} from "jotai"
import type {NextRouter} from "next/router"

import {currentQuery} from "./bindTraceDrawerSeams"

/** The app the observability screen is narrowed to, or `null` for the whole project. */
const observabilityAppIdAtom = atom<string | null>(null)

/**
 * Both fields carry the picked app. The package gives `appId` a "last used app" fallback on the
 * old app's project pages, which would send an app id with no matching filter row.
 */
const mobileObservabilityScopeAtom = atom((get): ObservabilityScope => {
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

type Store = ReturnType<typeof useStore>

/** Writes only on a change, so a screen that never picks an app never binds the scope. */
const writeAppScope = (store: Store, appId: string | null) => {
    if (store.get(observabilityAppIdAtom) === appId) return
    store.set(bindObservabilityScopeAtom, mobileObservabilityScopeAtom)
    store.set(observabilityAppIdAtom, appId)
}

/**
 * Scopes the traces and sessions queries to `appId`, or project wide for `null`.
 *
 * Written during render, before the children that run the queries render: an effect alone would
 * let a project wide request go out first. Leaving the screen puts the scope back to project wide,
 * because the global trace drawer reads it on every page.
 */
export const useObservabilityAppScope = (appId: string | null) => {
    const store = useStore()
    writeAppScope(store, appId)

    // Again after mount: the StrictMode replay runs the cleanup below while the screen stays.
    // Kept apart from the cleanup, so an app change never passes through project wide.
    useEffect(() => writeAppScope(store, appId), [store, appId])
    useEffect(() => () => writeAppScope(store, null), [store])
}
