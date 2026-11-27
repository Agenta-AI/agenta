import type {TraceSpanNode} from "@agenta/observability"
import {describe, expect, it} from "vitest"

import {groupTurns, userMessageOf} from "../../src/traceDrawer/groupTurns"

const node = (
    id: string,
    inputs: unknown,
    times: [string, string] = ["2026-11-27T10:00:00Z", "2026-11-27T10:00:01Z"],
): TraceSpanNode =>
    ({
        span_id: id,
        span_name: id,
        span_type: "agent",
        start_time: times[0],
        end_time: times[1],
        attributes: {ag: {data: {inputs}}},
    }) as unknown as TraceSpanNode

const userTurn = (id: string, text: string, times?: [string, string]) =>
    node(id, {messages: [{role: "user", content: text}]}, times)

const root = (children: TraceSpanNode[]) =>
    ({span_id: "root", span_name: "conversation", children}) as unknown as TraceSpanNode

describe("groupTurns", () => {
    it("makes one turn per child of the root with a user message", () => {
        const result = groupTurns(
            root([
                userTurn("a", "Fix the failing test in the date parser.", [
                    "2026-11-27T10:00:00Z",
                    "2026-11-27T10:00:20.300Z",
                ]),
                userTurn("b", "Now run the whole suite."),
                userTurn("c", "Ship it."),
            ]),
        )
        expect(result?.turns.map((turn) => [turn.index, turn.message])).toEqual([
            [1, "Fix the failing test in the date parser."],
            [2, "Now run the whole suite."],
            [3, "Ship it."],
        ])
        expect(result?.turns[0].durationMs).toBe(20300)
    })

    it("puts the spans up to the next turn under the turn, and earlier spans before the turns", () => {
        const result = groupTurns(
            root([
                node("setup", {config: true}),
                userTurn("a", "First"),
                node("tool-1", {command: "ls"}),
                userTurn("b", "Second"),
            ]),
        )
        expect(result?.leading.map((span) => span.span_id)).toEqual(["setup"])
        expect(result?.turns[0].spans.map((span) => span.span_id)).toEqual(["a", "tool-1"])
        expect(result?.turns[1].spans.map((span) => span.span_id)).toEqual(["b"])
    })

    it("has nothing to group with fewer than two turns", () => {
        expect(groupTurns(root([userTurn("a", "Only one"), node("tool", {})]))).toBeNull()
        expect(groupTurns(root([]))).toBeNull()
        expect(groupTurns(undefined)).toBeNull()
    })

    it("labels a turn with the last user message of its input", () => {
        expect(
            userMessageOf(
                node("a", [
                    {role: "user", content: "Earlier question"},
                    {role: "assistant", content: "Earlier answer"},
                    {role: "user", content: "This turn"},
                ]),
            ),
        ).toBe("This turn")
        expect(userMessageOf(node("b", {role: "user", content: "One message"}))).toBe("One message")
        expect(userMessageOf(node("c", {prompt: "not a message"}))).toBeNull()
    })

    it("leaves the duration empty while the turn runs", () => {
        const running = node("b", {messages: [{role: "user", content: "Second"}]})
        ;(running as {end_time?: string | null}).end_time = null
        const result = groupTurns(root([userTurn("a", "First"), running]))
        expect(result?.turns[1].durationMs).toBeNull()
    })
})
