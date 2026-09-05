import type {SessionLiveFrame, SessionSnapshot} from "@agenta/entities/session"
import {describe, expect, it} from "vitest"

import {
    createSessionLivePreviewState,
    deriveRemoteTurnPresentation,
    isSessionSnapshotRunning,
    reduceSessionLivePreview,
    retireSessionLivePreview,
    markSessionLivePreviewTerminal,
    sessionLivePreviewMessages,
    shouldRefreshLegacyObserverLiveness,
    shouldSubscribeToSessionLivePreview,
    withoutSharedSenderAcceptanceMessages,
} from "../../../src/model/livePreview"

const frame = (
    frameIndex: number,
    type: string,
    payload: Record<string, unknown>,
    entityId = "text-1",
): SessionLiveFrame => ({
    version: 1,
    kind: "frame",
    session_id: "session-1",
    execution_id: "turn-1",
    frame_or_event_id: `turn-1:${frameIndex}`,
    frame_index: frameIndex,
    entity_id: entityId,
    type,
    payload,
    created_at: "2026-08-06T12:00:00Z",
})

describe("session live preview reducer", () => {
    it("removes the control-only invoke message but preserves an invoke error", () => {
        const accepted = {
            id: "accepted",
            role: "assistant",
            parts: [{type: "data-session-accepted", data: {turnId: "turn-1"}}],
            metadata: {sharedSender: true},
        }
        const failed = {
            ...accepted,
            id: "failed",
            metadata: {sharedSender: true, runError: {message: "failed"}},
        }
        const ordinary = {id: "ordinary", role: "assistant", parts: [{type: "text", text: "ok"}]}

        expect(
            withoutSharedSenderAcceptanceMessages([accepted, failed, ordinary] as never[]).map(
                (message) => message.id,
            ),
        ).toEqual(["failed", "ordinary"])
    })

    it("drops the control row and keeps a real invoke error", () => {
        const user = {id: "u1", role: "user", parts: [{type: "text", text: "hi"}]}
        const carrier = {
            id: "accepted",
            role: "assistant",
            parts: [{type: "step-start"}],
            metadata: {sharedSender: true},
        }
        const invokeError = {
            ...carrier,
            metadata: {sharedSender: true, runError: {message: "no usable credential", code: 422}},
        }

        expect(
            withoutSharedSenderAcceptanceMessages([user, invokeError] as never[]).map((m) => m.id),
        ).toEqual(["u1", "accepted"])
        expect(
            withoutSharedSenderAcceptanceMessages([user, carrier] as never[]).map((m) => m.id),
        ).toEqual(["u1"])
    })

    it("recognizes a running execution from the atomic reconnect snapshot", () => {
        const snapshot = {
            session: {flags: {is_running: true}},
            execution: {turn_id: "turn-1", end_time: null},
        } as SessionSnapshot

        expect(isSessionSnapshotRunning(snapshot)).toBe(true)
        expect(
            isSessionSnapshotRunning({
                ...snapshot,
                execution: {...snapshot.execution, end_time: "2026-08-06T12:01:00Z"},
            } as SessionSnapshot),
        ).toBe(false)
        expect(
            isSessionSnapshotRunning({
                ...snapshot,
                session: {...snapshot.session, flags: {is_running: false}},
            } as SessionSnapshot),
        ).toBe(false)
    })

    it("collapses ordered frames into their current entity state", () => {
        let state = createSessionLivePreviewState()
        state = reduceSessionLivePreview(state, frame(0, "text-start", {}))
        state = reduceSessionLivePreview(state, frame(1, "text-delta", {delta: "hello "}))
        state = reduceSessionLivePreview(state, frame(2, "text-delta", {delta: "world"}))

        expect(state.executionOrder).toEqual(["turn-1"])
        expect(state.byExecution["turn-1"].lastFrameIndex).toBe(2)
        expect(state.byExecution["turn-1"].entityOrder).toEqual(["text-1"])
        expect(sessionLivePreviewMessages(state)[0].parts).toEqual([
            {type: "text", text: "hello world"},
        ])
    })

    it("deduplicates repeated frame ids", () => {
        const initial = createSessionLivePreviewState()
        const once = reduceSessionLivePreview(initial, frame(0, "text-delta", {delta: "once"}))
        const twice = reduceSessionLivePreview(once, frame(0, "text-delta", {delta: "once"}))

        expect(twice).toBe(once)
        expect(sessionLivePreviewMessages(twice)[0].parts).toEqual([{type: "text", text: "once"}])
    })

    it("ignores a stale frame index without retaining a dedupe history", () => {
        const first = reduceSessionLivePreview(
            createSessionLivePreviewState(),
            frame(0, "text-delta", {delta: "new"}),
        )
        const current = reduceSessionLivePreview(first, frame(1, "text-delta", {delta: "er"}))
        const stale = reduceSessionLivePreview(current, frame(0, "text-delta", {delta: "old"}))

        expect(stale).toBe(current)
        expect(sessionLivePreviewMessages(stale)[0].parts).toEqual([{type: "text", text: "newer"}])
    })

    it("accepts a late join cursor without rendering a missing text prefix", () => {
        const joined = reduceSessionLivePreview(
            createSessionLivePreviewState(),
            frame(2, "text-delta", {delta: "tail"}),
        )
        const later = reduceSessionLivePreview(joined, frame(3, "text-delta", {delta: " later"}))

        expect(joined.gapDetected).toBe(false)
        expect(sessionLivePreviewMessages(joined)).toEqual([])
        expect(sessionLivePreviewMessages(later)).toEqual([])
        expect(later.byExecution["turn-1"].lastFrameIndex).toBe(3)
    })

    it("preserves a preview and suppresses further deltas after an internal frame gap", () => {
        const first = reduceSessionLivePreview(
            createSessionLivePreviewState(),
            frame(0, "text-delta", {delta: "hello"}),
        )
        const gapped = reduceSessionLivePreview(first, frame(2, "text-delta", {delta: " tail"}))
        const missing = reduceSessionLivePreview(gapped, frame(1, "text-delta", {delta: " world"}))

        expect(gapped.gapDetected).toBe(true)
        expect(gapped.executionOrder).toEqual(["turn-1"])
        expect(sessionLivePreviewMessages(gapped)).toEqual(sessionLivePreviewMessages(first))
        expect(missing).toBe(gapped)
    })

    it("updates one tool part by entity id through input and output", () => {
        let state = createSessionLivePreviewState()
        state = reduceSessionLivePreview(
            state,
            frame(0, "tool-input-start", {toolCallId: "call-1", toolName: "write_file"}, "call-1"),
        )
        state = reduceSessionLivePreview(
            state,
            frame(
                1,
                "tool-input-available",
                {toolCallId: "call-1", toolName: "write_file", input: {path: "note.md"}},
                "call-1",
            ),
        )
        state = reduceSessionLivePreview(
            state,
            frame(
                2,
                "tool-output-available",
                {toolCallId: "call-1", output: {written: true}},
                "call-1",
            ),
        )

        expect(sessionLivePreviewMessages(state)[0].parts).toEqual([
            {
                type: "dynamic-tool",
                toolCallId: "call-1",
                toolName: "write_file",
                state: "output-available",
                input: {path: "note.md"},
                output: {written: true},
            },
        ])
    })

    it("keeps 5,000 deltas bounded to one entity with the same final text", () => {
        let state = createSessionLivePreviewState()
        for (let index = 0; index < 5_000; index += 1) {
            state = reduceSessionLivePreview(state, frame(index, "text-delta", {delta: "x"}))
        }

        const execution = state.byExecution["turn-1"]
        expect(execution.lastFrameIndex).toBe(4_999)
        expect(execution.entityOrder).toEqual(["text-1"])
        expect(Object.keys(execution.byEntity)).toEqual(["text-1"])
        expect(sessionLivePreviewMessages(state)[0].parts).toEqual([
            {type: "text", text: "x".repeat(5_000)},
        ])
    })
})

