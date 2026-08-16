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
    bindTraceDrawerSetQueryParam((name, value) => {
        const query = {...router.query}
        if (value === null) delete query[name]
        else query[name] = value
        void router.push({pathname: router.pathname, query}, undefined, {shallow: true})
    })
    bindTraceDrawerClearParams(() => {
        const query = {...router.query}
        delete query.trace
        delete query.span
        void router.push({pathname: router.pathname, query}, undefined, {shallow: true})
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
