import type {TraceSpanNode} from "@agenta/observability"
import {describe, expect, it} from "vitest"

import {
    buildSessionStats,
    buildSessionTree,
    extractTurnMessages,
    findSpanInSession,
    hiddenMessageCount,
    sortTracesByStart,
} from "@/features/observability/sessionDrawer/sessionTurns"

const trace = (overrides: Partial<TraceSpanNode> & {span_id: string}): TraceSpanNode => ({
    trace_id: `trace-of-${overrides.span_id}`,
    ...overrides,
})

const withData = (data: Record<string, unknown>, rest: Partial<TraceSpanNode> = {}) =>
    trace({span_id: "root", attributes: {ag: {data}}, ...rest})

describe("extractTurnMessages", () => {
    it("Chat inputs become one message per input message", () => {
        const messages = extractTurnMessages(
            withData({
                inputs: {
                    messages: [
                        {role: "system", content: "Be brief."},
                        {role: "user", content: "Hi Alex"},
                        {role: "user", content: {text: "object content"}},
                    ],
                },
                outputs: {role: "assistant", content: "Hello"},
            }),
        )
        expect(messages).toEqual([
            {role: "system", content: "Be brief."},
            {role: "user", content: "Hi Alex"},
            {role: "user", content: '{"text":"object content"}'},
            {role: "assistant", content: "Hello"},
        ])
    })

    it("Completion inputs and outputs fall back to one user and one assistant message", () => {
        expect(
            extractTurnMessages(
                withData({inputs: {input: "Translate this"}, outputs: {output: "Traduit"}}),
            ),
        ).toEqual([
            {role: "user", content: "Translate this"},
            {role: "assistant", content: "Traduit"},
        ])
        expect(extractTurnMessages(withData({inputs: {topic: "tea"}}))).toEqual([
            {role: "user", content: '{"topic":"tea"}'},
        ])
    })

    it("A streamed agent run uses the agent span output, not the generator repr", () => {
        const root = withData(
            {inputs: {message: "Plan my day"}, outputs: "<async_generator object run at 0x7f>"},
            {
                children: [
                    trace({
                        span_id: "agent-span",
                        span_type: "agent",
                        attributes: {ag: {data: {outputs: "Here is your plan."}}},
                    }),
                ] as never,
            },
        )
        expect(extractTurnMessages(root)).toEqual([
            {role: "user", content: "Plan my day"},
            {role: "assistant", content: "Here is your plan."},
        ])
    })

    it("A generator repr with no agent span is dropped", () => {
        const root = withData({inputs: {message: "Hi"}, outputs: "<generator object run at 0x7f>"})
        expect(extractTurnMessages(root)).toEqual([{role: "user", content: "Hi"}])
    })

    it("An error trace ends with an exception message", () => {
        const failed = withData(
            {inputs: {message: "Hi"}},
            {status_code: "STATUS_CODE_ERROR", status_message: "Provider timed out"},
        )
        expect(extractTurnMessages(failed).at(-1)).toEqual({
            role: "exception",
            content: "Provider timed out",
        })
        const silent = withData({inputs: {message: "Hi"}}, {status_code: "STATUS_CODE_ERROR"})
        expect(extractTurnMessages(silent).at(-1)?.content).toBe(
            "An error occurred during the session execution.",
        )
    })
})

describe("hiddenMessageCount", () => {
    const messages = [
        {role: "user", content: "a"},
        {role: "assistant", content: "b"},
        {role: "user", content: "c"},
        {role: "assistant", content: "d"},
    ]

    it("Later traces hide the messages before the last user message", () => {
        expect(hiddenMessageCount(messages, 1)).toBe(2)
    })

    it("The first trace hides nothing, and neither does a trace with no user message", () => {
        expect(hiddenMessageCount(messages, 0)).toBe(0)
        expect(hiddenMessageCount([{role: "assistant", content: "x"}], 2)).toBe(0)
    })
})

describe("sortTracesByStart", () => {
    it("Orders oldest first and puts a trace with no start time last", () => {
        const late = trace({span_id: "late", start_time: "2026-01-01T10:00:00Z"})
        const early = trace({span_id: "early", start_time: "2026-01-01T09:00:00Z"})
        const unknown = trace({span_id: "unknown"})
        expect(sortTracesByStart([unknown, late, early]).map((t) => t.span_id)).toEqual([
            "early",
            "late",
            "unknown",
        ])
    })
})

const metered = (span_id: string, tokens: number, model?: string) =>
    trace({
        span_id,
        attributes: {
            ag: {
                metrics: {
                    tokens: {cumulative: {total: tokens}},
                    costs: {cumulative: {total: 0.5}},
                    duration: {cumulative: 1000},
                },
                data: model ? {parameters: {prompt: {llm_config: {model}}}} : {},
            },
        },
    })

describe("buildSessionStats", () => {
    it("Session stats sum tokens once and list each model once", () => {
        const stats = buildSessionStats([
            metered("a", 10, "model-one"),
            metered("b", 5, "model-two"),
            metered("c", 1, "model-one"),
            metered("d", 4),
        ])
        expect(stats).toEqual({
            cost: 2,
            tokens: 20,
            latency: 4000,
            models: ["model-one", "model-two"],
        })
    })

    it("Has no models when no trace names one, and no stats for no traces", () => {
        expect(buildSessionStats([metered("a", 1)])?.models).toEqual([])
        expect(buildSessionStats([])).toBeNull()
    })
})

describe("findSpanInSession", () => {
    const child = trace({span_id: "child"})
    const first = trace({span_id: "first", children: [child] as never})
    const second = trace({span_id: "second"})

    it("Tells a trace root from a span inside a trace", () => {
        expect(findSpanInSession([first, second], "second")).toEqual({
            kind: "trace",
            spanId: "second",
        })
        expect(findSpanInSession([first, second], "child")).toEqual({
            kind: "span",
            traceId: first.trace_id,
            spanId: "child",
        })
        expect(findSpanInSession([first, second], "missing")).toBeNull()
    })
})

describe("buildSessionTree", () => {
    const first = trace({span_id: "first", start_time: "2026-01-01T09:00:00Z"})
    const second = trace({span_id: "second", start_time: "2026-01-01T10:00:00Z"})

    it("Traces render oldest first as Trace 1 and Trace 2 under a Session root", () => {
        const tree = buildSessionTree([first, second], null, "")
        expect(tree?.span_name).toBe("Session")
        expect(tree?.expanded).toBe(true)
        expect(tree?.children?.map((node) => [node.span_id, node.span_name])).toEqual([
            ["first", "Trace 1"],
            ["second", "Trace 2"],
        ])
    })

    it("Search in session keeps only the matching trace", () => {
        const tree = buildSessionTree([first, second], null, "trace 2")
        expect(tree?.children?.map((node) => node.span_id)).toEqual(["second"])
    })

    it("Has no tree for no traces", () => {
        expect(buildSessionTree([], null, "")).toBeUndefined()
    })
})
