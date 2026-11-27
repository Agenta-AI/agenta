/** @vitest-environment jsdom */
// The side panel: the metrics grid, then References, Linked spans and Annotations, each hidden
// when it has nothing to show.
import {act} from "react"

import type {TraceSpanNode} from "@agenta/observability"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const harness = vi.hoisted(() => ({
    links: {} as {links?: unknown[]; references?: unknown[]},
}))

vi.mock("@agenta/observability/traceDrawer", async (importOriginal) => {
    const {atom} = await import("jotai")
    return {
        ...(await importOriginal<typeof import("@agenta/observability/traceDrawer")>()),
        linksAndReferencesAtom: atom(() => harness.links),
        useTraceDrawer: () => ({getTraceById: () => undefined}),
        useEvaluatorNavigation: () => ({buildEvaluatorTarget: () => null}),
    }
})

vi.mock("@agenta/entities/workflow", async (importOriginal) => {
    const {atom} = await import("jotai")
    return {
        ...(await importOriginal<typeof import("@agenta/entities/workflow")>()),
        evaluatorsListDataAtom: atom(() => []),
    }
})

import {configureTraceDrawerReferences} from "../../src/traceDrawer/referenceSlots"
import SpanMetricsGrid from "../../src/traceDrawer/SpanMetricsGrid"
import TraceSidePanel from "../../src/traceDrawer/TraceSidePanel"

const span = (overrides: Record<string, unknown> = {}) =>
    ({
        trace_id: "t-1",
        span_id: "s-1",
        span_name: "chat",
        span_type: "chat",
        status_code: "STATUS_CODE_UNSET",
        start_time: "2026-11-27T08:02:15Z",
        end_time: "2026-11-27T08:02:23Z",
        attributes: {ag: {metrics: {duration: {cumulative: 7910}}}},
        ...overrides,
    }) as unknown as TraceSpanNode

let host: HTMLDivElement
let root: Root

const render = async (node: React.ReactNode) => {
    await act(async () => {
        root.render(<Provider store={createStore()}>{node}</Provider>)
    })
}

