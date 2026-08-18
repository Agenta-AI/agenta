/**
 * Unit tests for `isClientToolPart` — the predicate that routes a tool part to the client-tool
 * dispatcher (and, for an unknown tool, to the auto-settling "not handled" fallback).
 *
 * The load-bearing case is DENY: a denied approval part lands in `output-denied` carrying its
 * `{approved: false}` envelope. Reading it as a parked client tool made the fallback overwrite that
 * envelope with `{status: "not_handled"}`, so the model saw a failed tool and retried the same call.
 */
import {isHitlPending, type RenderHintLike} from "@agenta/playground"
import type {ToolUIPart, UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {getPendingApprovals} from "../ApprovalDock"
import {getPendingConnectInteraction} from "../InteractionDock"

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

const EARLIER_PENDING_MESSAGES = [
    {
        id: "assistant-pending",
        role: "assistant",
        parts: [
            {
                type: "tool-browser_connection",
                toolCallId: "call-connect",
                state: "input-available",
                input: {integration: "github"},
            },
            {
                type: "data-render",
                data: {toolCallId: "call-connect", render: {kind: "connect"}},
            },
            {
                type: "tool-delete_file",
                toolCallId: "call-approval",
                state: "approval-requested",
                input: {path: "notes.txt"},
                approval: {id: "approval-earlier"},
            },
            {
                type: "data-approval-manifest",
                data: {toolCallId: "call-approval", manifest: {files: ["notes.txt"]}},
            },
        ],
    },
    {
        id: "user-next",
        role: "user",
        parts: [{type: "text", text: "continue"}],
    },
    {
        id: "assistant-last",
        role: "assistant",
        parts: [{type: "text", text: "Starting the next turn"}],
    },
] as unknown as UIMessage[]

describe("pending interaction geometry", () => {
    it("keeps earlier cards discoverable after a later message", () => {
        expect(isHitlPending(EARLIER_PENDING_MESSAGES)).toBe(true)
        expect(getPendingConnectInteraction(EARLIER_PENDING_MESSAGES)?.toolCallId).toBe(
            "call-connect",
        )
        expect(getPendingApprovals(EARLIER_PENDING_MESSAGES)).toEqual([
            {
                approvalId: "approval-earlier",
                toolName: "delete_file",
                input: {path: "notes.txt"},
                manifest: {files: ["notes.txt"]},
            },
        ])
    })
})

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

    it("falls back to tool name when the render kind is unknown", () => {
        const part = toolPart({type: "tool-request_input", state: "input-available"})
        expect(resolveClientToolHandler(clientToolMeta(part, renderMapFor("display")))).toBe(
            ElicitationWidget,
        )
    })

    it("still resolves the connect widget on both axes", () => {
        const part = toolPart({type: "tool-request_connection", state: "input-available"})
        expect(resolveClientToolHandler(clientToolMeta(part))).toBe(ConnectToolWidget)
        expect(resolveClientToolHandler(clientToolMeta(part, renderMapFor("connect")))).toBe(
            ConnectToolWidget,
        )
    })

    it("resolves harness-wrapped request_input names when no render hint arrived", () => {
        for (const wrapped of [
            "mcp__agenta-tools__request_input",
            "mcp.agenta-tools.request_input",
        ]) {
            const part = toolPart({type: `tool-${wrapped}`, state: "input-available"})
            expect(resolveClientToolHandler(clientToolMeta(part))).toBe(ElicitationWidget)
        }
    })

    it("does NOT unwrap a third-party MCP tool onto a platform widget", () => {
        const part = toolPart({type: "tool-mcp__github__request_input", state: "input-available"})
        expect(resolveClientToolHandler(clientToolMeta(part))).toBeNull()
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
