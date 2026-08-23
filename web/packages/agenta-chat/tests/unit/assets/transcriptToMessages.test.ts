import type {
    SessionInteractionRowState,
    SessionInteractionRowStates,
    SessionRecord,
} from "@agenta/entities/session"
import {CLIENT_TOOL_INTERACTION_ENDED_OUTPUT} from "@agenta/shared/clientTools"
import {describe, expect, it} from "vitest"

import {
    APPROVED_EXECUTION_RESULT_UNKNOWN,
    transcriptToMessages,
} from "../../../src/assets/transcriptToMessages"

import abandonedFormSession from "./__fixtures__/abandonedFormSession.json"

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

describe("transcriptToMessages interaction-row precedence", () => {
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

    const rowState = (
        token: string,
        overrides: Partial<SessionInteractionRowState> = {},
    ): SessionInteractionRowState => ({
        token,
        status: "cancelled",
        kind: "client_tool",
        ...overrides,
    })
    const rowStates = (...rows: SessionInteractionRowState[]): SessionInteractionRowStates =>
        new Map(rows.map((row) => [row.token, row]))
    const toolParts = (
        records: SessionRecord[],
        interactionRowStates?: SessionInteractionRowStates,
    ): Record<string, unknown>[] =>
        (
            (transcriptToMessages(records, {interactionRowStates})?.[0].parts ??
                []) as unknown as Record<string, unknown>[]
        ).filter((part) => typeof part.toolCallId === "string")

    it("keeps a recorded tool result ahead of row state", () => {
        const output = {action: "accept", content: {repository: "octocat/Hello-World"}}
        const parts = toolParts(
            [
                elicitationRequest(),
                record("r-result", {
                    type: "tool_result",
                    id: elicitationToolCallId,
                    output,
                }),
            ],
            rowStates(
                rowState(elicitationToolCallId, {
                    status: "responded",
                    resolution: {outcome: "error", error: "stale error"},
                }),
            ),
        )

        expect(parts[0]).toMatchObject({state: "output-available", output})
    })

    it("renders a completed saved resolution", () => {
        const output = {action: "accept", content: {repository: "octocat/Hello-World"}}
        const parts = toolParts(
            [elicitationRequest()],
            rowStates(
                rowState(elicitationToolCallId, {
                    status: "responded",
                    resolution: {
                        tool_call_id: elicitationToolCallId,
                        tool_name: "request_input",
                        outcome: "completed",
                        output,
                    },
                }),
            ),
        )

        expect(parts[0]).toMatchObject({state: "output-available", output})
    })

    it("uses neutral output when a completed resolution has no object output", () => {
        const parts = toolParts(
            [elicitationRequest()],
            rowStates(
                rowState(elicitationToolCallId, {
                    status: "responded",
                    resolution: {outcome: "completed", output: "invalid"},
                }),
            ),
        )

        expect(parts[0]).toMatchObject({
            state: "output-available",
            output: CLIENT_TOOL_INTERACTION_ENDED_OUTPUT,
        })
    })

    it("renders an error saved resolution", () => {
        const parts = toolParts(
            [connectRequest()],
            rowStates(
                rowState(connectToolCallId, {
                    status: "responded",
                    resolution: {
                        tool_call_id: connectToolCallId,
                        tool_name: "request_connection",
                        outcome: "error",
                        error: "OAuth popup failed",
                    },
                }),
            ),
        )

        expect(parts[0]).toMatchObject({state: "output-error", errorText: "OAuth popup failed"})
    })

    it("renders neutral output for terminal rows without saved answers", () => {
        const parts = toolParts(
            [elicitationRequest(), connectRequest()],
            rowStates(rowState(elicitationToolCallId), rowState(connectToolCallId)),
        )
        const elicitation = parts.find((part) => part.toolCallId === elicitationToolCallId)
        const connect = parts.find((part) => part.toolCallId === connectToolCallId)

        expect(elicitation).toMatchObject({
            state: "output-available",
            output: CLIENT_TOOL_INTERACTION_ENDED_OUTPUT,
        })
        expect(connect).toMatchObject({
            state: "output-available",
            output: CLIENT_TOOL_INTERACTION_ENDED_OUTPUT,
        })
        expect(elicitation?.output).not.toEqual({action: "cancel"})
        expect(connect?.output).not.toEqual({connected: false, reason: "cancelled"})
    })

    it("leaves a pending row live", () => {
        const parts = toolParts(
            [elicitationRequest()],
            rowStates(rowState(elicitationToolCallId, {status: "pending"})),
        )

        expect(parts[0]).toMatchObject({state: "input-available"})
    })

    it("joins through a stamped tool-call id before the row token", () => {
        const output = {connected: true, integration: "telegram"}
        const parts = toolParts(
            [connectRequest()],
            rowStates(
                rowState("interaction-token", {
                    status: "responded",
                    toolCallId: connectToolCallId,
                    resolution: {outcome: "completed", output},
                }),
            ),
        )

        expect(parts[0]).toMatchObject({state: "output-available", output})
    })

    it("joins legacy rows through token equality", () => {
        const parts = toolParts(
            [elicitationRequest()],
            rowStates(rowState(elicitationToolCallId, {kind: "user_input", status: "resolved"})),
        )

        expect(parts[0]).toMatchObject({
            state: "output-available",
            output: CLIENT_TOOL_INTERACTION_ENDED_OUTPUT,
        })
    })

    it("never settles a client-tool part from a user-approval row", () => {
        const parts = toolParts(
            [connectRequest()],
            rowStates(rowState(connectToolCallId, {kind: "user_approval", status: "cancelled"})),
        )

        expect(parts[0]).toMatchObject({state: "input-available"})
    })

    // The gate is on a turn that never resumed, so no other pass settles it. Left
    // `approval-requested`, the whole-chat queue scan holds every typed message behind a gate
    // whose turn is long dead (review round 1, finding 2).
    const abandonedApprovalRecords = (): SessionRecord[] => [
        record("r-user-1", {type: "message", text: "delete the file"}, "user"),
        record("r-call", {
            type: "tool_call",
            id: "tool-1",
            name: "bash",
            input: {command: "rm notes.md"},
        }),
        record("r-req", {
            type: "interaction_request",
            id: "approval-1",
            kind: "user_approval",
            payload: {toolCallId: "tool-1"},
        }),
        record("r-done-paused", {type: "done", stopReason: "paused"}),
        record("r-user-2", {type: "message", text: "never mind, just say hi"}, "user"),
        record("r-msg", {type: "message", text: "hi"}),
        record("r-done", {type: "done"}),
    ]
    const allParts = (
        records: SessionRecord[],
        interactionRowStates?: SessionInteractionRowStates,
    ): Record<string, unknown>[] =>
        (transcriptToMessages(records, {interactionRowStates}) ?? []).flatMap(
            (message) => message.parts as unknown as Record<string, unknown>[],
        )

    it("leaves an abandoned approval gate pending when no row says otherwise", () => {
        const parts = allParts(abandonedApprovalRecords())

        expect(parts.some((part) => part.state === "approval-requested")).toBe(true)
    })

    it("settles an abandoned approval gate from its swept row", () => {
        const parts = allParts(
            abandonedApprovalRecords(),
            rowStates(rowState("approval-1", {kind: "user_approval", status: "cancelled"})),
        )

        expect(parts.some((part) => part.state === "approval-requested")).toBe(false)
        // Denied, not approved: the sweep proves only that the gate died unanswered, and the
        // gated tool never ran.
        expect(parts.find((part) => part.toolCallId === "tool-1")).toMatchObject({
            state: "output-denied",
        })
    })

    it("replays an answered approval row with its verdict", () => {
        const parts = allParts(
            abandonedApprovalRecords(),
            rowStates(
                rowState("approval-1", {
                    kind: "user_approval",
                    status: "resolved",
                    resolution: {verdict: "denied", tool_call_id: "tool-1"},
                }),
            ),
        )

        expect(parts.find((part) => part.toolCallId === "tool-1")).toMatchObject({
            state: "approval-responded",
            approval: {id: "approval-1", approved: false},
        })
    })

    it("keeps an answered approval row's approved verdict", () => {
        const parts = allParts(
            abandonedApprovalRecords(),
            rowStates(
                rowState("approval-1", {
                    kind: "user_approval",
                    status: "resolved",
                    resolution: {verdict: "approved", tool_call_id: "tool-1"},
                }),
            ),
        )

        expect(parts.find((part) => part.toolCallId === "tool-1")).toMatchObject({
            state: "approval-responded",
            approval: {id: "approval-1", approved: true},
        })
    })

    it("preserves record-only replay when row states are omitted", () => {
        expect(toolParts([elicitationRequest()])[0]).toMatchObject({state: "input-available"})
    })
})

