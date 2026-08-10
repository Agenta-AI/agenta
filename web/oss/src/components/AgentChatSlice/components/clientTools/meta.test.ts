/**
 * Unit tests for `isClientToolPart` — the predicate that routes a tool part to the client-tool
 * dispatcher (and, for an unknown tool, to the auto-settling "not handled" fallback).
 *
 * The load-bearing case is DENY: a denied approval part lands in `output-denied` carrying its
 * `{approved: false}` envelope. Reading it as a parked client tool made the fallback overwrite that
 * envelope with `{status: "not_handled"}`, so the model saw a failed tool and retried the same call.
 */
import type {RenderHintLike} from "@agenta/playground"
import type {ToolUIPart} from "ai"
import {describe, expect, it} from "vitest"

import ConnectToolWidget from "./ConnectToolWidget"
import ElicitationWidget from "./ElicitationWidget"
import {clientToolMeta, isClientToolPart} from "./meta"
import {resolveClientToolHandler} from "./registry"

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

/**
 * Registry dispatch. `request_input` MUST resolve to the elicitation form on both axes: the
 * `render.kind` sibling part (the wire contract) and its tool name (the safety net for a replayed
 * or old transcript that carries no hint). Falling through to the fallback answers the agent
 * `{status: "not_handled"}` instead of showing the form.
 */
describe("resolveClientToolHandler", () => {
    const renderMapFor = (kind: string): Map<string, RenderHintLike> =>
        new Map([["call_1", {kind}]])

    it("resolves request_input by its render kind", () => {
        const part = toolPart({type: "tool-request_input", state: "input-available"})
        expect(resolveClientToolHandler(clientToolMeta(part, renderMapFor("elicitation")))).toBe(
            ElicitationWidget,
        )
    })

    it("resolves request_input by tool name when no render hint arrived", () => {
        const part = toolPart({type: "tool-request_input", state: "input-available"})
        expect(resolveClientToolHandler(clientToolMeta(part))).toBe(ElicitationWidget)
    })

    it("does not reinterpret an explicit unknown render kind by tool name", () => {
        const part = toolPart({type: "tool-request_input", state: "input-available"})
        expect(resolveClientToolHandler(clientToolMeta(part, renderMapFor("display")))).toBeNull()
    })

    it("still resolves the connect widget on both axes", () => {
        const part = toolPart({type: "tool-request_connection", state: "input-available"})
        expect(resolveClientToolHandler(clientToolMeta(part))).toBe(ConnectToolWidget)
        expect(resolveClientToolHandler(clientToolMeta(part, renderMapFor("connect")))).toBe(
            ConnectToolWidget,
        )
    })

    it("leaves an unknown client tool to the fallback", () => {
        const part = toolPart({type: "tool-mysteryTool", state: "input-available"})
        expect(resolveClientToolHandler(clientToolMeta(part))).toBeNull()
    })

    it("claims a parked request_input while the turn is still streaming (known tool)", () => {
        const part = toolPart({type: "tool-request_input", state: "input-available"})
        expect(isClientToolPart(part, {isStreaming: true, isLastMessage: true})).toBe(true)
    })
})