describe("session live preview subscription", () => {
    it.each([
        {sharedReaderAdvertised: false, runningElsewhere: false, sender: false, expected: false},
        {sharedReaderAdvertised: false, runningElsewhere: true, sender: false, expected: false},
        {sharedReaderAdvertised: false, runningElsewhere: false, sender: true, expected: false},
        {sharedReaderAdvertised: true, runningElsewhere: false, sender: false, expected: false},
        {sharedReaderAdvertised: true, runningElsewhere: true, sender: false, expected: true},
        {sharedReaderAdvertised: true, runningElsewhere: false, sender: true, expected: true},
    ])(
        "returns $expected when advertised=$sharedReaderAdvertised, remote=$runningElsewhere, sender=$sender",
        ({sharedReaderAdvertised, runningElsewhere, sender, expected}) => {
            expect(
                shouldSubscribeToSessionLivePreview({
                    sharedReaderAdvertised,
                    runningElsewhere,
                    sender,
                }),
            ).toBe(expected)
        },
    )
})

describe("legacy observer liveness refresh", () => {
    it("refreshes from record notifications only when the reader is off and the throttle is due", () => {
        expect(
            shouldRefreshLegacyObserverLiveness({
                sharedReaderAdvertised: false,
                lastRefreshAt: 1_000,
                now: 11_000,
            }),
        ).toBe(true)
        expect(
            shouldRefreshLegacyObserverLiveness({
                sharedReaderAdvertised: false,
                lastRefreshAt: 1_000,
                now: 10_999,
            }),
        ).toBe(false)
        expect(
            shouldRefreshLegacyObserverLiveness({
                sharedReaderAdvertised: true,
                lastRefreshAt: 1_000,
                now: 11_000,
            }),
        ).toBe(false)
    })
})

