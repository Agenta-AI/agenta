import type {SessionRecord} from "@agenta/entities/session"
import {describe, expect, it} from "vitest"

import {transcriptToMessages} from "../../../src/assets/transcriptToMessages"

const record = (id: string, payload: Record<string, unknown>, sender = "agent"): SessionRecord => ({
    id,
    session_id: "session-1",
    project_id: "project-1",
    event_index: null,
    sender,
    session_update: String(payload.type),
    payload,
    created_at: null,
})

describe("transcriptToMessages", () => {
    it("returns null for an empty transcript", () => {
        expect(transcriptToMessages([])).toBeNull()
    })

    it("returns null when records carry no renderable payload", () => {
        expect(transcriptToMessages([record("r1", {type: "done"})])).toBeNull()
    })

    it("splits assistant turns on a `done` boundary into separate messages", () => {
        const messages = transcriptToMessages([
            record("r1", {type: "message", text: "first turn"}),
            record("r2", {type: "done"}),
            record("r3", {type: "message", text: "second turn"}),
            record("r4", {type: "done"}),
        ])

        expect(messages).toHaveLength(2)
        expect(messages?.[0]).toMatchObject({
            id: "r1",
            role: "assistant",
            parts: [{type: "text", text: "first turn"}],
        })
        expect(messages?.[1]).toMatchObject({
            id: "r3",
            role: "assistant",
            parts: [{type: "text", text: "second turn"}],
        })
    })

    it("accumulates a streamed text turn from message_start/message_delta", () => {
        const messages = transcriptToMessages([
            record("r1", {type: "message_start", id: "text-1"}),
            record("r2", {type: "message_delta", id: "text-1", delta: "hel"}),
            record("r3", {type: "message_delta", id: "text-1", delta: "lo"}),
            record("r4", {type: "done"}),
        ])

        expect(messages).toHaveLength(1)
        expect(messages?.[0].parts).toEqual([{type: "text", text: "hello"}])
    })

    it("opens a new message when the sender role changes, even mid-turn", () => {
        const messages = transcriptToMessages([
            record("r1", {type: "message", text: "hi"}, "user"),
            record("r2", {type: "message", text: "hello back"}, "agent"),
        ])

        expect(messages).toHaveLength(2)
        expect(messages?.[0]).toMatchObject({role: "user"})
        expect(messages?.[1]).toMatchObject({role: "assistant"})
    })

    it("assembles a tool_call + tool_result pair into one settled tool part", () => {
        const messages = transcriptToMessages([
            record("r1", {
                type: "tool_call",
                id: "tool-1",
                name: "bash",
                input: {command: "ls"},
            }),
            record("r2", {type: "tool_result", id: "tool-1", output: "file.txt"}),
            record("r3", {type: "done"}),
        ])

        expect(messages).toHaveLength(1)
        expect(messages?.[0].parts).toEqual([
            {
                type: "tool-bash",
                toolCallId: "tool-1",
                state: "output-available",
                input: {command: "ls"},
                output: "file.txt",
            },
        ])
    })

    it("marks a tool call still awaiting its result as input-available", () => {
        const messages = transcriptToMessages([
            record("r1", {
                type: "tool_call",
                id: "tool-1",
                name: "search_docs",
                input: {query: "x"},
            }),
        ])

        expect(messages?.[0].parts).toEqual([
            {
                type: "tool-search_docs",
                toolCallId: "tool-1",
                state: "input-available",
                input: {query: "x"},
            },
        ])
    })

    it("marks a denied tool call as output-denied", () => {
        const messages = transcriptToMessages([
            record("r1", {type: "tool_call", id: "tool-1", name: "bash", input: {}}),
            record("r2", {type: "tool_result", id: "tool-1", denied: true}),
        ])

        expect(messages?.[0].parts[0]).toMatchObject({state: "output-denied"})
    })
})

const approvalRecords = (): SessionRecord[] => [
    record("record-call", {
        type: "tool_call",
        id: "tool-1",
        name: "bash",
        input: {command: "ls"},
    }),
    record("record-request", {
        type: "interaction_request",
        id: "approval-1",
        kind: "user_approval",
        payload: {toolCallId: "tool-1"},
    }),
]

/**
 * Ported from the OSS original (see the copy header): a resumed turn must not replay as still
 * parked, or a reload keeps the approval dock up on a turn the user already answered.
 */
