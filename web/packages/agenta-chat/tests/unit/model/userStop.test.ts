import type {UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {
    isUserStopError,
    lastTurnWasUserStopped,
    reduceUserStoppedState,
} from "../../../src/model/userStop"

const assistant = (metadata?: Record<string, unknown>): UIMessage =>
    ({id: "a1", role: "assistant", parts: [], metadata}) as UIMessage

const approval = {
    id: "a1",
    role: "assistant" as const,
    parts: [
        {
            type: "tool-shell",
            toolCallId: "call-1",
            state: "approval-requested",
            approval: {id: "approval-1"},
            input: {},
        },
    ],
} as UIMessage

describe("user stopped state", () => {
    it("maps a stream-delivered cancelled ending to the neutral state", () => {
        expect(
            reduceUserStoppedState(false, {
                type: "stream-terminal",
                finishReason: "other",
                messages: [assistant()],
            }),
        ).toBe(true)
    })

    it("does not mistake a paused approval for a cancellation", () => {
        expect(
            reduceUserStoppedState(false, {
                type: "stream-terminal",
                finishReason: "other",
                messages: [approval],
            }),
        ).toBe(false)
    })

    it("maps a replayed cancelled turn to the neutral state", () => {
        const messages = [assistant({runStopped: true})]

        expect(lastTurnWasUserStopped(messages)).toBe(true)
        expect(reduceUserStoppedState(false, {type: "transcript", messages})).toBe(true)
    })

    it("recognizes only the runner's explicit user-stop error label", () => {
        expect(isUserStopError(new Error('{"status":{"code":"user-stop"}}'))).toBe(true)
        expect(isUserStopError({agentaAbort: "user-stop"})).toBe(true)
        expect(isUserStopError(new Error("Request was aborted"))).toBe(false)
        expect(isUserStopError(new Error('{"status":{"code":"runner-error"}}'))).toBe(false)
    })

    it("keeps genuine stream failures non-neutral", () => {
        expect(
            reduceUserStoppedState(false, {
                type: "stream-terminal",
                finishReason: "error",
                error: new Error("model failed"),
                messages: [assistant()],
            }),
        ).toBe(false)
    })

    it("clears the marker when a new turn starts", () => {
        expect(reduceUserStoppedState(true, {type: "reset"})).toBe(false)
    })
})