/**
 * Golden replay of a REAL pre-fix session (live QA, 2026-08-10): dev stack session
 * `0b6a8c44-a975-4431-90e7-adbcab87c8e8`, whose single interaction row is
 * `client_tool` / `request_input` / `cancelled` with no resolution and no
 * `data.request.tool_call_id`. Its 44 records are the fixture, structurally untouched — only long
 * unrelated `read`/`ls` payloads are elided, never the form's own records.
 *
 * The shape that makes it interesting: the form's turn ends `done{stopReason:"paused"}` and the
 * NEXT turn starts with no user message between, so the two fold into one `resumed` draft. The
 * resumed-draft pass settles approval gates only, so nothing but the row can settle this card.
 */
describe("golden: an abandoned form card from a real pre-fix session", () => {
    const FORM_TOOL_CALL_ID =
        "call_Dd5g7Xd92RxD0l0TV55ul07V|fc_0b9b71f5a8fc3f56016a79dcd4ea7081a09d6aedfee011e1a6"
    const goldenRecords = abandonedFormSession as unknown as SessionRecord[]
    const formPart = (interactionRowStates?: SessionInteractionRowStates) =>
        (transcriptToMessages(goldenRecords, {interactionRowStates}) ?? [])
            .flatMap((message) => message.parts as unknown as Record<string, unknown>[])
            .find((part) => part.toolCallId === FORM_TOOL_CALL_ID)

    it("replays the form live when no row state is available", () => {
        expect(formPart()).toMatchObject({type: "tool-request_input", state: "input-available"})
    })

    it("settles the form to the neutral ended state from its cancelled row", () => {
        const part = formPart(
            new Map([
                [
                    FORM_TOOL_CALL_ID,
                    {token: FORM_TOOL_CALL_ID, status: "cancelled", kind: "client_tool"},
                ],
            ]) as SessionInteractionRowStates,
        )

        expect(part).toMatchObject({
            state: "output-available",
            output: CLIENT_TOOL_INTERACTION_ENDED_OUTPUT,
        })
        // Never the pre-fix guesses that made an answered form read as dismissed.
        expect(part?.output).not.toEqual({action: "cancel"})
    })
})

