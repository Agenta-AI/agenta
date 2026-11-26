// @vitest-environment jsdom
// Back to an address with no span: the drawer falls back to its first span and writes it. That
// write replaces the history entry only when the shown span really changes.
import {act, createElement} from "react"

import {traceDrawerSetQueryParam} from "@agenta/observability/traceDrawer"
import {createStore, Provider} from "jotai"
import type {NextRouter} from "next/router"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {bindTraceDrawerSeams} from "@/features/observability/bindTraceDrawerSeams"
import {useTraceDrawerFromUrl} from "@/features/observability/useTraceDrawerFromUrl"

// The drawer's spans: the resolved span is the picked one when the trace has it, else the first.
vi.mock("@agenta/observability/traceDrawer", async (importOriginal) => {
    const original = await importOriginal<typeof import("@agenta/observability/traceDrawer")>()
    const {atom} = await import("jotai")
    return {
        ...original,
        traceDrawerResolvedActiveSpanIdAtom: atom((get) => {
            const picked = get(original.traceDrawerActiveSpanIdAtom)
            return picked && ["root", "s2", "s3"].includes(picked) ? picked : "root"
        }),
    }
})
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const Probe = ({router}: {router: NextRouter}) => {
    useTraceDrawerFromUrl(router)
    return null
}

describe("trace drawer history after Back clears the span", () => {
    let root: Root
    let host: HTMLDivElement
    let store: ReturnType<typeof createStore>
    const push = vi.fn(() => Promise.resolve(true))
    const replace = vi.fn(() => Promise.resolve(true))
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
        push.mockClear()
        replace.mockClear()
        window.history.replaceState(null, "", "/observability?trace=t1")
        bindTraceDrawerSeams(
            {pathname: "/observability", query: {}, push, replace} as unknown as NextRouter,
            {playground: false, openTraceId: () => "t1"},
        )
    })
    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    it("From another span, the first span the drawer falls back to replaces the entry", () => {
        render({trace: "t1", span: "s2"})
        render({trace: "t1"})
        // The mounted drawer now shows its first span and writes it.
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

    it("From the first span, nothing is written, and the next pick still pushes", () => {
        render({trace: "t1", span: "root"})
        render({trace: "t1"})
        // The shown span did not change, so the drawer writes nothing; the user picks a span.
        traceDrawerSetQueryParam("span", "s3")
        expect(replace).not.toHaveBeenCalled()
        expect(push).toHaveBeenCalledWith(
            {pathname: "/observability", query: {trace: "t1", span: "s3"}},
            undefined,
            {shallow: true},
        )
    })
})
