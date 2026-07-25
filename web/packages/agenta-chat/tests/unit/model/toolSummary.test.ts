import type {ToolUIPart} from "ai"
import {describe, expect, it} from "vitest"

import {
    isNotHandledOutput,
    isSettled,
    rowSummary,
    stripFence,
    summarizeOutput,
    type ToolSummaryDisplay,
} from "../../../src/model/toolSummary"

describe("summarizeOutput", () => {
    it("counts array results, pluralized", () => {
        expect(summarizeOutput([1, 2])).toBe("2 results")
    })

    it("counts a single array result as singular", () => {
        expect(summarizeOutput([1])).toBe("1 result")
    })

    it("normalizes whitespace and clamps a long string to 80 chars with an ellipsis", () => {
        const long = "a".repeat(100)
        const result = summarizeOutput(long)
        expect(result).toBe(`${"a".repeat(80)}…`)
    })

    it("collapses internal whitespace runs to a single space", () => {
        expect(summarizeOutput("hello   \n  world")).toBe("hello world")
    })

    it("prefers a well-known field over the generic field count", () => {
        expect(summarizeOutput({summary: "done"})).toBe("done")
    })

    it("falls back to a field count when no well-known field matches", () => {
        expect(summarizeOutput({a: 1, b: 2})).toBe("2 fields")
    })

    it("returns null for an empty object", () => {
        expect(summarizeOutput({})).toBeNull()
    })

    it("returns null for a nullish output", () => {
        expect(summarizeOutput(null)).toBeNull()
        expect(summarizeOutput(undefined)).toBeNull()
    })
})

describe("isNotHandledOutput", () => {
    it("is true for a status: not_handled envelope", () => {
        expect(isNotHandledOutput({status: "not_handled"})).toBe(true)
    })

    it("is false for any other status", () => {
        expect(isNotHandledOutput({status: "ok"})).toBe(false)
    })

    it("is false for a non-object output", () => {
        expect(isNotHandledOutput("not_handled")).toBe(false)
        expect(isNotHandledOutput(null)).toBe(false)
    })
})

describe("isSettled", () => {
    it("is true for the three settled tool states", () => {
        expect(isSettled("output-available")).toBe(true)
        expect(isSettled("output-error")).toBe(true)
        expect(isSettled("output-denied")).toBe(true)
    })

    it("is false for in-flight states", () => {
        expect(isSettled("input-streaming")).toBe(false)
        expect(isSettled("approval-requested")).toBe(false)
        expect(isSettled("approval-responded")).toBe(false)
    })
})

describe("stripFence", () => {
    it("strips a markdown code fence spanning the whole string", () => {
        expect(stripFence('```json\n{"a":1}\n```')).toBe('{"a":1}')
    })

    it("leaves a string with no wrapping fence untouched", () => {
        expect(stripFence("plain text")).toBe("plain text")
    })
})

describe("rowSummary", () => {
    it("labels a not_handled output-available part", () => {
        const part = {state: "output-available", output: {status: "not_handled"}} as ToolUIPart
        expect(rowSummary(part)).toBe("not handled by this client")
    })

    it("prefers a registered display.summary over the generic shape heuristics", () => {
        const display: ToolSummaryDisplay = {
            summary: () => "  custom   result  ",
        }
        const part = {
            state: "output-available",
            input: {q: "x"},
            output: {irrelevant: true},
        } as ToolUIPart
        expect(rowSummary(part, display)).toBe("custom result")
    })

    it("falls back to shape heuristics when display.summary returns null", () => {
        const display: ToolSummaryDisplay = {summary: () => null}
        const part = {state: "output-available", output: [1, 2, 3]} as ToolUIPart
        expect(rowSummary(part, display)).toBe("3 results")
    })

    it("labels a deferred (not-yet-executed) error", () => {
        const part = {
            state: "output-error",
            errorText: "DEFERRED_NOT_EXECUTED: waiting on sibling",
        } as ToolUIPart
        expect(rowSummary(part)).toBe("waiting on another approval")
    })

    it("labels an approved-but-unknown-result error", () => {
        const part = {
            state: "output-error",
            errorText: "APPROVED_EXECUTION_RESULT_UNKNOWN: no output recorded",
        } as ToolUIPart
        expect(rowSummary(part)).toBe("approved, result unknown")
    })

    it("labels a generic output-error as failed", () => {
        const part = {state: "output-error", errorText: "boom"} as ToolUIPart
        expect(rowSummary(part)).toBe("failed")
    })

    it("labels a denied state", () => {
        const part = {state: "output-denied"} as ToolUIPart
        expect(rowSummary(part)).toBe("denied")
    })

    it("returns null for a state that hasn't settled yet", () => {
        const part = {state: "input-streaming"} as ToolUIPart
        expect(rowSummary(part)).toBeNull()
    })
})
