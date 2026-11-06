import type {UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {
    messageText,
    rewindTurnId,
    rewindTurnIdInTranscript,
    sideEffectingToolsInRange,
} from "../../../src/assets/rewind"

const textMessage = (id: string, text: string): UIMessage =>
    ({id, role: "user", parts: [{type: "text", text}]}) as unknown as UIMessage

const toolMessage = (id: string, toolName: string, state: string): UIMessage =>
    ({
        id,
        role: "assistant",
        parts: [{type: `tool-${toolName}`, state}],
    }) as unknown as UIMessage

describe("messageText", () => {
    it("concatenates a message's text parts", () => {
        const message = {
            id: "m1",
            role: "user",
            parts: [
                {type: "text", text: "hello "},
                {type: "text", text: "world"},
            ],
        } as unknown as UIMessage
        expect(messageText(message)).toBe("hello world")
    })

    it("ignores non-text parts", () => {
        const message = {
            id: "m1",
            role: "assistant",
            parts: [
                {type: "text", text: "ok"},
                {type: "tool-search_docs", state: "output-available"},
            ],
        } as unknown as UIMessage
        expect(messageText(message)).toBe("ok")
    })
})

describe("sideEffectingToolsInRange", () => {
    it("reports a side-effecting tool that already produced output", () => {
        const messages = [
            textMessage("m1", "send it"),
            toolMessage("m2", "send_email", "output-available"),
        ]
        expect(sideEffectingToolsInRange(messages)).toEqual(["send_email"])
    })

    it("ignores read-only tools even when they ran", () => {
        const messages = [toolMessage("m1", "search_docs", "output-available")]
        expect(sideEffectingToolsInRange(messages)).toEqual([])
    })

    it("ignores tool calls that never ran (still pending, denied, or errored)", () => {
        const messages = [
            toolMessage("m1", "send_email", "input-available"),
            toolMessage("m2", "send_email", "output-denied"),
            toolMessage("m3", "send_email", "output-error"),
        ]
        expect(sideEffectingToolsInRange(messages)).toEqual([])
    })

    it("flags a completed write inside a FAILED turn (the retry range)", () => {
        // #6362 review: a retryable model error (rate_limited) can land AFTER a tool already
        // wrote. The retry affordance regenerates from the failed assistant message, so the
        // range starting AT that message must surface the completed write for the warning.
        const failedTurn = {
            id: "m1",
            role: "assistant",
            parts: [
                {type: "tool-create_issue", state: "output-available"},
                {type: "data-agent-error", data: {code: "rate_limited", text: "429"}},
            ],
        } as unknown as UIMessage
        expect(sideEffectingToolsInRange([failedTurn])).toEqual(["create_issue"])
    })

    it("dedupes repeated tool names across messages", () => {
        const messages = [
            toolMessage("m1", "send_email", "output-available"),
            toolMessage("m2", "send_email", "output-available"),
        ]
        expect(sideEffectingToolsInRange(messages)).toEqual(["send_email"])
    })
})

describe("rewindTurnId", () => {
    const user = (id: string, turnId?: string): UIMessage =>
        ({id, role: "user", parts: [], metadata: turnId ? {turnId} : undefined}) as UIMessage
    const assistant = (id: string): UIMessage =>
        ({id, role: "assistant", parts: []}) as unknown as UIMessage
    const transcript = [user("u1", "t1"), assistant("a1"), user("u2", "t2"), assistant("a2")]

    it("names the turn of a rewound user message", () => {
        expect(rewindTurnId(transcript, 2)).toBe("t2")
    })

    it("names the turn that holds a re-run assistant message", () => {
        expect(rewindTurnId(transcript, 3)).toBe("t2")
    })

    it("returns null when the user message has no durable turn yet", () => {
        expect(rewindTurnId([user("u1"), assistant("a1")], 1)).toBeNull()
    })

    it("returns null when no user message comes first", () => {
        expect(rewindTurnId([assistant("a1")], 0)).toBeNull()
    })
})

describe("rewindTurnIdInTranscript", () => {
    const local = [textMessage("local-1", "mine")]
    const server = (text: string): UIMessage[] => [
        {...textMessage("s1", text), metadata: {turnId: "t1"}} as UIMessage,
    ]

    it("names the server turn at the same position with the same words", () => {
        expect(rewindTurnIdInTranscript(local, 0, server("mine"))).toBe("t1")
    })

    it("refuses another client's message at that position", () => {
        expect(rewindTurnIdInTranscript(local, 0, server("theirs"))).toBeNull()
    })

    it("returns null when the server has no message there", () => {
        expect(rewindTurnIdInTranscript(local, 0, [])).toBeNull()
    })
})
