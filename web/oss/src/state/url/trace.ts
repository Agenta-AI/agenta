import {atom, getDefaultStore} from "jotai"
import Router from "next/router"

import {
    initialTraceDrawerState,
    openTraceDrawerAtom,
    setTraceDrawerActiveSpanAtom,
    traceDrawerAtom,
} from "@/oss/components/Playground/Components/Drawers/TraceDrawer/store/traceDrawerStore"
import {selectedNodeAtom, selectedTraceIdAtom} from "@/oss/state/newObservability/atoms/controls"

import {isTraceSupportedRoute} from "./routeMatchers"

const isBrowser = typeof window !== "undefined"

export const traceIdAtom = atom<string | undefined>(undefined)

export const clearTraceDrawerState = () => {
    const store = getDefaultStore()
    const current = store.get(traceDrawerAtom)

    if (current.open || current.traceId || current.activeSpanId) {
        store.set(traceDrawerAtom, () => ({...initialTraceDrawerState}))
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
        const spanParam = url.searchParams.get("span") ?? undefined
        const currentTraceId = store.get(traceIdAtom)
        const currentDrawerState = store.get(traceDrawerAtom)

        if (!routeSupportsTrace) {
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

        if (currentDrawerState.open && currentTraceId === traceParam) {
            return
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
    clearTraceQueryParam()
})