describe("transcriptToMessages approval resume", () => {
    it("merges a paused turn with its resume into one message and settles the re-emitted call once", () => {
        // Real cold-replay shape (verified against records): a Write call pauses for approval, the
        // turn ends stopReason:"paused", then the resume turn RE-EMITS the same call id, settles it,
        // and finishes. Reload must match the single live turn, not a dangling "awaiting" bubble.
        const messages = transcriptToMessages([
            record("r-user", {type: "message", text: "write notes.md"}, "user"),
            record("r-thought-1", {type: "thought", text: "let me write it"}),
            record("r-call", {
                type: "tool_call",
                id: "tool-1",
                name: "Write",
                input: {path: "notes.md"},
            }),
            record("r-req", {
                type: "interaction_request",
                id: "approval-1",
                kind: "user_approval",
                payload: {toolCallId: "tool-1"},
            }),
            record("r-done-paused", {
                type: "done",
                stopReason: "paused",
                traceId: "trace-paused",
            }),
            // resume turn: re-emits the SAME call id, then settles it and finishes.
            record("r-call-reemit", {
                type: "tool_call",
                id: "tool-1",
                name: "Write",
                input: {path: "notes.md"},
            }),
            record("r-resp", {
                type: "interaction_response",
                id: "approval-1",
                kind: "user_approval",
                payload: {toolCallId: "tool-1", approved: true},
            }),
            record("r-result", {type: "tool_result", id: "tool-1", output: "written"}),
            record("r-thought-2", {type: "thought", text: "done"}),
            record("r-msg", {type: "message", text: "Done!"}),
            record("r-done", {type: "done", traceId: "trace-resume"}),
        ])

        expect(messages).not.toBeNull()
        // user + ONE merged assistant turn, not user + paused bubble + resumed bubble.
        expect(messages).toHaveLength(2)
        const assistant = messages![1]
        expect(assistant.role).toBe("assistant")

        // Exactly one Write tool part, settled to a single output-available — no duplicate.
        const toolParts = (assistant.parts as unknown as Record<string, unknown>[]).filter(
            (part) => "toolCallId" in part,
        )
        expect(toolParts).toHaveLength(1)
        expect(toolParts[0]).toMatchObject({toolCallId: "tool-1", state: "output-available"})

        // The resumed-and-completed turn is no longer flagged paused.
        expect(
            (assistant as unknown as {metadata?: {paused?: boolean}}).metadata?.paused,
        ).toBeFalsy()

        // "View full trace" on the merged turn links to the RESUME trace (where the tool ran),
        // not the paused turn's trace.
        expect((assistant as unknown as {metadata?: {traceId?: string}}).metadata?.traceId).toBe(
            "trace-resume",
        )
    })

    it("settles a resumed turn's gate even when the log has no interaction_response", () => {
        // Real shape of an approval answered on ANOTHER device (verified against `records`): the
        // paused turn carries the request, the resume turn carries only thought/usage/message/done —
        // no `interaction_response`, no re-emitted call, no `tool_result`. The gate must NOT replay
        // as pending, or the desktop reload keeps showing "Approval needed to continue".
        const messages = transcriptToMessages([
            record("r-user", {type: "message", text: "create hello.md"}, "user"),
            record("r-call", {
                type: "tool_call",
                id: "tool-1",
                name: "bash",
                input: {command: "cat > hello.md"},
            }),
            record("r-req", {
                type: "interaction_request",
                id: "approval-1",
                kind: "user_approval",
                payload: {toolCallId: "tool-1"},
            }),
            record("r-done-paused", {type: "done", stopReason: "paused"}),
            record("r-thought", {type: "thought", text: "the user approved it"}),
            record("r-msg", {type: "message", text: "Created hello.md"}),
            record("r-done", {type: "done"}),
        ])

        expect(messages).toHaveLength(2)
        const assistant = messages![1]
        const parts = assistant.parts as unknown as Record<string, unknown>[]
        expect(parts.filter((part) => part.state === "approval-requested")).toEqual([])
        expect(parts.find((part) => part.toolCallId === "tool-1")).toMatchObject({
            state: "approval-responded",
            approval: {id: "approval-1"},
        })
        expect(
            (assistant as unknown as {metadata?: {paused?: boolean}}).metadata?.paused,
        ).toBeFalsy()
    })

    it("keeps a still-parked turn's gate pending (no resume records yet)", () => {
        const messages = transcriptToMessages([
            record("r-user", {type: "message", text: "create hello.md"}, "user"),
            ...approvalRecords(),
            record("r-done-paused", {type: "done", stopReason: "paused"}),
        ])

        const parts = messages![1].parts as unknown as Record<string, unknown>[]
        expect(parts.find((part) => part.toolCallId === "tool-1")).toMatchObject({
            state: "approval-requested",
        })
    })

    it("leaves a denied call denied across the pause boundary", () => {
        const messages = transcriptToMessages([
            record("r-user", {type: "message", text: "create hello.md"}, "user"),
            ...approvalRecords(),
            record("r-done-paused", {type: "done", stopReason: "paused"}),
            record("r-result-denied", {type: "tool_result", id: "tool-1", denied: true}),
            record("r-msg", {type: "message", text: "Okay, skipping it."}),
            record("r-done", {type: "done"}),
        ])

        const parts = messages![1].parts as unknown as Record<string, unknown>[]
        expect(parts.find((part) => part.toolCallId === "tool-1")).toMatchObject({
            state: "output-denied",
        })
    })
})

/**
 * Cold approval resume: the harness re-raises the approved call under a NEW toolCallId, so the
 * response's `toolCallId` no longer matches the gated part. Only the interaction id still does.
 */
