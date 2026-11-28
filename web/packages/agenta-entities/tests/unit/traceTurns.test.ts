import {describe, expect, it} from "vitest"

import {groupTraceTurns, type TraceSpan} from "../../src/trace"

const span = (
    id: string,
    parent: string | null,
    start: string,
    end: string,
    inputs?: unknown,
): TraceSpan => ({
    trace_id: "t1",
    span_id: id,
    parent_id: parent,
    start_time: start,
    end_time: end,
    attributes: inputs === undefined ? undefined : {ag: {data: {inputs}}},
})

const user = (text: string) => ({messages: [{role: "user", content: text}]})
const at = (second: number) => new Date(Date.UTC(2026, 10, 27, 12, 0, second)).toISOString()

describe("groupTraceTurns", () => {
    it("starts one turn at each child of the root whose input has a user message", () => {
        const spans = [
            span("root", null, at(0), at(50)),
            span("setup", "root", at(1), at(2), {config: "x"}),
            span("turn1", "root", at(3), at(10), user("first")),
            span("tool1", "turn1", at(4), at(6), {query: "a"}),
            span("turn2", "root", at(11), at(20), user("second")),
            span("tool2", "turn2", at(12), at(15)),
            span("turn3", "root", at(21), at(40), {
                messages: '[{"role": "user", "content": "third"}]',
            }),
            span("tool3", "turn3", at(22), at(45)),
        ]
        const turns = groupTraceTurns(spans)
        expect(turns.map((turn) => turn.spanId)).toEqual(["turn1", "turn2", "turn3"])
        // A span before the first turn joins the first turn; the root is in none.
        expect(turns[0].spans.map((item) => item.span_id)).toEqual(["setup", "turn1", "tool1"])
        expect(turns[1].spans.map((item) => item.span_id)).toEqual(["turn2", "tool2"])
        expect(turns[2].spans.map((item) => item.span_id)).toEqual(["turn3", "tool3"])
        expect(turns[0].startTime).toBe(Date.parse(at(1)))
        expect(turns[0].endTime).toBe(Date.parse(at(10)))
        expect(turns[2].endTime).toBe(Date.parse(at(45)))
    })

    it("makes one turn of a trace with one user message", () => {
        const spans = [
            span("root", null, at(0), at(9)),
            span("agent", "root", at(1), at(8), user("hello")),
            span("tool", "agent", at(2), at(3)),
        ]
        const turns = groupTraceTurns(spans)
        expect(turns).toHaveLength(1)
        expect(turns[0].spanId).toBe("agent")
        expect(turns[0].spans.map((item) => item.span_id)).toEqual(["agent", "tool"])
    })

    it("makes one turn with every span when no child has a user message", () => {
        const spans = [
            span("child", "root", at(1), at(2), {text: "no chat"}),
            span("root", null, at(0), at(3), user("on the root only")),
        ]
        const turns = groupTraceTurns(spans)
        expect(turns).toHaveLength(1)
        expect(turns[0].spanId).toBe("root")
        expect(turns[0].userText).toBe("on the root only")
        expect(turns[0].spans.map((item) => item.span_id)).toEqual(["root", "child"])
        expect(turns[0].startTime).toBe(Date.parse(at(0)))
        expect(turns[0].endTime).toBe(Date.parse(at(3)))
    })

    it("reads the children a trace response nests under spans", () => {
        const root = span("root", null, at(0), at(9))
        root.spans = {
            a: span("turn1", "root", at(1), at(4), user("one")),
            b: [span("turn2", "root", at(5), at(8), user("two"))],
        }
        expect(groupTraceTurns([root]).map((turn) => turn.spanId)).toEqual(["turn1", "turn2"])
    })

    it("sorts a span with no start time last, so it does not join the first turn", () => {
        const spans = [
            span("root", null, at(0), at(20)),
            span("turn1", "root", at(1), at(5), user("one")),
            span("late", "root", "", ""),
            span("turn2", "root", at(6), at(10), user("two")),
        ]
        const turns = groupTraceTurns(spans)
        expect(turns.map((turn) => turn.spans.map((item) => item.span_id))).toEqual([
            ["turn1"],
            ["turn2", "late"],
        ])
        expect(turns[1].endTime).toBe(Date.parse(at(10)))
    })

    // An agent whose LLM calls sit side by side under the root: each call carries the whole
    // history, so the next call of one exchange repeats the user messages of the call before.
    const history = (...texts: string[]) => ({
        messages: texts.flatMap((text, index) => [
            {role: "user", content: text},
            ...(index < texts.length - 1 ? [{role: "assistant", content: `re: ${text}`}] : []),
        ]),
    })

    it("makes one turn of one exchange whose LLM calls carry the same history", () => {
        const spans = [
            span("root", null, at(0), at(30)),
            span("chat1", "root", at(1), at(5), history("Plan my trip")),
            span("tool1", "root", at(6), at(8), {query: "flights"}),
            span("chat2", "root", at(9), at(14), history("Plan my trip")),
            span("tool2", "root", at(15), at(18), {query: "hotels"}),
            span("chat3", "root", at(19), at(25), history("Plan my trip")),
        ]
        const turns = groupTraceTurns(spans)
        expect(turns).toHaveLength(1)
        expect(turns[0].spanId).toBe("chat1")
        expect(turns[0].spans.map((item) => item.span_id)).toEqual([
            "chat1",
            "tool1",
            "chat2",
            "tool2",
            "chat3",
        ])
        expect(turns[0].userText).toBe("Plan my trip")
    })

    it("starts a turn where the history grows by a user message", () => {
        const spans = [
            span("root", null, at(0), at(40)),
            span("chat1", "root", at(1), at(5), history("Plan my trip")),
            span("tool1", "root", at(6), at(8)),
            span("chat2", "root", at(9), at(14), history("Plan my trip")),
            span("chat3", "root", at(20), at(25), history("Plan my trip", "Make it cheaper")),
            span("tool3", "root", at(26), at(28)),
            span("chat4", "root", at(29), at(33), history("Plan my trip", "Make it cheaper")),
        ]
        const turns = groupTraceTurns(spans)
        expect(turns.map((turn) => turn.spanId)).toEqual(["chat1", "chat3"])
        expect(turns.map((turn) => turn.spans.map((item) => item.span_id))).toEqual([
            ["chat1", "tool1", "chat2"],
            ["chat3", "tool3", "chat4"],
        ])
        expect(turns.map((turn) => turn.userText)).toEqual(["Plan my trip", "Make it cheaper"])
    })

    it("keeps one turn per exchange span that holds only the new user message", () => {
        // The Agenta runner wraps each exchange in a span; its LLM call nests below it with the
        // whole history, so only the wrappers are children of the root.
        const spans = [
            span("root", null, at(0), at(60)),
            span("turn1", "root", at(1), at(20), user("Plan my trip")),
            span("chat1", "turn1", at(2), at(10), history("Plan my trip")),
            span("turn2", "root", at(21), at(40), user("Make it cheaper")),
            span("chat2", "turn2", at(22), at(30), history("Plan my trip", "Make it cheaper")),
        ]
        const turns = groupTraceTurns(spans)
        expect(turns.map((turn) => turn.spanId)).toEqual(["turn1", "turn2"])
        expect(turns[1].spans.map((item) => item.span_id)).toEqual(["turn2", "chat2"])
        expect(turns.map((turn) => turn.userText)).toEqual(["Plan my trip", "Make it cheaper"])
    })

    it("gives a running turn no end time", () => {
        const spans = [
            span("root", null, at(0), ""),
            span("turn1", "root", at(1), at(5), user("one")),
            span("turn2", "root", at(6), "", user("two")),
            span("tool2", "turn2", at(7), at(9)),
        ]
        const turns = groupTraceTurns(spans)
        expect(turns[0].endTime).toBe(Date.parse(at(5)))
        expect(turns[1].startTime).toBe(Date.parse(at(6)))
        expect(turns[1].endTime).toBeNull()
    })

    it("reads the user text of a turn from text parts and JSON text", () => {
        const spans = [
            span("root", null, at(0), at(20)),
            span("turn1", "root", at(1), at(5), {
                messages: [{role: "user", content: [{type: "text", text: " Hello "}]}],
            }),
            span("turn2", "root", at(6), at(10), {
                messages: '[{"role": "user", "content": "From JSON"}]',
            }),
        ]
        expect(groupTraceTurns(spans).map((turn) => turn.userText)).toEqual(["Hello", "From JSON"])
    })

    it("returns no turn for no spans", () => {
        expect(groupTraceTurns([])).toEqual([])
    })
})
