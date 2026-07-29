import type {SessionRecord} from "@agenta/entities/session"
import {describe, expect, it} from "vitest"

import {APPROVED_EXECUTION_RESULT_UNKNOWN, transcriptToMessages} from "./transcriptToMessages"

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

const firstPart = (records: SessionRecord[]): Record<string, unknown> => {
    const messages = transcriptToMessages(records)
    expect(messages).not.toBeNull()
    return messages?.[0].parts[0] as unknown as Record<string, unknown>
}

describe("transcriptToMessages approval hydration", () => {
    it("overlays a persisted approval response with the live response shape", () => {
        const part = firstPart([
            ...approvalRecords(),
            record("record-response", {
                type: "interaction_response",
                id: "approval-1",
                kind: "user_approval",
                payload: {toolCallId: "tool-1", approved: true},
            }),
        ])

        expect(part).toEqual({
            type: "tool-bash",
            toolCallId: "tool-1",
            state: "approval-responded",
            input: {command: "ls"},
            approval: {id: "approval-1", approved: true},
        })
    })

    it("keeps an unanswered request pending", () => {
        const part = firstPart(approvalRecords())

        expect(part.state).toBe("approval-requested")
        expect(part.approval).toEqual({id: "approval-1"})
    })

    it("lets an executed tool result supersede a later approval response", () => {
        const part = firstPart([
            ...approvalRecords(),
            record("record-result", {
                type: "tool_result",
                id: "tool-1",
                output: "done",
            }),
            record("record-response", {
                type: "interaction_response",
                id: "approval-1",
                kind: "user_approval",
                payload: {toolCallId: "tool-1", approved: true},
            }),
        ])

        expect(part.state).toBe("output-available")
        expect(part.output).toBe("done")
        expect(part.approval).toEqual({id: "approval-1"})
    })

    it("falls back to the interaction id when the response omits the tool-call id", () => {
        const part = firstPart([
            ...approvalRecords(),
            record("record-response", {
                type: "interaction_response",
                id: "approval-1",
                kind: "user_approval",
                payload: {approved: false},
            }),
        ])

        expect(part.state).toBe("approval-responded")
        expect(part.approval).toEqual({id: "approval-1", approved: false})
    })

    it("reopens deferred call b when its turn-2 approval request arrives", () => {
        const messages = transcriptToMessages([
            record("record-user", {type: "message", text: "run both writes"}, "user"),
            record("record-call-a", {
                type: "tool_call",
                id: "tool-a",
                name: "bash",
                input: {command: "write a"},
            }),
            record("record-call-b", {
                type: "tool_call",
                id: "tool-b",
                name: "bash",
                input: {command: "write b"},
            }),
            record("record-request-a", {
                type: "interaction_request",
                id: "approval-a",
                kind: "user_approval",
                payload: {toolCallId: "tool-a"},
            }),
            record("record-result-b-deferred", {
                type: "tool_result",
                id: "tool-b",
                output: "DEFERRED_NOT_EXECUTED: paused for another approval; retry the same call if still required.",
                isError: true,
            }),
            record("record-done-turn-1", {type: "done"}),
            record("record-user-turn-2", {type: "message", text: "run both writes"}, "user"),
            record("record-response-a", {
                type: "interaction_response",
                id: "approval-a",
                kind: "user_approval",
                payload: {toolCallId: "tool-a", approved: true},
            }),
            record("record-request-b", {
                type: "interaction_request",
                id: "approval-b",
                kind: "user_approval",
                payload: {
                    toolCallId: "tool-b",
                    toolCall: {
                        toolCallId: "tool-b",
                        name: "bash",
                        rawInput: {command: "write b"},
                    },
                },
            }),
            record("record-result-a", {
                type: "tool_result",
                id: "tool-a",
                output: APPROVED_EXECUTION_RESULT_UNKNOWN,
                isError: true,
            }),
            record("record-done-turn-2", {type: "done"}),
        ])

        expect(messages).not.toBeNull()
        expect(messages?.[0]).toMatchObject({
            role: "user",
            parts: [{type: "text", text: "run both writes"}],
        })
        const assistantParts = messages
            ?.filter((message) => message.role === "assistant")
            .flatMap((message) => message.parts) as unknown as Record<string, unknown>[]
        const callA = assistantParts.find((part) => part.toolCallId === "tool-a")
        const callB = assistantParts.find((part) => part.toolCallId === "tool-b")

        expect(callA).toMatchObject({
            state: "output-error",
            errorText: APPROVED_EXECUTION_RESULT_UNKNOWN,
            approval: {id: "approval-a", approved: true},
        })
        expect(callB).toEqual({
            type: "tool-bash",
            toolCallId: "tool-b",
            state: "approval-requested",
            input: {command: "write b"},
            approval: {id: "approval-b"},
        })
        expect(assistantParts.filter((part) => part.state === "approval-requested")).toEqual([
            callB,
        ])
    })

    it("keeps a real tool error closed when a late approval request arrives", () => {
        const part = firstPart([
            record("record-call-b", {
                type: "tool_call",
                id: "tool-b",
                name: "bash",
                input: {command: "write b"},
            }),
            record("record-result-b", {
                type: "tool_result",
                id: "tool-b",
                output: "permission denied",
                isError: true,
            }),
            record("record-done-turn-1", {type: "done"}),
            record("record-request-b", {
                type: "interaction_request",
                id: "approval-b",
                kind: "user_approval",
                payload: {toolCallId: "tool-b"},
            }),
        ])

        expect(part).toEqual({
            type: "tool-bash",
            toolCallId: "tool-b",
            state: "output-error",
            input: {command: "write b"},
            errorText: "permission denied",
        })
    })

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

describe("transcriptToMessages paused end-marker", () => {
    it("flags the message whose turn ended paused (done.stopReason)", () => {
        const messages = transcriptToMessages([
            ...approvalRecords(),
            record("record-done-paused", {type: "done", stopReason: "paused"}),
        ])
        expect(messages).not.toBeNull()
        expect(messages?.[0].metadata).toMatchObject({paused: true})
    })

    it("does not flag a normally completed turn", () => {
        const messages = transcriptToMessages([
            ...approvalRecords(),
            record("record-done-complete", {type: "done"}),
        ])
        expect(messages).not.toBeNull()
        expect((messages?.[0].metadata as {paused?: boolean} | undefined)?.paused).toBeUndefined()
    })
})

/**
 * Regression guard for issue #5530. The adoption guard must not go back to comparing message
 * counts: a turn grows IN PLACE here, so the count is identical before and after it completes.
 * If a mapper change ever makes these counts differ, revisit `shouldAdoptServerTranscript` —
 * do not "simplify" it back to a count comparison on the strength of that change.
 */
describe("transcriptToMessages turn growth is invisible to a message count", () => {
    const midTurn = (): SessionRecord[] => [
        ...approvalRecords(),
        record("record-done-paused", {type: "done", stopReason: "paused"}),
    ]

    const completed = (): SessionRecord[] => [
        ...midTurn(),
        record("record-response", {
            type: "interaction_response",
            id: "approval-1",
            kind: "user_approval",
            payload: {toolCallId: "tool-1", approved: true},
        }),
        record("record-result", {
            type: "tool_result",
            id: "tool-1",
            output: {stdout: "a.txt\nb.txt"},
        }),
        record("record-answer", {type: "message", text: "There are two files."}),
        record("record-done", {type: "done"}),
    ]

    it("renders the same number of messages before and after the turn finishes", () => {
        const partial = transcriptToMessages(midTurn())
        const full = transcriptToMessages(completed())

        expect(partial).toHaveLength(1)
        expect(full).toHaveLength(1)
        // Same messages, far more content — and far more records behind it.
        expect(completed().length).toBeGreaterThan(midTurn().length)
    })

    it("carries strictly more content in the completed turn", () => {
        const partial = transcriptToMessages(midTurn())
        const full = transcriptToMessages(completed())

        expect(full?.[0].parts.length).toBeGreaterThan(partial?.[0].parts.length ?? 0)
    })
})

describe("transcriptToMessages attachments", () => {
    it("rebuilds user attachment references as file parts with filenames", () => {
        const messages = transcriptToMessages([
            record(
                "record-user",
                {
                    type: "message",
                    text: "Inspect this",
                    attachments: [
                        {
                            attachmentId: "019c1e0a-f911-7000-8000-000000000001",
                            filename: "diagram.png",
                            mediaType: "image/png",
                            size: 42,
                        },
                    ],
                },
                "user",
            ),
        ])

        expect(messages?.[0]).toMatchObject({
            role: "user",
            parts: [
                {type: "text", text: "Inspect this"},
                {
                    type: "file",
                    filename: "diagram.png",
                    mediaType: "image/png",
                    providerMetadata: {
                        agenta: {attachmentId: "019c1e0a-f911-7000-8000-000000000001", size: 42},
                    },
                },
            ],
        })
        expect((messages?.[0].parts[1] as {url: string}).url).toContain(
            "/sessions/attachments/019c1e0a-f911-7000-8000-000000000001/content?session_id=session-1",
        )
    })

    it("ignores an attachment delivery record instead of rendering a part", () => {
        const delivery = record("record-delivery", {
            type: "attachment_delivery",
            attachmentId: "019c1e0a-f911-7000-8000-000000000001",
            outcome: "workspace_only",
            reasonCode: "model_modality_unknown",
            workingPath: "attachments/019c1e0a-f911-7000-8000-000000000001/archive.zip",
        })

        expect(transcriptToMessages([delivery])).toBeNull()
        expect(
            transcriptToMessages([
                record("record-text", {type: "message", text: "Done."}),
                delivery,
            ])?.[0].parts,
        ).toEqual([{type: "text", text: "Done."}])
    })
})
