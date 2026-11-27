/** @vitest-environment jsdom */
// The trace tree: one line per span, tokens off for a user with no saved settings, a saved
// setting wins, tool spans read their call, and "Group turns" draws one row per turn.
import {act} from "react"

import type {TraceSpanNode} from "@agenta/observability"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const metrics = (ms: number, extra: Record<string, unknown> = {}) => ({
    duration: {cumulative: ms},
    ...extra,
})

const turn = (id: string, text: string, children: unknown[]) => ({
    span_id: id,
    span_name: "_agent",
    span_type: "agent",
    start_time: "2026-11-27T10:00:00Z",
    end_time: "2026-11-27T10:00:20Z",
    attributes: {
        ag: {data: {inputs: {messages: [{role: "user", content: text}]}}, metrics: metrics(20000)},
    },
    children,
})

const harness = vi.hoisted(() => ({tree: null as unknown}))

vi.mock("@agenta/observability/traceDrawer", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/observability/traceDrawer")>()),
    useTraceDrawer: () => ({
        traces: [harness.tree],
        getTraceById: () => harness.tree,
    }),
}))

import TraceTree from "../../src/traceDrawer/TraceTree"

const tree = {
    span_id: "root",
    span_name: "conversation",
    span_type: "workflow",
    start_time: "2026-11-27T10:00:00Z",
    end_time: "2026-11-27T10:01:00Z",
    attributes: {ag: {metrics: metrics(60000)}},
    children: [
        turn("a", "Fix the failing test in the date parser.", [
            {
                span_id: "llm",
                span_name: "chat opus",
                span_type: "chat",
                start_time: "2026-11-27T10:00:00Z",
                end_time: "2026-11-27T10:00:05Z",
                attributes: {
                    ag: {
                        metrics: metrics(5000, {
                            tokens: {
                                incremental: {total: 345000, prompt: 300000, completion: 45000},
                            },
                            costs: {incremental: {total: 0.82}},
                        }),
                    },
                },
            },
            {
                span_id: "tool",
                span_name: "execute_tool Bash",
                span_type: "tool",
                start_time: "2026-11-27T10:00:05Z",
                end_time: "2026-11-27T10:00:07Z",
                attributes: {
                    ag: {
                        data: {
                            inputs: {
                                arguments: {command: "pytest -q", description: "Run the tests"},
                            },
                        },
                        metrics: metrics(1750),
                    },
                },
            },
        ]),
        turn("b", "Now ship it.", []),
    ],
}

let host: HTMLDivElement
let root: Root

const render = async () => {
    await act(async () => {
        root.render(
            <Provider store={createStore()}>
                <TraceTree activeTraceId="root" selected="root" setSelected={() => undefined} />
            </Provider>,
        )
    })
}

beforeEach(() => {
    harness.tree = tree as unknown as TraceSpanNode
    localStorage.clear()
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

const rows = () =>
    Array.from(host.querySelectorAll('[data-testid="trace-tree-row"]')).map(
        (row) => row.textContent,
    )

describe("trace tree", () => {
    it("shows latency and cost, no tokens, for a user with no saved settings", async () => {
        await render()
        const text = host.textContent ?? ""
        expect(text).toContain("$0.82")
        expect(text).not.toContain("345.0K")
    })

    it("keeps a saved Show tokens setting", async () => {
        localStorage.setItem(
            "traceTreeSettings",
            JSON.stringify({latency: true, cost: true, tokens: true, visibility: "all"}),
        )
        await render()
        expect(host.textContent).toContain("345.0K")
    })

    it("labels a tool span from its call, with no cost and no dash", async () => {
        await render()
        const toolRow = rows().find((row) => row?.includes("Run the tests"))
        expect(toolRow).toBe("Run the tests1.75s")
    })

    it("draws one row per turn with the user's message when Group turns is on", async () => {
        localStorage.setItem(
            "traceTreeSettings",
            JSON.stringify({latency: true, cost: true, tokens: false, groupTurns: true}),
        )
        await render()
        const text = host.textContent ?? ""
        expect(text).toContain("1Fix the failing test in the date parser.20s")
        expect(text).toContain("2Now ship it.20s")
    })

    it("draws the spans as they are by default", async () => {
        await render()
        expect(host.textContent).not.toContain("1Fix the failing test")
    })
})
