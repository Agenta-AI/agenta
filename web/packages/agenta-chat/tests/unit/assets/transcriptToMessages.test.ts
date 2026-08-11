import type {SessionRecord} from "@agenta/entities/session"
import {describe, expect, it} from "vitest"

import {
    APPROVED_EXECUTION_RESULT_UNKNOWN,
    transcriptToMessages,
} from "../../../src/assets/transcriptToMessages"

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
    it("replays the approved-content manifest as the egress's sibling data part", () => {
        // `tool-approval-request` is a strict object, so the manifest cannot ride the approval
        // itself; replay must mirror the live data part or a reload loses the card.
        const manifest = {
            version: 1,
            files: [{relativePath: "notes.md", bytes: 12, digest: "abc", executableBit: false}],
            diffs: [],
            totalBytes: 12,
            contentDigest: "def",
        }
        const messages = transcriptToMessages([
            record("record-call", {
                type: "tool_call",
                id: "tool-1",
                name: "commit_revision",
                input: {},
            }),
            record("record-request", {
                type: "interaction_request",
                id: "approval-1",
                kind: "user_approval",
                payload: {toolCallId: "tool-1", manifest},
            }),
        ])
        const parts = (messages?.[0].parts ?? []) as unknown as Record<string, unknown>[]

        expect(parts[0].state).toBe("approval-requested")
        const data = parts.find((p) => p.type === "data-approval-manifest")?.data as Record<
            string,
            unknown
        >
        expect(data).toBeDefined()
        expect(data.toolCallId).toBe("tool-1")
        expect(data.manifest).toEqual(manifest)
    })

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
 * A resumed turn must not replay as still parked, or a reload keeps the approval dock up on a
 * turn the user already answered.
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

describe("transcriptToMessages run failures", () => {
    const failure = (message: string, id = "record-error"): SessionRecord =>
        record(id, {type: "error", message})

    it("replays a persisted error through metadata.runError, not as body text", () => {
        const messages = transcriptToMessages([
            record("record-text", {type: "message", text: "Working on it."}),
            failure("tool call toolu_1 exceeded 300000ms"),
        ])

        expect(messages?.[0].parts).toEqual([{type: "text", text: "Working on it."}])
        expect(messages?.[0].metadata).toMatchObject({
            runError: {message: "tool call toolu_1 exceeded 300000ms"},
        })
    })

    it("keeps a turn whose only content was the failure", () => {
        const messages = transcriptToMessages([failure("the agent run failed")])

        expect(messages).toHaveLength(1)
        expect(messages?.[0].parts).toEqual([])
        expect(messages?.[0].metadata).toMatchObject({runError: {message: "the agent run failed"}})
    })

    it("keeps the root cause when a cascading error follows", () => {
        const messages = transcriptToMessages([
            failure("first failure", "record-error-1"),
            failure("second failure", "record-error-2"),
        ])

        expect(messages?.[0].metadata).toMatchObject({runError: {message: "first failure"}})
    })

    it("ignores an empty error message", () => {
        expect(transcriptToMessages([failure("   ")])).toBeNull()
    })
})

const firstPart = (records: SessionRecord[]): Record<string, unknown> => {
    const messages = transcriptToMessages(records)
    expect(messages).not.toBeNull()
    return messages?.[0].parts[0] as unknown as Record<string, unknown>
}

// Approval hydration (the cases not already covered by the approval-resume suites above).
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

/** A parked client tool replays with its `data-render` sibling, the only thing the client-tool
 * registry can dispatch on. Without it a reload settles the call as "not handled by this client"
 * instead of showing the widget. */
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

    it("refreshes a drifted tool call with the interaction's canonical name and input", () => {
        const parts = (transcriptToMessages([
            record("r-call", {
                type: "tool_call",
                id: toolCallId,
                name: "__ag__request_input",
                input: {message: "stale"},
            }),
            clientToolRequest(),
        ])?.[0].parts ?? []) as unknown as Record<string, unknown>[]

        expect(parts[0]).toMatchObject({
            type: "tool-request_input",
            toolCallId,
            input,
        })
    })

    it("emits no render part when the interaction carries no hint", () => {
        const parts = (transcriptToMessages([clientToolRequest({render: undefined})])?.[0].parts ??
            []) as unknown as Record<string, unknown>[]

        expect(parts.some((p) => p.type === "data-render")).toBe(false)
    })

    it("leaves a settled client tool settled (a later tool_result still wins)", () => {
        const parts = (transcriptToMessages([
            clientToolRequest(),
            record("r-result", {
                type: "tool_result",
                id: toolCallId,
                output: {action: "accept", content: {repository: "octocat/Hello-World"}},
            }),
        ])?.[0].parts ?? []) as unknown as Record<string, unknown>[]

        expect(parts[0]).toMatchObject({type: "tool-request_input", state: "output-available"})
    })
})

