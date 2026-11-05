// @vitest-environment jsdom
// A reload of /observability?trace=..&span=.. opens the trace drawer on that trace and span.
import {act, createElement} from "react"

import {
    closeTraceDrawerAtom,
    openTraceDrawerAtom,
    traceDrawerAtom,
    traceDrawerSetQueryParam,
} from "@agenta/observability/traceDrawer"
import {createStore, Provider} from "jotai"
import type {NextRouter} from "next/router"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {bindTraceDrawerSeams} from "@/features/observability/bindTraceDrawerSeams"
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

    it("Back past the trace closes the drawer", () => {
        render({trace: "t1", span: "s1"})
        expect(store.get(traceDrawerAtom).open).toBe(true)
        render({})
        expect(store.get(traceDrawerAtom).open).toBe(false)
    })

    it("A drawer opened from a row stays open until the address names its trace", () => {
        act(() => store.set(openTraceDrawerAtom, {traceId: "t1", activeSpanId: "s1"}))
        render({})
        expect(store.get(traceDrawerAtom).open).toBe(true)
    })

    it("Back to another span of the same trace shows that span", () => {
        render({trace: "t1", span: "s1"})
        render({trace: "t1", span: "s2"})
        expect(store.get(traceDrawerAtom).activeSpanId).toBe("s2")
        render({trace: "t1", span: "s1"})
        expect(store.get(traceDrawerAtom).activeSpanId).toBe("s1")
    })

    it("Back to an address with no span clears the selected span", () => {
        render({trace: "t1", span: "s1"})
        render({trace: "t1"})
        expect(store.get(traceDrawerAtom)).toMatchObject({open: true, activeSpanId: null})
    })

    it("The first span the drawer falls back to after Back replaces the entry, not pushes", () => {
        window.history.replaceState(null, "", "/observability?trace=t1")
        const push = vi.fn(() => Promise.resolve(true))
        const replace = vi.fn(() => Promise.resolve(true))
        bindTraceDrawerSeams(
            {pathname: "/observability", query: {}, push, replace} as unknown as NextRouter,
            {playground: false, openTraceId: () => "t1"},
        )
        render({trace: "t1", span: "s2"})
        render({trace: "t1"})
        // The mounted drawer shows its first span and writes it.
        traceDrawerSetQueryParam("span", "root")
        expect(push).not.toHaveBeenCalled()
        expect(replace).toHaveBeenCalledWith(
            {pathname: "/observability", query: {trace: "t1", span: "root"}},
            undefined,
            {shallow: true},
        )
        // A span the user picks next is a new entry again.
        traceDrawerSetQueryParam("span", "s3")
        expect(push).toHaveBeenCalledTimes(1)
    })
})
