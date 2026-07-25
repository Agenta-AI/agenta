import type {ToolUIPart, UIMessage} from "ai"
import {describe, expect, it, vi} from "vitest"

import {
    buildTurnViewModels,
    createExecutedToolIdentityCache,
    toolPartsSignature,
} from "../../../src/model/turnViewModel"

const user = (id: string, text: string): UIMessage =>
    ({id, role: "user", parts: [{type: "text", text}]}) as UIMessage

const assistant = (id: string, parts: unknown[]): UIMessage =>
    ({id, role: "assistant", parts}) as unknown as UIMessage

const toolPart = (toolCallId: string, state: string, input: unknown = {q: 1}) => ({
    type: "tool-search",
    toolCallId,
    state,
    input,
})

describe("toolPartsSignature", () => {
    it("keys on tool-call id + state and ignores streamed text", () => {
        const parts = [
            {type: "text", text: "partial"},
            toolPart("c1", "output-available"),
            toolPart("c2", "input-available"),
        ] as UIMessage["parts"]
        expect(toolPartsSignature(parts)).toBe("c1:output-available|c2:input-available")
        // More text streaming in does not change the signature.
        const more = [...parts, {type: "text", text: "more"}] as UIMessage["parts"]
        expect(toolPartsSignature(more)).toBe(toolPartsSignature(parts))
    })
})

describe("createExecutedToolIdentityCache", () => {
    it("reuses the executed set while the signature is stable and recomputes on a state flip", () => {
        const executedFor = createExecutedToolIdentityCache()
        const m1 = assistant("a1", [toolPart("c1", "input-available")])
        const first = executedFor(m1)
        expect(first.size).toBe(0)
        // Same signature (text streamed, tools unchanged) → the SAME set instance comes back.
        const m1b = assistant("a1", [toolPart("c1", "input-available"), {type: "text", text: "x"}])
        expect(executedFor(m1b)).toBe(first)
        // The tool settles → new signature → recomputed set now holds the identity.
        const m1c = assistant("a1", [toolPart("c1", "output-available")])
        const second = executedFor(m1c)
        expect(second).not.toBe(first)
        expect(second.size).toBe(1)
    })
})

describe("buildTurnViewModels", () => {
    it("marks the active turn group and the streaming turn", () => {
        const messages = [
            user("u1", "one"),
            assistant("a1", [{type: "text", text: "first answer"}]),
            user("u2", "two"),
            assistant("a2", [{type: "text", text: "streami"}]),
        ]
        const turns = buildTurnViewModels(messages, {
            busy: true,
            executedFor: createExecutedToolIdentityCache(),
        })
        expect(turns.map((t) => t.isActive)).toEqual([false, false, true, true])
        expect(turns.map((t) => t.isStreamingTurn)).toEqual([false, false, false, true])
        expect(turns[3].isLast).toBe(true)
        expect(turns[3].status.hasAnswer).toBe(true)
    })

    it("collapses a run of empty no-response turns down to the first", () => {
        const messages = [
            user("u1", "go"),
            assistant("a1", []),
            assistant("a2", []),
            assistant("a3", []),
        ]
        const turns = buildTurnViewModels(messages, {
            busy: false,
            executedFor: createExecutedToolIdentityCache(),
        })
        expect(turns[1].status.noResponse).toBe(true)
        expect(turns[1].hidden).toBe(false) // the first empty turn still shows "no response"
        expect(turns[2].hidden).toBe(true)
        expect(turns[3].hidden).toBe(true)
    })

    it("drops a superseded approval gate once its executed sibling exists", () => {
        const input = {cmd: "ls"}
        const messages = [
            user("u1", "run it"),
            assistant("a1", [
                {...toolPart("gate-1", "approval-responded", input)},
                {...toolPart("exec-1", "output-available", input)},
            ]),
        ]
        const turns = buildTurnViewModels(messages, {
            busy: false,
            executedFor: createExecutedToolIdentityCache(),
        })
        const items = turns[1].items
        expect(items).toHaveLength(1)
        expect(items[0].kind).toBe("tools")
        const group = items[0] as {kind: "tools"; parts: ToolUIPart[]}
        expect(group.parts.map((p) => p.toolCallId)).toEqual(["exec-1"])
    })

    it("splits client-tool parts out of the tool fold via the parameterized predicate", () => {
        const messages = [
            user("u1", "connect"),
            assistant("a1", [
                toolPart("c1", "output-available", {a: 1}),
                {
                    type: "tool-request_connection",
                    toolCallId: "ct-1",
                    state: "input-available",
                    input: {},
                },
                toolPart("c2", "output-available", {b: 2}),
            ]),
        ]
        const isClientToolPart = vi.fn(
            (part: ToolUIPart) => (part.type as string) === "tool-request_connection",
        )
        const turns = buildTurnViewModels(messages, {
            busy: false,
            executedFor: createExecutedToolIdentityCache(),
            isClientToolPart,
        })
        expect(turns[1].items.map((i) => i.kind)).toEqual(["tools", "clientTool", "tools"])
        // The predicate receives the desktop's context shape (streaming + last-message flags).
        expect(isClientToolPart).toHaveBeenCalledWith(
            expect.objectContaining({toolCallId: "ct-1"}),
            {isStreaming: false, isLastMessage: true},
        )
    })

    it("surfaces a stamped run error and borrows the paired trace for user turns", () => {
        const failed = {
            id: "a1",
            role: "assistant",
            parts: [],
            metadata: {runError: {message: "boom"}, traceId: "tr-1"},
        } as unknown as UIMessage
        const turns = buildTurnViewModels([user("u1", "go"), failed], {
            busy: false,
            executedFor: createExecutedToolIdentityCache(),
        })
        expect(turns[1].status.errorText).toBe("boom")
        expect(turns[1].status.isError).toBe(true)
        expect(turns[1].traceId).toBe("tr-1")
        // The user turn has no trace of its own; it borrows the next assistant turn's.
        expect(turns[0].turnTraceId).toBe("tr-1")
    })
})
