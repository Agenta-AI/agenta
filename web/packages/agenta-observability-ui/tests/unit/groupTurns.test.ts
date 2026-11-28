import type {TraceSpanNode} from "@agenta/observability"
import {describe, expect, it} from "vitest"

import {countTurns, groupTurns} from "../../src/traceDrawer/groupTurns"

const node = (
    id: string,
    inputs: unknown,
    times: [string, string | null] = ["2026-11-27T10:00:00Z", "2026-11-27T10:00:01Z"],
    children: TraceSpanNode[] = [],
    parent = "root",
): TraceSpanNode =>
    ({
        span_id: id,
        parent_id: parent,
        span_name: id,
        span_type: "agent",
        start_time: times[0],
        end_time: times[1],
        attributes: {ag: {data: {inputs}}},
        children,
    }) as unknown as TraceSpanNode

const userTurn = (id: string, text: string, times?: [string, string | null]) =>
    node(id, {messages: [{role: "user", content: text}]}, times)

const root = (children: TraceSpanNode[]) =>
    ({
        span_id: "root",
        parent_id: null,
        span_name: "conversation",
        start_time: "2026-11-27T09:59:59Z",
        end_time: "2026-11-27T10:05:00Z",
        children,
    }) as unknown as TraceSpanNode

describe("groupTurns", () => {
    it("makes one row per turn of the trace, labeled with the user's message", () => {
        const rows = groupTurns(
            root([
                userTurn("a", "Fix the failing test in the date parser.", [
                    "2026-11-27T10:00:00Z",
                    "2026-11-27T10:00:20.300Z",
                ]),
                userTurn("b", "Now run the whole suite.", [
                    "2026-11-27T10:01:00Z",
                    "2026-11-27T10:01:05Z",
                ]),
                userTurn("c", "Ship it.", ["2026-11-27T10:02:00Z", "2026-11-27T10:02:01Z"]),
            ]),
        )
        expect(rows?.map((row) => [row.index, row.message, row.spanId])).toEqual([
            [1, "Fix the failing test in the date parser.", "a"],
            [2, "Now run the whole suite.", "b"],
            [3, "Ship it.", "c"],
        ])
        expect(rows?.[0].durationMs).toBe(20300)
    })

    it("puts the root's children up to the next turn under the turn", () => {
        const rows = groupTurns(
            root([
                userTurn("a", "First", ["2026-11-27T10:00:00Z", "2026-11-27T10:00:01Z"]),
                node("tool-1", {command: "ls"}, ["2026-11-27T10:00:02Z", "2026-11-27T10:00:03Z"]),
                userTurn("b", "Second", ["2026-11-27T10:00:04Z", "2026-11-27T10:00:05Z"]),
            ]),
        )
        expect(rows?.[0].spans.map((span) => span.span_id)).toEqual(["a", "tool-1"])
        expect(rows?.[1].spans.map((span) => span.span_id)).toEqual(["b"])
    })

    it("has nothing to group with fewer than two turns", () => {
        const one = root([userTurn("a", "Only one"), node("tool", {})])
        expect(groupTurns(one)).toBeNull()
        expect(countTurns(one)).toBe(1)
        expect(groupTurns(root([]))).toBeNull()
        expect(groupTurns(undefined)).toBeNull()
    })

    it("reads the turns from the whole trace and draws the filtered tree's children", () => {
        const whole = root([
            userTurn("a", "First", ["2026-11-27T10:00:00Z", "2026-11-27T10:00:01Z"]),
            userTurn("b", "Second", ["2026-11-27T10:00:04Z", "2026-11-27T10:00:05Z"]),
        ])
        const searched = {...whole, children: [whole.children![1]]} as TraceSpanNode
        const rows = groupTurns(searched, whole)
        expect(rows?.map((row) => row.spans.map((span) => span.span_id))).toEqual([[], ["b"]])
    })

    it("labels a turn with the last user message of the span that starts it", () => {
        const history = (texts: string[]) =>
            texts.flatMap((text) => [
                {role: "user", content: text},
                {role: "assistant", content: `Answer to ${text}`},
            ])
        const rows = groupTurns(
            root([
                node("a", {messages: history(["Earlier question"])}),
                node("b", {messages: history(["Earlier question", "This turn"])}, [
                    "2026-11-27T10:00:02Z",
                    "2026-11-27T10:00:03Z",
                ]),
            ]),
        )
        expect(rows?.map((row) => row.message)).toEqual(["Earlier question", "This turn"])
    })

    it("keeps one exchange as one turn when sibling LLM calls repeat its history", () => {
        // An agent whose LLM calls sit under the root: the second call carries the same history.
        const call = (id: string, times: [string, string]) =>
            node(id, {prompt: [{role: "user", content: "Plan the outreach"}]}, times)
        const one = root([
            call("llm-1", ["2026-11-27T10:00:00Z", "2026-11-27T10:00:01Z"]),
            node("tool", {command: "ls"}, ["2026-11-27T10:00:02Z", "2026-11-27T10:00:03Z"]),
            call("llm-2", ["2026-11-27T10:00:04Z", "2026-11-27T10:00:05Z"]),
        ])
        expect(countTurns(one)).toBe(1)
        expect(groupTurns(one)).toBeNull()
    })

    it("leaves the duration empty while the turn runs", () => {
        const rows = groupTurns(
            root([
                userTurn("a", "First", ["2026-11-27T10:00:00Z", "2026-11-27T10:00:01Z"]),
                userTurn("b", "Second", ["2026-11-27T10:00:04Z", null]),
            ]),
        )
        expect(rows?.[1].durationMs).toBeNull()
        expect(rows?.[0].durationMs).toBe(1000)
    })

    it("leaves the duration empty while a span inside the turn runs", () => {
        const running = node("tool", {command: "ls"}, ["2026-11-27T10:00:05Z", null], [], "b")
        const b = {
            ...userTurn("b", "Second", ["2026-11-27T10:00:04Z", "2026-11-27T10:00:06Z"]),
            children: [running],
        } as TraceSpanNode
        const rows = groupTurns(
            root([userTurn("a", "First", ["2026-11-27T10:00:00Z", "2026-11-27T10:00:01Z"]), b]),
        )
        expect(rows?.[1].durationMs).toBeNull()
    })
})
