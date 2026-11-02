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

/** Counts screen setups, so a reset queued by a cleanup can tell a later setup ran first. */
let scopeGeneration = 0

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

    // Leaving the screen puts the scope back to project wide. The reset waits a microtask, and a
    // screen that sets up again before then (the StrictMode replay) cancels it, so the mounted
    // queries never see a project wide scope while the screen is still there.
    useEffect(() => {
        scopeGeneration += 1
        return () => {
            const generation = scopeGeneration
            queueMicrotask(() => {
                if (generation === scopeGeneration) store.set(observabilityAppIdAtom, null)
            })
        }
    }, [store])

    // Sets the scope again after mount: React StrictMode runs every cleanup, then every setup, so
    // the cleanup above alone would leave the queries project wide under a picker that names an
    // app. It is its own effect, without a cleanup, so an app change never passes through null.
    useEffect(() => {
        if (!enabled) return
        store.set(bindObservabilityScopeAtom, mobileObservabilityScopeAtom)
        store.set(observabilityAppIdAtom, appId)
    }, [store, enabled, appId])
}
