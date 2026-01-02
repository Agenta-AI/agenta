import type {ParsedUrlQuery} from "querystring"

import {atom, getDefaultStore} from "jotai"
import type {Store} from "jotai/vanilla/store"
import Router from "next/router"

import {parseRouterState, setLocationAtom} from "@/oss/state/appState"
import {sessionLoadingAtom} from "@/oss/state/session"
import focusDrawerState from "@/oss/state/url/focusDrawer"

import {syncAuthStateFromUrl} from "./auth"
import {syncPlaygroundStateFromUrl} from "./playground"
import {syncSessionStateFromUrl} from "./session"
import {syncTraceStateFromUrl} from "./trace"
import {syncVariantStateFromUrl} from "./variant"

export {activeInviteAtom, protectedRouteReadyAtom} from "./auth"
export {clearSessionParamAtom, clearSessionQueryParam, sessionIdAtom} from "./session"
export {clearTraceParamAtom, clearTraceQueryParam, traceIdAtom} from "./trace"

const isBrowser = typeof window !== "undefined"

let lastLocationSignature: string | null = null

const buildQueryFromUrl = (url: URL): ParsedUrlQuery => {
    const query: ParsedUrlQuery = {}
    url.searchParams.forEach((value, key) => {
        if (query[key] === undefined) {
            query[key] = value
            return
        }
        if (Array.isArray(query[key])) {
            ;(query[key] as string[]).push(value)
            return
        }
        query[key] = [query[key] as string, value]
    })
    return query
}

const syncAppLocation = (store: Store, nextUrl?: string) => {
    if (!isBrowser) return
    try {
        let pathname = Router.pathname
        let asPath = Router.asPath
        let query: ParsedUrlQuery = Router.query

        if (nextUrl) {
            const url = new URL(nextUrl, window.location.origin)
            pathname = url.pathname
            asPath = `${url.pathname}${url.search}${url.hash}`
            query = buildQueryFromUrl(url)
        }

        const parsed = parseRouterState({pathname, asPath, query})
        const signature = `${parsed.pathname}|${parsed.asPath}`
        if (signature === lastLocationSignature) return
        lastLocationSignature = signature
        store.set(setLocationAtom, parsed)
    } catch (error) {
        console.error("Failed to sync app location from URL:", nextUrl, error)
    }
}

const syncUrlState = (nextUrl?: string) => {
    const store = getDefaultStore()
    syncAppLocation(store, nextUrl)
    syncTraceStateFromUrl(nextUrl)
    syncSessionStateFromUrl(nextUrl)
    syncVariantStateFromUrl(nextUrl)

    if (typeof focusDrawerState?.syncFocusDrawerStateFromUrl === "function") {
        focusDrawerState.syncFocusDrawerStateFromUrl(nextUrl)
    }
    syncPlaygroundStateFromUrl(nextUrl)
    syncAuthStateFromUrl(nextUrl)
}

export const urlQuerySyncAtom = atom(0)

urlQuerySyncAtom.onMount = (set) => {
    if (!isBrowser) return

    const store = getDefaultStore()

    const notify = () => set((prev) => prev + 1)

    const handleRouteChange = (nextUrl: string) => {
        syncUrlState(nextUrl)
        notify()
    }

    const handleHashChange = () => {
        syncUrlState()
        notify()
    }

    let lastSessionLoading = store.get(sessionLoadingAtom)
    const unsubSessionLoading = store.sub(sessionLoadingAtom, () => {
        const current = store.get(sessionLoadingAtom)
        if (lastSessionLoading && !current) {
            syncAuthStateFromUrl()
        }
        lastSessionLoading = current
    })
    syncUrlState()

    Router.events.on("beforeHistoryChange", handleRouteChange)
    Router.events.on("routeChangeComplete", handleRouteChange)
    window.addEventListener("hashchange", handleHashChange)

    return () => {
        Router.events.off("beforeHistoryChange", handleRouteChange)
        Router.events.off("routeChangeComplete", handleRouteChange)
        window.removeEventListener("hashchange", handleHashChange)
        unsubSessionLoading()
    }
}

export const clearVariantQueryParam = () => {
    if (!isBrowser) return
    try {
        const url = new URL(window.location.href)
        const hadRevisionParam = url.searchParams.has("revisionId")
        const hadLegacyParam = url.searchParams.has("revisions")
        const hadDrawerTypeParam = url.searchParams.has("drawerType")
        if (!hadRevisionParam && !hadLegacyParam && !hadDrawerTypeParam) return

        if (hadRevisionParam) {
            url.searchParams.delete("revisionId")
        }
        if (hadLegacyParam) {
            url.searchParams.delete("revisions")
        }
        if (hadDrawerTypeParam) {
            url.searchParams.delete("drawerType")
        }

        const newPath = `${url.pathname}${url.search}${url.hash}`
        void Router.replace(newPath, undefined, {shallow: true}).catch((error) => {
            console.error("Failed to clear variant drawer query params:", error)
        })
    } catch (err) {
        console.error("Failed to clear variant drawer query params:", err)
    }
}
