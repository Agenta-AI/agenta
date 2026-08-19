import {PropsWithChildren, useRef} from "react"

import {
    bindTraceDrawerClearParams,
    bindTraceDrawerNavigate,
    bindTraceDrawerSetQueryParam,
} from "@agenta/observability/traceDrawer"
import {useQueryClient} from "@tanstack/react-query"
import {Provider, getDefaultStore, useSetAtom} from "jotai"
import {useHydrateAtoms} from "jotai/react/utils"
import {queryClientAtom} from "jotai-tanstack-query"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {registerTraceDrawerReferenceSlots} from "../components/SharedDrawers/TraceDrawer/registerReferenceSlots"
import AgSWRConfig from "../lib/api/SWRConfig"

import {bindObservabilityHostAtoms} from "./observability"
import UserListener from "./profile/UserListener"
import {SessionListener} from "./session"

// Defers the heavy playground/entity registration graph (selection adapters,
// workflow commit/archive bridge, web worker) into an async chunk so it stays
// out of the shared `_app` bundle. Mounted childless on first client paint.
const DeferredAppBoot = dynamic(() => import("./boot/DeferredAppBoot"), {ssr: false})

const HydrateAtoms = ({children}: PropsWithChildren) => {
    const queryClient = useQueryClient()
    useHydrateAtoms([[queryClientAtom, queryClient]])
    // Point @agenta/observability's seams at the OSS atoms during the first
    // render — before any consumer's query atom evaluates. An effect would be
    // too late and fire one disabled query first.
    const bindObservability = useSetAtom(bindObservabilityHostAtoms)
    const router = useRouter()
    const observabilityBound = useRef(false)
    if (!observabilityBound.current) {
        observabilityBound.current = true
        bindObservability()
        registerTraceDrawerReferenceSlots()
    }
    // The drawer's out-links push through the app's router; rebound each render so the
    // binding never closes over a stale router instance.
    bindTraceDrawerNavigate((href) => {
        void router.push(href)
    })
    // Shallow query writes: the drawer syncs ?trace/?span without re-running data fetching.
    //
    // Read the LIVE url, never `router.query`. These callbacks are rebound every render, but each
    // one still closes over that render's query SNAPSHOT — so a seam invoked shortly after another
    // navigation rebuilt the whole query from a pre-navigation copy and silently dropped the keys
    // that had just landed. That is what made a trace click flash the drawer and lose `?trace=`:
    // the click wrote both params, then the drawer's own seam pushed a query that predated them.
    // Mutating the current `location.search` has no snapshot to go stale.
    const pushCurrentUrl = (mutate: (params: URLSearchParams) => void) => {
        if (typeof window === "undefined") return
        const url = new URL(window.location.href)
        const before = url.search
        mutate(url.searchParams)
        console.log("[trace-drawer] 6 seam push", before, "->", url.search)
        void router.push(`${url.pathname}${url.search}${url.hash}`, undefined, {shallow: true})
    }
    bindTraceDrawerSetQueryParam((name, value) => {
        pushCurrentUrl((params) => {
            if (value === null || value === undefined) params.delete(name)
            else params.set(name, String(value))
        })
    })
    bindTraceDrawerClearParams(() => {
        pushCurrentUrl((params) => {
            params.delete("trace")
            params.delete("span")
        })
    })
    return children
}

const GlobalStateProvider = ({children}: PropsWithChildren) => {
    const sharedStore = getDefaultStore()
    return (
        <Provider store={sharedStore}>
            <AgSWRConfig>
                <HydrateAtoms>
                    <SessionListener />
                    <UserListener />
                    <DeferredAppBoot />
                    {children}
                </HydrateAtoms>
            </AgSWRConfig>
        </Provider>
    )
}

export default GlobalStateProvider
