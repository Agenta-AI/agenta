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

    it("returns no turn for no spans", () => {
        expect(groupTraceTurns([])).toEqual([])
    })
})
