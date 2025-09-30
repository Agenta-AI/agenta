import {atom, getDefaultStore} from "jotai"
import Router from "next/router"

import {
    openTraceDrawerAtom,
    traceDrawerAtom,
} from "@/oss/components/Playground/Components/Drawers/TraceDrawer/store/traceDrawerStore"
import {selectedNodeAtom, selectedTraceIdAtom} from "@/oss/state/newObservability/atoms/controls"

import {isTraceSupportedRoute} from "./routeMatchers"

const isBrowser = typeof window !== "undefined"

export const traceIdAtom = atom<string | undefined>(undefined)

export const clearTraceDrawerState = () => {
    const store = getDefaultStore()
    const current = store.get(traceDrawerAtom)

    if (current.open || current.result !== null) {
        store.set(traceDrawerAtom, (draft) => {
            draft.open = false
            draft.result = null
        })
    }

    store.set(traceIdAtom, undefined)
    store.set(selectedTraceIdAtom, "")
    store.set(selectedNodeAtom, "")
}

export const syncTraceStateFromUrl = (nextUrl?: string) => {
    if (!isBrowser) return

    try {
        const store = getDefaultStore()
        const url = new URL(nextUrl ?? window.location.href, window.location.origin)
        const traceParam = url.searchParams.get("trace") ?? undefined
        const routeSupportsTrace = isTraceSupportedRoute(url.pathname)
        const currentTraceId = store.get(traceIdAtom)

        if (!routeSupportsTrace) {
            if (traceParam) {
                url.searchParams.delete("trace")
                const newPath = `${url.pathname}${url.search}${url.hash}`
                void Router.replace(newPath, undefined, {shallow: true}).catch((error) => {
                    console.error("Failed to remove unsupported 'trace' query param:", error)
                })
            }
            if (currentTraceId !== undefined) {
                clearTraceDrawerState()
            }
            return
        }

        if (!traceParam) {
            if (currentTraceId !== undefined) {
                clearTraceDrawerState()
            }
            return
        }

        if (currentTraceId === traceParam) {
            return
        }

        store.set(traceIdAtom, traceParam)
        store.set(selectedTraceIdAtom, traceParam)
        store.set(selectedNodeAtom, "")
        store.set(openTraceDrawerAtom, {
            result: {traces: [], navigationIds: [], activeTraceId: traceParam},
        })
    } catch (err) {
        console.error("Failed to sync trace state from URL:", nextUrl, err)
    }
}

export const clearTraceQueryParam = () => {
    if (!isBrowser) return
    try {
        const url = new URL(window.location.href)
        if (!url.searchParams.has("trace")) return
        url.searchParams.delete("trace")
        const newPath = `${url.pathname}${url.search}${url.hash}`
        void Router.replace(newPath, undefined, {shallow: true}).catch((error) => {
            console.error("Failed to clear 'trace' query param:", error)
        })
    } catch (err) {
        console.error("Failed to clear 'trace' query param:", err)
    }
}

export const clearTraceParamAtom = atom(null, (_get, _set) => {
    clearTraceQueryParam()
})
