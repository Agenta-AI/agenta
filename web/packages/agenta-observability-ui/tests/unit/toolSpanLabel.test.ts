import type {TraceSpanNode} from "@agenta/observability"
import {describe, expect, it} from "vitest"

import {toolSpanLabel} from "../../src/traceDrawer/toolSpanLabel"

const span = (spanType: string, inputs: unknown): TraceSpanNode =>
    ({
        span_id: "s-1",
        span_name: "execute_tool Bash",
        span_type: spanType,
        attributes: {ag: {data: {inputs}}},
    }) as unknown as TraceSpanNode

describe("toolSpanLabel", () => {
    it("labels a tool span with the description of its call", () => {
        expect(
            toolSpanLabel(
                span("tool", {arguments: {command: "pytest -q", description: "Run the tests"}}),
            ),
        ).toBe("Run the tests")
    })

    it("reads arguments written as JSON text", () => {
        expect(
            toolSpanLabel(span("tool", {arguments: '{"query": "EU dashboard incidents"}'})),
        ).toBe("EU dashboard incidents")
    })

    it("takes the description over the query, the skill and the name", () => {
        expect(
            toolSpanLabel(span("tool", {name: "x", skill: "y", query: "z", description: "first"})),
        ).toBe("first")
        expect(toolSpanLabel(span("tool", {name: "rename_session", skill: "memory"}))).toBe(
            "memory",
        )
    })

    it("keeps only the first line", () => {
        expect(toolSpanLabel(span("tool", {description: "Read the file\nthen grep it"}))).toBe(
            "Read the file",
        )
    })

    it("gives no label to a tool call with none of the label arguments", () => {
        expect(toolSpanLabel(span("tool", {arguments: {command: "ls"}}))).toBeNull()
        expect(toolSpanLabel(span("tool", null))).toBeNull()
    })

    it("gives no label to a span that is not a tool", () => {
        expect(toolSpanLabel(span("chat", {description: "Run the tests"}))).toBeNull()
    })
})
