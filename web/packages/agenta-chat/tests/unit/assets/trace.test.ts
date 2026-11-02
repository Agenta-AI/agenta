import type {UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {
    getMessageRunError,
    getMessageRunErrorCode,
    getMessageTraceId,
    getMessageUsage,
} from "../../../src/assets/trace"

describe("getMessageTraceId", () => {
    it("prefers message.metadata.traceId", () => {
        const message = {
            id: "m1",
            role: "assistant",
            metadata: {traceId: "trace-1"},
            parts: [],
        } as unknown as UIMessage
        expect(getMessageTraceId(message)).toBe("trace-1")
    })

    it("falls back to the data-trace part's traceId", () => {
        const message = {
            id: "m1",
            role: "assistant",
            parts: [{type: "data-trace", data: {traceId: "trace-2"}}],
        } as unknown as UIMessage
        expect(getMessageTraceId(message)).toBe("trace-2")
    })

    it("parses the trace id out of the data-trace part's url when no traceId is sent", () => {
        const message = {
            id: "m1",
            role: "assistant",
            parts: [{type: "data-trace", data: {url: "https://x/traces/abc123?tab=overview"}}],
        } as unknown as UIMessage
        expect(getMessageTraceId(message)).toBe("abc123")
    })

    it("returns undefined when nothing is present", () => {
        const message = {id: "m1", role: "assistant", parts: []} as unknown as UIMessage
        expect(getMessageTraceId(message)).toBeUndefined()
    })
})

describe("getMessageRunError", () => {
    it("returns the run error message when present and non-blank", () => {
        const message = {
            id: "m1",
            role: "assistant",
            metadata: {runError: {message: "boom"}},
            parts: [],
        } as unknown as UIMessage
        expect(getMessageRunError(message)).toBe("boom")
    })

    it("returns undefined for a blank message", () => {
        const message = {
            id: "m1",
            role: "assistant",
            metadata: {runError: {message: "   "}},
            parts: [],
        } as unknown as UIMessage
        expect(getMessageRunError(message)).toBeUndefined()
    })

    it("returns undefined when there is no runError", () => {
        const message = {id: "m1", role: "assistant", parts: []} as unknown as UIMessage
        expect(getMessageRunError(message)).toBeUndefined()
    })
})

describe("getMessageRunErrorCode", () => {
    it("reads the code off the run-error metadata", () => {
        const message = {
            id: "m1",
            role: "assistant",
            metadata: {runError: {message: "boom", code: "starter_credits_exhausted"}},
            parts: [],
        } as unknown as UIMessage
        expect(getMessageRunErrorCode(message)).toBe("starter_credits_exhausted")
    })

    it("falls back to the live data-agent-error part", () => {
        const message = {
            id: "m1",
            role: "assistant",
            parts: [{type: "data-agent-error", data: {code: "rate_limited", errorText: "boom"}}],
        } as unknown as UIMessage
        expect(getMessageRunErrorCode(message)).toBe("rate_limited")
    })

    it("prefers the metadata code over the part's", () => {
        const message = {
            id: "m1",
            role: "assistant",
            metadata: {runError: {message: "boom", code: "starter_credits_program_paused"}},
            parts: [{type: "data-agent-error", data: {code: "runner_error"}}],
        } as unknown as UIMessage
        expect(getMessageRunErrorCode(message)).toBe("starter_credits_program_paused")
    })

    it("ignores the numeric ParsedRunError code", () => {
        const message = {
            id: "m1",
            role: "assistant",
            metadata: {runError: {message: "boom", code: 402}},
            parts: [],
        } as unknown as UIMessage
        expect(getMessageRunErrorCode(message)).toBeUndefined()
    })

    it("returns undefined when nothing carries a code", () => {
        const message = {
            id: "m1",
            role: "assistant",
            metadata: {runError: {message: "boom"}},
            parts: [{type: "text", text: "hi"}],
        } as unknown as UIMessage
        expect(getMessageRunErrorCode(message)).toBeUndefined()
    })
})

describe("getMessageUsage", () => {
    it("maps the service's usage fields to the metrics-display names", () => {
        const message = {
            id: "m1",
            role: "assistant",
            metadata: {usage: {input: 10, output: 20, total: 30, cost: 0.01}},
            parts: [],
        } as unknown as UIMessage
        expect(getMessageUsage(message)).toEqual({
            promptTokens: 10,
            completionTokens: 20,
            totalTokens: 30,
            totalCost: 0.01,
        })
    })

    it("returns undefined when usage is absent", () => {
        const message = {id: "m1", role: "assistant", parts: []} as unknown as UIMessage
        expect(getMessageUsage(message)).toBeUndefined()
    })

    it("returns undefined when usage has no numeric fields", () => {
        const message = {
            id: "m1",
            role: "assistant",
            metadata: {usage: {input: "not-a-number"}},
            parts: [],
        } as unknown as UIMessage
        expect(getMessageUsage(message)).toBeUndefined()
    })
})
