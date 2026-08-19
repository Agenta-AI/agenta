import {selectedNodeAtom, selectedTraceIdAtom} from "@agenta/observability"
import {
    initialTraceDrawerState,
    openTraceDrawerAtom,
    setTraceDrawerActiveSpanAtom,
    traceDrawerAtom,
} from "@agenta/observability/traceDrawer"
import {atom, getDefaultStore} from "jotai"
import Router from "next/router"

import {isTraceSupportedRoute} from "./routeMatchers"

const isBrowser = typeof window !== "undefined"

export const traceIdAtom = atom<string | undefined>(undefined)

// Tracks whether the current trace drawer was opened via URL (trace param).
// Only URL-driven drawers should be closed by URL sync. Drawers opened
// programmatically (e.g. from execution-result trace buttons inside the
// WorkflowRevisionDrawer "+ New prompt" flow on /apps) must survive route
// changes and URL syncs that don't natively support trace context — otherwise
// `syncTraceStateFromUrl` strips `?span=...` while the drawer's tree-click
// handler re-adds it, producing a tight URL change loop.
let drawerOpenedViaUrl = false
// The `?trace=` this sync last acted on. The URL sync opens the drawer when the trace param
// CHANGES; without this it re-asserted on every sync, so any url sync fired while the param was
// still on the URL reopened a drawer the user had just closed — close, reopen, close, until the
// tab locked up. Cleared whenever the param leaves the URL, so the same trace can be reopened.
let lastSyncedTraceParam: string | undefined

export const clearTraceDrawerState = () => {
    const store = getDefaultStore()
    const current = store.get(traceDrawerAtom)

    if (current.open || current.traceId || current.activeSpanId) {
        store.set(traceDrawerAtom, () => ({...initialTraceDrawerState}))
    }

    store.set(traceIdAtom, undefined)
    store.set(selectedTraceIdAtom, "")
    store.set(selectedNodeAtom, "")
    drawerOpenedViaUrl = false
    lastSyncedTraceParam = undefined
}

export const syncTraceStateFromUrl = (nextUrl?: string) => {
    if (!isBrowser) return

    try {
        const store = getDefaultStore()
        const url = new URL(nextUrl ?? window.location.href, window.location.origin)
        const traceParam = url.searchParams.get("trace") ?? undefined
        const routeSupportsTrace = isTraceSupportedRoute(url.pathname)
        const spanParam = url.searchParams.get("span") ?? undefined
        const currentTraceId = store.get(traceIdAtom)
        const currentDrawerState = store.get(traceDrawerAtom)

        if (!routeSupportsTrace) {
            // Programmatic opens (drawer already open without being URL-driven)
            // must survive on non-trace routes. Stripping `?span=...` while the
            // drawer is open would race the tree-click `setSpanQueryParam` and
            // loop indefinitely.
            if (currentDrawerState.open && !drawerOpenedViaUrl) {
                return
            }
            if (traceParam || url.searchParams.has("span")) {
                if (traceParam) {
                    url.searchParams.delete("trace")
                }
                if (url.searchParams.has("span")) {
                    url.searchParams.delete("span")
                }
                const newPath = `${url.pathname}${url.search}${url.hash}`
                void Router.replace(newPath, undefined, {shallow: true}).catch((error) => {
                    console.error("Failed to remove unsupported trace query params:", error)
                })
            }
            if (currentDrawerState.open && drawerOpenedViaUrl) {
                clearTraceDrawerState()
            }
            return
        }

        console.log("[trace-drawer] 5 sync", {
            traceParam,
            spanParam,
            open: currentDrawerState.open,
            currentTraceId,
            lastSynced: lastSyncedTraceParam,
            openedViaUrl: drawerOpenedViaUrl,
            routeSupportsTrace,
        })
        if (!traceParam) {
            lastSyncedTraceParam = undefined
            if (currentDrawerState.open && !drawerOpenedViaUrl) {
                return
            }
            if (currentTraceId !== undefined) {
                console.log("[trace-drawer] 5a no param -> CLEAR state")
                clearTraceDrawerState()
            }
            return
        }

        if (currentDrawerState.open && currentTraceId === traceParam) {
            lastSyncedTraceParam = traceParam
            return
        }

        // Closed, on a trace this sync has already handled: the user closed it. Opening on a URL
        // CHANGE is the contract; re-asserting on every sync is what made closing impossible.
        if (!currentDrawerState.open && lastSyncedTraceParam === traceParam) {
            console.log("[trace-drawer] 5b closed by user, same trace -> SKIP reopen")
            return
        }
        lastSyncedTraceParam = traceParam
        console.log("[trace-drawer] 5c -> OPEN drawer", traceParam)

        // The drawer is being opened by URL sync (rather than programmatically
        // by a button handler that already set `drawerState.open = true`).
        if (!currentDrawerState.open) {
            drawerOpenedViaUrl = true
        }

        store.set(traceIdAtom, traceParam)
        store.set(selectedTraceIdAtom, traceParam)
        store.set(selectedNodeAtom, spanParam ?? "")

        store.set(openTraceDrawerAtom, {
            traceId: traceParam,
            activeSpanId: spanParam ?? null,
        })

        store.set(setTraceDrawerActiveSpanAtom, spanParam ?? null)
    } catch (err) {
        console.error("Failed to sync trace state from URL:", nextUrl, err)
    }
}

export const clearTraceQueryParam = () => {
    if (!isBrowser) return
    try {
        const url = new URL(window.location.href)
        let mutated = false
        if (url.searchParams.has("trace")) {
            url.searchParams.delete("trace")
            mutated = true
        }
        if (url.searchParams.has("span")) {
            url.searchParams.delete("span")
            mutated = true
        }
        if (!mutated) return
        const newPath = `${url.pathname}${url.search}${url.hash}`
        void Router.replace(newPath, undefined, {shallow: true}).catch((error) => {
            console.error("Failed to clear trace query params:", error)
        })
    } catch (err) {
        console.error("Failed to clear trace query params:", err)
    }
}

export const clearTraceParamAtom = atom(null, (_get, _set) => {
    // Reset the URL-driven flag so the next open (whether URL-driven or
    // programmatic) starts from a clean state.
    drawerOpenedViaUrl = false
    clearTraceQueryParam()
})