describe("durable preview handoff", () => {
    it("retires only adopted tool output while preserving text and the next frame cursor", () => {
        let state = createSessionLivePreviewState()
        state = reduceSessionLivePreview(state, frame(0, "text-start", {}))
        state = reduceSessionLivePreview(state, frame(1, "text-delta", {delta: "Still writing"}))
        state = reduceSessionLivePreview(
            state,
            frame(
                2,
                "tool-input-available",
                {
                    toolCallId: "tool-1",
                    toolName: "shell",
                    input: {},
                },
                "tool-1",
            ),
        )
        state = retireSessionLivePreview(state, {
            version: 1,
            kind: "event",
            session_id: "session-1",
            execution_id: "turn-1",
            frame_or_event_id: "record-1",
            sequence: 1,
            watermark: 1,
            type: "tool.completed",
            payload: {tool_call_id: "tool-1"},
            created_at: "2026-09-06T00:00:00Z",
        })
        expect(sessionLivePreviewMessages(state)[0].parts).toEqual([
            {type: "text", text: "Still writing"},
        ])
        state = reduceSessionLivePreview(state, frame(3, "text-delta", {delta: " more"}))
        expect(state.gapDetected).toBe(false)
        expect(sessionLivePreviewMessages(state)[0].parts).toEqual([
            {type: "text", text: "Still writing more"},
        ])
        state = reduceSessionLivePreview(
            state,
            frame(
                4,
                "tool-output-available",
                {
                    toolCallId: "tool-1",
                    output: "done",
                },
                "tool-1",
            ),
        )
        expect(sessionLivePreviewMessages(state)[0].parts).toHaveLength(1)
    })

    it("renders a resumed execution whose paused turn had no preview frames", () => {
        let state = markSessionLivePreviewTerminal(createSessionLivePreviewState(), {
            execution_id: "turn-1",
            created_at: "2026-09-06T00:00:00Z",
        })
        state = reduceSessionLivePreview(state, {
            ...frame(0, "text-delta", {delta: "Resumed"}),
            created_at: "2026-09-06T00:00:01Z",
        })
        expect(sessionLivePreviewMessages(state)[0].parts).toEqual([
            {type: "text", text: "Resumed"},
        ])
    })

    it("preserves a same-execution resumed prompt when paused adoption finishes late", () => {
        let state = reduceSessionLivePreview(
            createSessionLivePreviewState(),
            frame(0, "text-delta", {delta: "Before approval"}),
        )
        const boundary = state
        state = markSessionLivePreviewTerminal(state, {
            execution_id: "turn-1",
            created_at: "2026-09-06T00:00:00Z",
        })
        const marked = state
        state = reduceSessionLivePreview(state, {
            ...frame(12, "text-delta", {delta: "Delayed old text"}, "late-old-entity"),
            created_at: "2026-09-05T23:59:59Z",
        })
        expect(state).toBe(marked)
        state = reduceSessionLivePreview(state, {
            ...frame(0, "text-start", {}, "resumed-text"),
            created_at: "2026-09-06T00:00:01Z",
        })
        state = reduceSessionLivePreview(state, {
            ...frame(1, "text-delta", {delta: "Resumed"}, "resumed-text"),
            created_at: "2026-09-06T00:00:01Z",
        })
        state = retireSessionLivePreview(
            state,
            {
                version: 1,
                kind: "event",
                session_id: "session-1",
                execution_id: "turn-1",
                frame_or_event_id: "paused-record",
                sequence: 2,
                watermark: 2,
                type: "execution.stopped",
                payload: {reason: "paused"},
                created_at: "2026-09-06T00:00:00Z",
            },
            boundary,
        )
        state = reduceSessionLivePreview(state, {
            ...frame(2, "text-delta", {delta: " successfully"}, "resumed-text"),
            created_at: "2026-09-06T00:00:01Z",
        })
        expect(sessionLivePreviewMessages(state)[0].parts).toEqual([
            {type: "text", text: "Resumed successfully"},
        ])
        expect(state.gapDetected).toBe(false)
    })

    it("retires only reasoning actually present in the adopted durable transcript", () => {
        let state = reduceSessionLivePreview(
            createSessionLivePreviewState(),
            frame(0, "reasoning-start", {}, "reason-1"),
        )
        state = reduceSessionLivePreview(
            state,
            frame(1, "reasoning-delta", {delta: "Earlier thought"}, "reason-1"),
        )
        state = reduceSessionLivePreview(state, frame(2, "reasoning-end", {}, "reason-1"))
        state = reduceSessionLivePreview(state, frame(3, "text-start", {}, "text-1"))
        state = reduceSessionLivePreview(state, frame(4, "text-delta", {delta: "Answer"}, "text-1"))
        const boundary = state
        state = reduceSessionLivePreview(state, frame(5, "reasoning-start", {}, "reason-2"))
        state = reduceSessionLivePreview(
            state,
            frame(6, "reasoning-delta", {delta: "Still thinking"}, "reason-2"),
        )
        const durable = [
            {
                id: "durable",
                role: "assistant" as const,
                parts: [
                    {type: "reasoning" as const, text: "Earlier thought"},
                    {type: "text" as const, text: "Answer"},
                ],
            },
        ]
        state = retireSessionLivePreview(
            state,
            {
                version: 1,
                kind: "event",
                session_id: "session-1",
                execution_id: "turn-1",
                frame_or_event_id: "text-record",
                sequence: 2,
                watermark: 2,
                type: "message.completed",
                payload: {message_id: "text-1"},
                created_at: "2026-09-06T00:00:00Z",
            },
            boundary,
            durable,
        )
        expect(sessionLivePreviewMessages(state)[0].parts).toEqual([
            {type: "reasoning", text: "Still thinking"},
        ])
        expect(
            [...durable, ...sessionLivePreviewMessages(state)]
                .flatMap((message) => message.parts)
                .filter((part) => part.type === "reasoning" && part.text === "Earlier thought"),
        ).toHaveLength(1)
    })

    it("continues new complete entities after a gap without joining incomplete text", () => {
        let state = reduceSessionLivePreview(
            createSessionLivePreviewState(),
            frame(0, "text-delta", {delta: "Prefix"}),
        )
        state = reduceSessionLivePreview(state, frame(2, "text-delta", {delta: "missing middle"}))
        state = {...state, gapDetected: false}
        state = reduceSessionLivePreview(state, frame(5, "text-start", {}, "new-text"))
        state = reduceSessionLivePreview(
            state,
            frame(6, "text-delta", {delta: "New complete message"}, "new-text"),
        )
        expect(sessionLivePreviewMessages(state)[0].parts).toEqual([
            {type: "text", text: "Prefix"},
            {type: "text", text: "New complete message"},
        ])
    })

    it("retires a terminal execution without erasing another live execution", () => {
        let state = reduceSessionLivePreview(
            createSessionLivePreviewState(),
            frame(0, "text-delta", {delta: "Finished"}),
        )
        state = reduceSessionLivePreview(state, {
            ...frame(0, "text-delta", {delta: "Next turn"}),
            execution_id: "turn-2",
        })
        state = retireSessionLivePreview(state, {
            version: 1,
            kind: "event",
            session_id: "session-1",
            execution_id: "turn-1",
            frame_or_event_id: "record-done",
            sequence: 2,
            watermark: 2,
            type: "execution.stopped",
            payload: {},
            created_at: "2026-09-06T00:00:00Z",
        })
        expect(sessionLivePreviewMessages(state).map((message) => message.parts)).toEqual([
            [{type: "text", text: "Next turn"}],
        ])
        const late = reduceSessionLivePreview(state, frame(1, "text-delta", {delta: "late"}))
        expect(sessionLivePreviewMessages(late)).toEqual(sessionLivePreviewMessages(state))
    })

    it("retains visible text when a missing frame requires durable catch-up", () => {
        let state = reduceSessionLivePreview(
            createSessionLivePreviewState(),
            frame(0, "text-start", {}),
        )
        state = reduceSessionLivePreview(state, frame(1, "text-delta", {delta: "Visible prefix"}))
        state = reduceSessionLivePreview(state, frame(3, "text-delta", {delta: "after gap"}))
        expect(state.gapDetected).toBe(true)
        expect(sessionLivePreviewMessages(state)[0].parts).toEqual([
            {type: "text", text: "Visible prefix"},
        ])
    })
})

