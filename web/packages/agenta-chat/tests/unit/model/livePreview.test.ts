import type {SessionLiveFrame, SessionSnapshot} from "@agenta/entities/session"
import {describe, expect, it} from "vitest"

import {
    createSessionLivePreviewState,
    deriveRemoteTurnPresentation,
    isSessionSnapshotRunning,
    reduceSessionLivePreview,
    sessionLivePreviewMessages,
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

    it("suppresses a late join whose first frame index is above zero", () => {
        const gapped = reduceSessionLivePreview(
            createSessionLivePreviewState(),
            frame(2, "text-delta", {delta: "tail"}),
        )
        const later = reduceSessionLivePreview(gapped, frame(3, "text-delta", {delta: "later"}))

        expect(gapped.gapDetected).toBe(true)
        expect(gapped.executionOrder).toEqual([])
        expect(sessionLivePreviewMessages(gapped)).toEqual([])
        expect(later).toBe(gapped)
    })

    it("clears and suppresses a preview after an internal frame gap", () => {
        const first = reduceSessionLivePreview(
            createSessionLivePreviewState(),
            frame(0, "text-delta", {delta: "hello"}),
        )
        const gapped = reduceSessionLivePreview(first, frame(2, "text-delta", {delta: " tail"}))
        const missing = reduceSessionLivePreview(gapped, frame(1, "text-delta", {delta: " world"}))

        expect(gapped.gapDetected).toBe(true)
        expect(gapped.executionOrder).toEqual([])
        expect(sessionLivePreviewMessages(gapped)).toEqual([])
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

describe("remote turn presentation", () => {
    it.each([
        {
            name: "uses turn activity once the advertised reader is ready",
            input: {running: true, sharedReaderAdvertised: true, readerReady: true},
            expected: {showActivity: true, showStrip: false},
        },
        {
            name: "uses the fallback strip before the reader is ready",
            input: {running: true, sharedReaderAdvertised: true, readerReady: false},
            expected: {showActivity: false, showStrip: true},
        },
        {
            name: "uses the fallback strip when the feature is off",
            input: {running: true, sharedReaderAdvertised: false, readerReady: false},
            expected: {showActivity: false, showStrip: true},
        },
        {
            name: "never gives an owned continuation the fallback strip",
            input: {
                running: true,
                sharedReaderAdvertised: true,
                readerReady: false,
                ownedContinuation: true,
            },
            expected: {showActivity: false, showStrip: false},
        },
    ])("$name", ({input, expected}) => {
        expect(deriveRemoteTurnPresentation(input)).toEqual(expected)
    })
})