/**
 * The durable `tool_call` record wraps the model's arguments in an MCP envelope
 * (`{tool, server, arguments}`), while the live stream emits the bare ACP `rawInput`. Replay has to
 * hand the cards that same bare shape or a call that rendered a friendly card live comes back as
 * raw JSON on reload. Payload trimmed from real session `3d99d178-b76b-4eb7-a9e9-ad43295ee2b8`.
 */
describe("transcriptToMessages tool input unwrapping", () => {
    const bareArguments = {
        description: "تكوين الوكيل لإرسال قصيدة عربية يومية عبر تيليغرام.",
        workflow_revision: {
            delta: {
                operations: [
                    {
                        value: {
                            name: "telegram_send_message",
                            type: "gateway",
                            action: "SEND_MESSAGE",
                            provider: "composio",
                            connection: "telegram-main",
                            integration: "telegram",
                        },
                        target: ["parameters", "agent", "tools"],
                        operation: "add_item",
                    },
                ],
            },
            base_revision_id: "019fefed-a8a0-7720-bbe6-85b60d5b2ace",
        },
    }
    const wrappedInput = {tool: "commit_revision", server: "agenta-tools", arguments: bareArguments}

    const toolPart = (records: SessionRecord[]): Record<string, unknown> => {
        const messages = transcriptToMessages(records)
        expect(messages).not.toBeNull()
        return (messages?.[0].parts ?? [])[0] as unknown as Record<string, unknown>
    }

    const toolCall = (id: string, input: unknown): SessionRecord =>
        record(id, {
            type: "tool_call",
            id: "tool-1",
            name: "mcp.agenta-tools.commit_revision",
            input,
        })

    it("unwraps the envelope so the card reads `workflow_revision` at the top level", () => {
        const part = toolPart([toolCall("record-call", wrappedInput)])

        expect(part.input).toEqual(bareArguments)
        expect(part.input).toHaveProperty("workflow_revision")
        expect(part.input).not.toHaveProperty("arguments")
    })

    it("unwraps a resume's re-emitted call, which updates the kept part in place", () => {
        const part = toolPart([
            toolCall("record-call", wrappedInput),
            toolCall("record-resume-call", wrappedInput),
        ])

        expect(part.input).toEqual(bareArguments)
    })

    it("unwraps the envelope on a part built from an interaction_request", () => {
        const part = toolPart([
            record("record-request", {
                type: "interaction_request",
                id: "approval-1",
                kind: "user_approval",
                payload: {
                    toolCallId: "tool-1",
                    toolCall: {
                        kind: "execute",
                        toolCallId: "tool-1",
                        resolvedName: "commit_revision",
                        rawInput: wrappedInput,
                    },
                },
            }),
        ])

        expect(part.state).toBe("approval-requested")
        expect(part.input).toEqual(bareArguments)
    })

    it("passes an already-bare input through unchanged", () => {
        expect(toolPart([toolCall("record-call", bareArguments)]).input).toEqual(bareArguments)
    })

    it("leaves a real `arguments` field alone when a sibling is not an envelope key", () => {
        const realInput = {arguments: {"--json": true}, workflow_revision: {message: "keep me"}}

        expect(toolPart([toolCall("record-call", realInput)]).input).toEqual(realInput)
    })

    it("leaves a lone `arguments` field alone — nothing proves it is an envelope", () => {
        const realInput = {arguments: {"--json": true}}

        expect(toolPart([toolCall("record-call", realInput)]).input).toEqual(realInput)
    })
})

