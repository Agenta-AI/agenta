import type {SessionLiveFrame} from "@agenta/entities/session"
import {describe, expect, it} from "vitest"

import {
    createSessionLivePreviewState,
    reduceSessionLivePreview,
    sessionLivePreviewMessages,
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
    it("orders frames by execution and frame index before projecting deltas", () => {
        let state = createSessionLivePreviewState()
        state = reduceSessionLivePreview(state, frame(2, "text-delta", {delta: "world"}))
        state = reduceSessionLivePreview(state, frame(0, "text-start", {}))
        state = reduceSessionLivePreview(state, frame(1, "text-delta", {delta: "hello "}))

        expect(state.executionOrder).toEqual(["turn-1"])
        expect(state.byExecution["turn-1"].frames.map((item) => item.frame_index)).toEqual([
            0, 1, 2,
        ])
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
})
