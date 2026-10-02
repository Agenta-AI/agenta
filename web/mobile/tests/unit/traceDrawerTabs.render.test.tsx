// @vitest-environment jsdom
// The drawer draws span data through two host slots; unfilled on `/m`, every tab was empty.
import {act} from "react"

import type {TraceSpanNode} from "@agenta/observability"
import {OverviewTabItem, TraceDetails} from "@agenta/observability-ui/traceDrawer"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {GlobalDrawers} from "@/features/app/GlobalDrawers"

// GlobalDrawers binds the drawer's router seams; the tests never navigate.
vi.mock("next/router", () => ({
    useRouter: () => ({pathname: "/", query: {}, push: vi.fn()}),
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const span = {
    key: "span-1",
    trace_id: "trace-1",
    span_id: "span-1",
    span_name: "chat",
    span_type: "llm",
    start_time: "2026-09-26T10:00:00Z",
    end_time: "2026-09-26T10:00:02Z",
    attributes: {
        ag: {
            data: {
                inputs: {question: "What is the capital of Peru?"},
                outputs: {answer: "Lima is the capital of Peru."},
                parameters: {temperature: 0.2},
            },
            metrics: {
                tokens: {incremental: {total: 1234, prompt: 1000, completion: 234}},
                costs: {incremental: {total: 0.0421}},
                duration: {cumulative: 2000},
            },
        },
    },
} as unknown as TraceSpanNode

let host: HTMLDivElement
let root: Root
let appHost: HTMLDivElement
let appRoot: Root

const mount = async (node: React.ReactNode) => {
    await act(async () => {
        root.render(<Provider store={createStore()}>{node}</Provider>)
    })
}

beforeEach(async () => {
    // The slots are filled by the app's own wiring, not by the test: if GlobalDrawers stops
    // registering them, the tabs render empty again and these tests fail.
    appHost = document.createElement("div")
    document.body.appendChild(appHost)
    appRoot = createRoot(appHost)
    await act(async () => {
        appRoot.render(
            <Provider store={createStore()}>
                <GlobalDrawers />
            </Provider>,
        )
    })

    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(() => {
    act(() => root.unmount())
    act(() => appRoot.unmount())
    host.remove()
    appHost.remove()
})

describe("trace drawer tabs on /m", () => {
    it("shows the span's inputs and outputs on the Overview tab", async () => {
        await mount(<OverviewTabItem activeTrace={span} />)

        const text = host.textContent ?? ""
        expect(text).toContain("inputs")
        expect(text).toContain("What is the capital of Peru?")
        expect(text).toContain("outputs")
        expect(text).toContain("Lima is the capital of Peru.")
    })

    it("shows the span's tokens and cost in the trace info", async () => {
        await mount(<TraceDetails activeTrace={span} />)

        const text = host.textContent ?? ""
        expect(text).toContain("Tokens & Cost")
        expect(text).toContain("1.2K")
        expect(text).toContain("$0.0421")
    })
})