/** Parity with the OSS original: the durable record keeps codex-acp's `{tool, server, arguments}`
 * wrapper while the live stream hands the FE the bare ACP `rawInput`. Unwrap it, but only when
 * every sibling of `arguments` is a string-valued envelope key. */
describe("transcriptToMessages MCP argument wrapper", () => {
    const bareArgs = {description: "commit it", workflow_revision: {base_revision_id: "rev-1"}}
    const inputOf = (input: unknown): unknown => {
        const parts = (transcriptToMessages([
            record("r-call", {
                type: "tool_call",
                id: "exec-1",
                name: "mcp.agenta-tools.commit_revision",
                input,
            }),
        ])?.[0].parts ?? []) as unknown as Record<string, unknown>[]
        return parts[0]?.input
    }

    it("unwraps the wrapper so a replayed call matches the live part", () => {
        expect(
            inputOf({tool: "commit_revision", server: "agenta-tools", arguments: bareArgs}),
        ).toEqual(bareArgs)
    })

    it("leaves a real input that merely HAS an arguments field untouched", () => {
        expect(inputOf({arguments: {a: 1}, timeout: 30})).toEqual({arguments: {a: 1}, timeout: 30})
    })

    it("leaves a lookalike whose envelope key is not a string untouched", () => {
        expect(inputOf({tool: "x", server: 42, arguments: {a: 1}})).toEqual({
            tool: "x",
            server: 42,
            arguments: {a: 1},
        })
    })
})