/**
 * Regression: a `session_interactions` row that reached a TERMINAL status (cancelled) server-side
 * with no corresponding `tool_result` in the transcript previously replayed as still fully
 * pending — an interactive, answerable form stacked above the real live interaction (live
 * evidence, session 3975e362-f64c-4e2d-8f4f-4f36c584bd91 on the 8180 dev stack).
 * `cancelledClientToolTokens` (keyed by `session_interactions.token` == the record's `toolCallId`)
 * is the join that fixes it — each client-tool kind renders inert exactly like its own live cancel.
 */
describe("transcriptToMessages cancelled client-tool interactions", () => {
    const elicitationToolCallId = "call_1|fc_1"
    const elicitationInput = {
        message: "Which repository?",
        requestedSchema: {type: "object", properties: {}},
    }
    const elicitationRequest = (): SessionRecord =>
        record("r-interaction", {
            type: "interaction_request",
            id: elicitationToolCallId,
            kind: "client_tool",
            payload: {
                toolCallId: elicitationToolCallId,
                toolName: "request_input",
                input: elicitationInput,
                render: {kind: "elicitation"},
            },
        })

    const connectToolCallId = "call_2|fc_2"
    const connectInput = {mode: "oauth", slug: "telegram", integration: "telegram"}
    const connectRequest = (): SessionRecord =>
        record("r-interaction", {
            type: "interaction_request",
            id: connectToolCallId,
            kind: "client_tool",
            payload: {
                toolCallId: connectToolCallId,
                toolName: "request_connection",
                input: connectInput,
                render: {kind: "connect"},
            },
        })

    it("cancelled: an elicitation replays inert (output-available, action:cancel), not as a form", () => {
        const parts = (transcriptToMessages([elicitationRequest()], {
            cancelledClientToolTokens: new Set([elicitationToolCallId]),
        })?.[0].parts ?? []) as unknown as Record<string, unknown>[]

        expect(parts[0]).toMatchObject({
            type: "tool-request_input",
            toolCallId: elicitationToolCallId,
            state: "output-available",
            output: {action: "cancel"},
            // The original request payload is untouched — the widget still needs it to render
            // its (now inert) chip, e.g. for a submitted-answers style summary.
            input: elicitationInput,
        })
    })

    it("cancelled: a connect request replays inert (connected:false, reason:cancelled)", () => {
        const parts = (transcriptToMessages([connectRequest()], {
            cancelledClientToolTokens: new Set([connectToolCallId]),
        })?.[0].parts ?? []) as unknown as Record<string, unknown>[]

        expect(parts[0]).toMatchObject({
            type: "tool-request_connection",
            toolCallId: connectToolCallId,
            state: "output-available",
            output: {connected: false, reason: "cancelled"},
        })
    })

    it("pending: a token NOT in the cancelled set still replays fully interactive (existing behavior)", () => {
        const parts = (transcriptToMessages([elicitationRequest()], {
            cancelledClientToolTokens: new Set(["some-other-token"]),
        })?.[0].parts ?? []) as unknown as Record<string, unknown>[]

        expect(parts[0]).toMatchObject({
            type: "tool-request_input",
            toolCallId: elicitationToolCallId,
            state: "input-available",
        })
    })

    it("pending: omitting the option entirely is a no-op (callers with no interaction join unaffected)", () => {
        const parts = (transcriptToMessages([elicitationRequest()])?.[0].parts ??
            []) as unknown as Record<string, unknown>[]

        expect(parts[0]).toMatchObject({state: "input-available"})
    })

    it("settled: a real tool_result still wins over a stale cancelled-token entry", () => {
        // Belt-and-suspenders: even if the interactions join is stale (says cancelled) but the
        // transcript itself shows a later real settle, the real settle must not be downgraded.
        const parts = (transcriptToMessages(
            [
                elicitationRequest(),
                record("r-result", {
                    type: "tool_result",
                    id: elicitationToolCallId,
                    output: {action: "accept", content: {repository: "octocat/Hello-World"}},
                }),
            ],
            {cancelledClientToolTokens: new Set([elicitationToolCallId])},
        )?.[0].parts ?? []) as unknown as Record<string, unknown>[]

        expect(parts[0]).toMatchObject({
            state: "output-available",
            output: {action: "accept", content: {repository: "octocat/Hello-World"}},
        })
    })

    it("cancelled: an unregistered client-tool kind still settles (empty output, no crash)", () => {
        const toolCallId = "call_unknownKind"
        const parts = (transcriptToMessages(
            [
                record("r-interaction", {
                    type: "interaction_request",
                    id: toolCallId,
                    kind: "client_tool",
                    payload: {toolCallId, toolName: "some_future_client_tool", input: {}},
                }),
            ],
            {cancelledClientToolTokens: new Set([toolCallId])},
        )?.[0].parts ?? []) as unknown as Record<string, unknown>[]

        expect(parts[0]).toMatchObject({state: "output-available", output: {}})
    })
})
