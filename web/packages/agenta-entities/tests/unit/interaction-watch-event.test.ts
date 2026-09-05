import {describe, expect, it} from "vitest"

import {interactionStatesFromWatchEvent} from "../../src/session/state/interactionStatus"

const event = (sessionId = "session-1") =>
    JSON.stringify({
        type: "interaction",
        session_id: sessionId,
        status: "resolved",
        interactions: [
            {
                id: "interaction-1",
                session_id: sessionId,
                turn_id: "turn-1",
                token: "approval-1",
                kind: "user_approval",
                status: "responded",
                data: {
                    request: {tool_call_id: "tool-1"},
                    resolution: {verdict: "approved", tool_call_id: "tool-1"},
                },
            },
        ],
    })

describe("interactionStatesFromWatchEvent", () => {
    it("decodes the committed resolution carried by the session relay", () => {
        expect(
            interactionStatesFromWatchEvent(event(), "session-1")?.get("approval-1"),
        ).toMatchObject({
            id: "interaction-1",
            turnId: "turn-1",
            toolCallId: "tool-1",
            status: "responded",
            resolution: {verdict: "approved", tool_call_id: "tool-1"},
        })
    })

    it("falls back to a query for metadata-only and foreign-session events", () => {
        expect(
            interactionStatesFromWatchEvent(
                JSON.stringify({type: "interaction", session_id: "session-1", status: "resolved"}),
                "session-1",
            ),
        ).toBeUndefined()
        expect(interactionStatesFromWatchEvent(event("session-2"), "session-1")).toBeUndefined()
    })
})
