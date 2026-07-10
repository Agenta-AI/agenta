/**
 * Unit tests for `getTraceErrorFromResponse` — the run-level error the agent chat bubble reads.
 *
 * The distinction under test: a failed TOOL call is a step the agent recovers from (it gets the
 * error back as output and keeps going), so it must NOT surface as the run's failure. Only a span
 * that represents the agent loop or the model turn (`agent`/`llm`/`chat`) counts. Keyed on
 * Agenta's own `span_type` field — not the OpenInference `openinference.span.kind` attribute.
 */

import {describe, it, expect} from "vitest"

import {getTraceErrorFromResponse} from "../../src/loadable/controller"

// Build a one-trace response whose root span holds the given children.
const trace = (rootChildren: Record<string, unknown>, rootOver: Record<string, unknown> = {}) =>
    ({
        traces: {
            t1: {
                spans: {
                    root: {
                        span_id: "root",
                        span_type: "agent",
                        status_code: "STATUS_CODE_UNSET",
                        ...rootOver,
                        spans: rootChildren,
                    },
                },
            },
        },
    }) as any

const errored = (span_type: string, message = "boom") => ({
    span_id: `s-${span_type}`,
    span_type,
    status_code: "STATUS_CODE_ERROR",
    status_message: message,
})

describe("getTraceErrorFromResponse — tool failures are not run failures", () => {
    it("does NOT surface a failed tool span as the run error", () => {
        const res = trace({tool1: errored("tool", "file not found")})
        expect(getTraceErrorFromResponse(res)).toBeUndefined()
    })

    it("ignores tool errors even when several tools failed", () => {
        const res = trace({
            tool1: errored("tool", "404"),
            tool2: errored("tool", "timeout"),
        })
        expect(getTraceErrorFromResponse(res)).toBeUndefined()
    })

    it("surfaces a swallowed model error on a leaf llm/chat span", () => {
        const res = trace({chat1: errored("chat", "insufficient quota")})
        expect(getTraceErrorFromResponse(res)).toBe("insufficient quota")
    })

    it("surfaces a run failure stamped on the agent/root span", () => {
        const res = trace({}, {status_code: "STATUS_CODE_ERROR", status_message: "run failed hard"})
        expect(getTraceErrorFromResponse(res)).toBe("run failed hard")
    })

    it("prefers the real model error over the tool failures in the same turn", () => {
        // The reported bug's shape: tools failed AND the model turn errored — the model error is
        // the real cause; the tool errors must not shadow or substitute for it.
        const res = trace({
            tool1: errored("tool", "404"),
            chat1: errored("chat", "rate limited"),
        })
        expect(getTraceErrorFromResponse(res)).toBe("rate limited")
    })

    it("still descends through a tool span to find a real error nested under it", () => {
        const res = trace({
            tool1: {
                ...errored("tool", "tool wrapper failed"),
                spans: {chat1: errored("chat", "auth failed")},
            },
        })
        expect(getTraceErrorFromResponse(res)).toBe("auth failed")
    })

    it("returns undefined for a clean run", () => {
        const res = trace({
            chat1: {span_id: "chat1", span_type: "chat", status_code: "STATUS_CODE_OK"},
            tool1: {span_id: "tool1", span_type: "tool", status_code: "STATUS_CODE_OK"},
        })
        expect(getTraceErrorFromResponse(res)).toBeUndefined()
    })
})