beforeEach(() => {
    harness.links = {}
    configureTraceDrawerReferences({AnnotationResultRow: null})
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

describe("trace side panel", () => {
    it("hides References, Linked spans and Annotations when the span has none", async () => {
        await render(<TraceSidePanel activeTrace={span() as never} />)
        expect(host.querySelector('[data-testid="span-metrics-grid"]')).not.toBeNull()
        expect(host.querySelector('[data-testid="trace-references"]')).toBeNull()
        expect(host.querySelector('[data-testid="trace-linked-spans"]')).toBeNull()
        expect(host.querySelector('[data-testid="trace-annotations"]')).toBeNull()
        expect(host.textContent).not.toContain("No linked spans")
        expect(host.textContent).not.toContain("No references")
    })

    it("shows one chip row per entity and the linked spans when there are some", async () => {
        harness.links = {
            references: [
                {key: "evaluator", id: "ev-1", slug: "faithfulness-judge"},
                {key: "evaluator_revision", id: "evr-1", version: 3},
                {key: "testset", id: "ts-1", slug: "support-faq"},
                {key: "testcase", id: "tc-123456789"},
            ],
            links: [{trace_id: "t-2", span_id: "s-9", key: "invocation"}],
        }
        await render(<TraceSidePanel activeTrace={span() as never} />)
        const references = host.querySelector('[data-testid="trace-references"]')
        expect(references?.querySelectorAll("dt")).toHaveLength(2)
        expect(references?.textContent).toContain("Evaluator")
        expect(references?.textContent).toContain("Test case")
        expect(host.querySelector('[data-testid="trace-linked-spans"]')?.textContent).toContain(
            "invocation",
        )
    })

    it("draws each evaluator's annotation through the AnnotationResultRow slot", async () => {
        const rows: unknown[] = []
        configureTraceDrawerReferences({
            AnnotationResultRow: (props) => {
                rows.push(props)
                return <div data-testid="annotation-row">{props.evaluatorName}</div>
            },
        })
        const annotations = [
            {
                references: {evaluator: {slug: "tone"}},
                origin: "human",
                data: {outputs: {metrics: {polite: false}}},
                createdById: "user-1",
                created_at: "2026-11-27T08:00:00Z",
                updated_at: "2026-11-27T09:00:00Z",
            },
            {
                references: {evaluator: {slug: "faithfulness"}},
                origin: "auto",
                data: {outputs: {metrics: {success: true}}},
            },
        ]
        await render(<TraceSidePanel activeTrace={span({annotations}) as never} />)
        const section = host.querySelector('[data-testid="trace-annotations"]')
        expect(section?.textContent).toContain("2 evaluators")
        // The human value is not counted.
        expect(section?.textContent).toContain("Passed 1 of 1")
        expect(
            Array.from(host.querySelectorAll('[data-testid="annotation-row"]')).map(
                (row) => row.textContent,
            ),
        ).toEqual(["tone", "faithfulness"])
        expect(rows[0]).toEqual({
            evaluatorName: "tone",
            origin: "human",
            metrics: [{name: "polite", value: false}],
            author: {userId: "user-1", at: "2026-11-27T09:00:00Z"},
        })
    })

    it("falls back to the annotation list when the host registers no row", async () => {
        const annotations = [
            {
                references: {evaluator: {slug: "tone"}},
                origin: "human",
                data: {outputs: {metrics: {polite: true}}},
            },
        ]
        await render(<TraceSidePanel activeTrace={span({annotations}) as never} />)
        const section = host.querySelector('[data-testid="trace-annotations"]')
        expect(section?.textContent).toContain("tone")
        expect(section?.textContent).toContain("polite")
    })
})

describe("span metrics grid", () => {
    it("shows Running, a running latency and no end for a span with no end time", async () => {
        await render(<SpanMetricsGrid span={span({end_time: null})} />)
        const text = host.textContent ?? ""
        expect(text).toContain("Running")
        expect(text).toContain("running")
        expect(text).not.toContain("End")
    })

    it("shows the status message under Error", async () => {
        await render(
            <SpanMetricsGrid
                span={span({
                    status_code: "STATUS_CODE_ERROR",
                    status_message: "Tool call rejected",
                })}
            />,
        )
        const text = host.textContent ?? ""
        expect(text).toContain("ErrorTool call rejected")
    })

    it("draws no cost or tokens cell, and no dash, for a span without them", async () => {
        await render(<SpanMetricsGrid span={span()} />)
        const text = host.textContent ?? ""
        expect(text).not.toContain("Cost")
        expect(text).not.toContain("Tokens")
    })

    it("shows the tokens and the cost when present", async () => {
        await render(
            <SpanMetricsGrid
                span={span({
                    attributes: {
                        ag: {
                            metrics: {
                                duration: {cumulative: 2000},
                                tokens: {incremental: {total: 1234, prompt: 1000, completion: 234}},
                                costs: {incremental: {total: 0.0421}},
                            },
                        },
                    },
                })}
            />,
        )
        const text = host.textContent ?? ""
        expect(text).toContain("Tokens1.2K")
        expect(text).toContain("$0.0421")
    })

    it("shows a cache token breakdown with the shared breakdown list", async () => {
        await render(
            <SpanMetricsGrid
                span={span({
                    attributes: {
                        ag: {
                            metrics: {
                                duration: {cumulative: 2000},
                                tokens: {
                                    incremental: {
                                        total: 1400,
                                        prompt: 1200,
                                        completion: 200,
                                        cache_read: 1000,
                                    },
                                },
                            },
                        },
                    },
                })}
            />,
        )
        const text = host.textContent ?? ""
        expect(text).toContain("Cache read")
        expect(text).toContain("Output")
    })
})
