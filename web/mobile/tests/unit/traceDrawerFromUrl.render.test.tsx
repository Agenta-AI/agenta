// @vitest-environment jsdom
// A reload of /observability?trace=..&span=.. opens the trace drawer on that trace and span.
import {act, createElement} from "react"

import {
    closeTraceDrawerAtom,
    openTraceDrawerAtom,
    traceDrawerAtom,
} from "@agenta/observability/traceDrawer"
import {createStore, Provider} from "jotai"
import type {NextRouter} from "next/router"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it} from "vitest"

import {useTraceDrawerFromUrl} from "@/features/observability/useTraceDrawerFromUrl"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const Probe = ({router}: {router: NextRouter}) => {
    useTraceDrawerFromUrl(router)
    return null
}

describe("trace drawer from the address", () => {
    let root: Root
    let host: HTMLDivElement
    let store: ReturnType<typeof createStore>
    const render = (query: NextRouter["query"]) =>
        act(() =>
            root.render(
                createElement(
                    Provider,
                    {store},
                    createElement(Probe, {
                        router: {isReady: true, pathname: "/observability", query} as NextRouter,
                    }),
                ),
            ),
        )

    beforeEach(() => {
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
        store = createStore()
    })
    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    it("A reload with trace and span in the address opens the drawer on them", () => {
        render({trace: "t1", span: "s1"})
        expect(store.get(traceDrawerAtom)).toMatchObject({
            open: true,
            traceId: "t1",
            activeSpanId: "s1",
        })
    })

    it("A drawer the user closed stays closed while its params leave the address", () => {
        render({trace: "t1", span: "s1"})
        act(() => store.set(closeTraceDrawerAtom))
        render({trace: "t1", span: "s1"})
        expect(store.get(traceDrawerAtom).open).toBe(false)

        // The same trace opens again once it comes back to the address.
        render({})
        render({trace: "t1"})
        expect(store.get(traceDrawerAtom).open).toBe(true)
    })

    it("A drawer already open on that trace keeps its span", () => {
        act(() => store.set(openTraceDrawerAtom, {traceId: "t1", activeSpanId: "s2"}))
        render({trace: "t1", span: "s1"})
        expect(store.get(traceDrawerAtom).activeSpanId).toBe("s2")
    })
})
