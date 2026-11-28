// @vitest-environment jsdom
// The drawer draws span data through host slots; unfilled on `/m`, the span body was empty.
import {act} from "react"

import type {TraceSpanNode} from "@agenta/observability"
import {
    OverviewTabItem,
    SpanMetricsGrid,
    TraceTypeHeader,
} from "@agenta/observability-ui/traceDrawer"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {GlobalDrawers} from "@/features/app/GlobalDrawers"
// The span panel is a lazy chunk that holds the value renderers. Loading the module with the
// file means the test waits for the panel to render, not for the module to be compiled.
import "@/features/observability/TraceSpanPanel"

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

describe("trace view span body on /m", () => {
    it("shows the span's input and output by shape", async () => {
        await mount(<OverviewTabItem activeTrace={span} mode="formatted" />)

        // The sections arrive with the drill-in slot, which loads on demand.
        await vi.waitFor(() => expect(host.textContent).toContain("What is the capital of Peru?"))
        const text = host.textContent ?? ""
        expect(text).toContain("Input")
        expect(text).toContain("Output")
        expect(text).toContain("Lima is the capital of Peru.")
        // Parameters are folded: the title shows, the value does not.
        expect(text).toContain("Parameters")
        expect(text).not.toContain("0.2")
    })

    it("shows the span's tokens and cost in the metrics grid", async () => {
        await mount(<SpanMetricsGrid span={span} />)

        const text = host.textContent ?? ""
        expect(text).toContain("Tokens")
        expect(text).toContain("1.2K")
        expect(text).toContain("$0.0421")
    })

    it("shows the span name, its type and the Formatted / Raw switch in the span header", async () => {
        await mount(
            <TraceTypeHeader
                activeTrace={span}
                error={undefined}
                mode="formatted"
                onModeChange={() => undefined}
            />,
        )

        const text = host.textContent ?? ""
        expect(text).toContain("chat")
        expect(text).toContain("llm")
        expect(text).toContain("Formatted")
        expect(text).toContain("Raw")
        // `/m` leaves the playground action unbound; the header never had room for it.
        const buttons = Array.from(host.querySelectorAll("button"))
        expect(buttons.some((b) => b.textContent?.includes("Playground"))).toBe(false)
    })
})