describe("remote turn presentation", () => {
    it("ignores liveness cached before shared completion", () => {
        expect(
            deriveRemoteTurnPresentation({
                livenessRunning: true,
                snapshotRunning: false,
                sharedSettledAt: 20,
                livenessUpdatedAt: 10,
                sharedReaderAdvertised: true,
                readerReady: true,
            }),
        ).toEqual({showActivity: false, showRemoteStop: false})
    })

    it("keeps an accepted continuation active before its first shared event", () => {
        expect(
            deriveRemoteTurnPresentation({
                livenessRunning: false,
                snapshotRunning: false,
                sharedSettledAt: 20,
                livenessUpdatedAt: 10,
                sharedReaderAdvertised: true,
                readerReady: true,
                ownedContinuation: true,
            }),
        ).toEqual({showActivity: true, showRemoteStop: false})
    })

    it("allows a new remote run after liveness is refreshed", () => {
        expect(
            deriveRemoteTurnPresentation({
                livenessRunning: true,
                livenessUpdatedAt: 30,
                sharedSettledAt: 20,
                snapshotRunning: false,
                sharedReaderAdvertised: true,
                readerReady: true,
            }).showActivity,
        ).toBe(true)
    })

    it("uses liveness until any shared completion is known", () => {
        expect(
            deriveRemoteTurnPresentation({
                livenessRunning: true,
                snapshotRunning: false,
                sharedSettledAt: 0,
                livenessUpdatedAt: 10,
                sharedReaderAdvertised: true,
                readerReady: true,
            }).showActivity,
        ).toBe(true)
    })

    it("keeps activity across reader connection changes and clears when the execution settles", () => {
        for (const readerReady of [false, true, false]) {
            expect(
                deriveRemoteTurnPresentation({
                    livenessRunning: false,
                    snapshotRunning: true,
                    sharedReaderAdvertised: true,
                    readerReady,
                }).showActivity,
            ).toBe(true)
        }
        for (const sharedReaderAdvertised of [false, true]) {
            for (const readerReady of [false, true]) {
                expect(
                    deriveRemoteTurnPresentation({
                        livenessRunning: false,
                        snapshotRunning: false,
                        sharedReaderAdvertised,
                        readerReady,
                    }),
                ).toEqual({showActivity: false, showRemoteStop: false})
            }
        }
    })

    it("shows activity for accepted sender ownership before snapshot liveness catches up", () => {
        expect(
            deriveRemoteTurnPresentation({
                livenessRunning: false,
                snapshotRunning: true,
                sharedReaderAdvertised: true,
                readerReady: false,
                ownedContinuation: true,
            }),
        ).toEqual({showActivity: true, showRemoteStop: false})
    })

    it.each([
        {
            name: "uses turn activity once the advertised reader is ready",
            input: {livenessRunning: true, sharedReaderAdvertised: true, readerReady: true},
            expected: {showActivity: true, showRemoteStop: false},
        },
        {
            name: "keeps activity while the reader connects and offers remote Stop",
            input: {livenessRunning: true, sharedReaderAdvertised: true, readerReady: false},
            expected: {showActivity: true, showRemoteStop: true},
        },
        {
            name: "keeps activity for a legacy observer and offers remote Stop",
            input: {livenessRunning: true, sharedReaderAdvertised: false, readerReady: false},
            expected: {showActivity: true, showRemoteStop: true},
        },
        {
            name: "shows activity for an owned continuation without remote Stop",
            input: {
                livenessRunning: true,
                sharedReaderAdvertised: true,
                readerReady: false,
                ownedContinuation: true,
            },
            expected: {showActivity: true, showRemoteStop: false},
        },
    ])("$name", ({input, expected}) => {
        expect(deriveRemoteTurnPresentation(input)).toEqual(expected)
    })

    it("uses session-stream liveness for the flag-off observer and clears at turn end", () => {
        const base = {
            snapshotRunning: true,
            sharedReaderAdvertised: false,
            readerReady: false,
        }

        expect(deriveRemoteTurnPresentation({...base, livenessRunning: true})).toEqual({
            showActivity: true,
            showRemoteStop: true,
        })
        expect(deriveRemoteTurnPresentation({...base, livenessRunning: false})).toEqual({
            showActivity: false,
            showRemoteStop: false,
        })
    })

    it("uses snapshot activity when the shared reader is ready", () => {
        expect(
            deriveRemoteTurnPresentation({
                livenessRunning: false,
                snapshotRunning: true,
                sharedReaderAdvertised: true,
                readerReady: true,
            }),
        ).toEqual({showActivity: true, showRemoteStop: false})
    })
})
