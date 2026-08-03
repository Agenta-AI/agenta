/**
 * Unit tests for `isClientToolPart` — the predicate that routes a tool part to the client-tool
 * dispatcher (and, for an unknown tool, to the auto-settling "not handled" fallback).
 *
 * The load-bearing case is DENY: a denied approval part lands in `output-denied` carrying its
 * `{approved: false}` envelope. Reading it as a parked client tool made the fallback overwrite that
 * envelope with `{status: "not_handled"}`, so the model saw a failed tool and retried the same call.
 */
import type {ToolUIPart} from "ai"
import {describe, expect, it} from "vitest"

import {isClientToolPart} from "./meta"

const settledCtx = {isStreaming: false, isLastMessage: true}

const toolPart = (part: Record<string, unknown>): ToolUIPart =>
    ({
        type: "tool-deleteFile",
        toolCallId: "call_1",
        input: {path: "/x"},
        ...part,
    }) as unknown as ToolUIPart

describe("isClientToolPart", () => {
    it("does NOT claim a denied approval part (output-denied)", () => {
        const part = toolPart({
            state: "output-denied",
            approval: {id: "perm_1", approved: false},
        })
        expect(isClientToolPart(part, settledCtx)).toBe(false)
    })

    it("does NOT claim any part carrying approval metadata, whatever its state", () => {
        for (const state of ["input-available", "output-denied", "output-available"]) {
            const part = toolPart({state, approval: {id: "perm_1"}})
            expect(isClientToolPart(part, settledCtx)).toBe(false)
        }
    })

    it("still claims a parked unknown client tool so the fallback settles it", () => {
        const part = toolPart({type: "tool-mysteryTool", state: "input-available"})
        expect(isClientToolPart(part, settledCtx)).toBe(true)
    })

    it("does NOT claim an unsettled tool while the turn is still streaming", () => {
        const part = toolPart({type: "tool-mysteryTool", state: "input-available"})
        expect(isClientToolPart(part, {isStreaming: true, isLastMessage: true})).toBe(false)
    })

    it("claims a known client tool in every state", () => {
        const part = toolPart({
            type: "tool-request_connection",
            state: "output-available",
            output: {connected: true},
        })
        expect(isClientToolPart(part, settledCtx)).toBe(true)
    })
})