describe("transcriptToMessages cold approval resume (re-raised tool call id)", () => {
    const pausedTurn = (): SessionRecord[] => [
        record("r-user", {type: "message", text: "delete the file"}, "user"),
        record("r-call-old", {
            type: "tool_call",
            id: "tool-old",
            name: "bash",
            input: {command: "rm x"},
        }),
        record("r-req", {
            type: "interaction_request",
            id: "approval-1",
            kind: "user_approval",
            payload: {toolCallId: "tool-old"},
        }),
        record("r-done-paused", {type: "done", stopReason: "paused"}),
        record("r-call-new", {
            type: "tool_call",
            id: "tool-new",
            name: "bash",
            input: {command: "rm x"},
        }),
    ]

    const response = (approved: boolean): SessionRecord =>
        record("r-resp", {
            type: "interaction_response",
            id: "approval-1",
            kind: "user_approval",
            payload: {toolCallId: "tool-new", approved},
        })

    const errorResult = (): SessionRecord =>
        record("r-result", {
            type: "tool_result",
            id: "tool-new",
            output: "boom",
            isError: true,
        })

    const toolParts = (records: SessionRecord[]): Record<string, unknown>[] => {
        const messages = transcriptToMessages(records)
        expect(messages).not.toBeNull()
        return (messages ?? [])
            .flatMap((message) => message.parts as unknown as Record<string, unknown>[])
            .filter((part) => "toolCallId" in part)
    }

    it("settles the gated part when the response arrives before the re-raised result", () => {
        const parts = toolParts([
            ...pausedTurn(),
            response(true),
            errorResult(),
            record("r-done", {type: "done"}),
        ])

        expect(parts).toHaveLength(1)
        expect(parts[0]).toMatchObject({
            state: "output-error",
            errorText: "boom",
            approval: {id: "approval-1", approved: true},
        })
        expect(parts.filter((part) => part.state === "approval-requested")).toEqual([])
    })

    it("settles the gated part when the re-raised result arrives before the response", () => {
        const parts = toolParts([
            ...pausedTurn(),
            errorResult(),
            response(true),
            record("r-done", {type: "done"}),
        ])

        expect(parts).toHaveLength(1)
        expect(parts[0]).toMatchObject({
            state: "output-error",
            errorText: "boom",
            approval: {id: "approval-1", approved: true},
        })
        expect(parts.filter((part) => part.state === "approval-requested")).toEqual([])
    })

    it("resolves a denied re-raised call to output-denied", () => {
        const parts = toolParts([
            ...pausedTurn(),
            response(false),
            record("r-result", {type: "tool_result", id: "tool-new", denied: true}),
            record("r-done", {type: "done"}),
        ])

        expect(parts).toHaveLength(1)
        expect(parts[0]).toMatchObject({
            state: "output-denied",
            approval: {id: "approval-1", approved: false},
        })
        expect(parts.filter((part) => part.state === "approval-requested")).toEqual([])
    })
})

/** Parity with the OSS original: a parked client tool replays with its `data-render` sibling, the
 * only thing the client-tool registry can dispatch on. Without it a reload settles the call as
 * "not handled by this client" instead of showing the widget. */
describe("transcriptToMessages parked client tool", () => {
    const toolCallId = "call_1|fc_1"
    const input = {message: "Which repository?", requestedSchema: {type: "object", properties: {}}}
    const clientToolRequest = (payload: Record<string, unknown> = {}): SessionRecord =>
        record("r-interaction", {
            type: "interaction_request",
            id: toolCallId,
            kind: "client_tool",
            payload: {
                toolCallId,
                toolName: "request_input",
                input,
                render: {kind: "elicitation"},
                ...payload,
            },
        })

    it("replays the render hint as a sibling data part", () => {
        const parts = (transcriptToMessages([
            record("r-call", {type: "tool_call", id: toolCallId, name: "request_input", input}),
            clientToolRequest(),
            record("r-done", {type: "done", stopReason: "paused"}),
        ])?.[0].parts ?? []) as unknown as Record<string, unknown>[]

        expect(parts[0]).toMatchObject({
            type: "tool-request_input",
            toolCallId,
            state: "input-available",
        })
        expect(parts.find((p) => p.type === "data-render")?.data).toEqual({
            toolCallId,
            render: {kind: "elicitation"},
        })
    })

    it("synthesizes the tool part when the runner parked without surfacing the call", () => {
        const parts = (transcriptToMessages([clientToolRequest()])?.[0].parts ??
            []) as unknown as Record<string, unknown>[]

        expect(parts[0]).toMatchObject({
            type: "tool-request_input",
            toolCallId,
            state: "input-available",
            input,
        })
    })

    it("emits no render part when the interaction carries no hint", () => {
        const parts = (transcriptToMessages([clientToolRequest({render: undefined})])?.[0].parts ??
            []) as unknown as Record<string, unknown>[]

        expect(parts.some((p) => p.type === "data-render")).toBe(false)
    })
})
