import type {UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {deriveTurnStatus} from "../../../src/model/turnStatus"
import reasoningOnlyTurnFixture from "../fixtures/reasoningOnlyTurn.json"

describe("deriveTurnStatus", () => {
    it("marks a reasoning-only settled turn as content-bearing but answer-less", () => {
        const [message] = reasoningOnlyTurnFixture as UIMessage[]
        const status = deriveTurnStatus(message, {isUser: false, isStreaming: false})
        expect(status.hasAnswer).toBe(false)
        expect(status.hasReasoning).toBe(true)
        expect(status.hasContent).toBe(true)
        expect(status.noResponse).toBe(true)
    })

    it("trusts traceError on an answer-less turn", () => {
        const message = {id: "a1", role: "assistant", parts: []} as unknown as UIMessage
        const status = deriveTurnStatus(message, {
            isUser: false,
            isStreaming: false,
            traceError: "model quota exceeded",
        })
        expect(status.noResponse).toBe(true)
        expect(status.errorText).toBe("model quota exceeded")
        expect(status.showError).toBe(true)
        expect(status.isError).toBe(true)
    })

    it("ignores traceError once the turn produced an answer", () => {
        const message = {
            id: "a1",
            role: "assistant",
            parts: [{type: "text", text: "here you go"}],
        } as unknown as UIMessage
        const status = deriveTurnStatus(message, {
            isUser: false,
            isStreaming: false,
            traceError: "swallowed tool-level error",
        })
        expect(status.noResponse).toBe(false)
        expect(status.errorText).toBeNull()
        expect(status.showError).toBe(false)
        expect(status.isError).toBe(false)
    })

    it("always counts runError, even on a turn that produced an answer", () => {
        const message = {
            id: "a1",
            role: "assistant",
            parts: [{type: "text", text: "partial answer"}],
        } as unknown as UIMessage
        const status = deriveTurnStatus(message, {
            isUser: false,
            isStreaming: false,
            runError: "stream died",
        })
        expect(status.noResponse).toBe(false)
        expect(status.errorText).toBe("stream died")
        expect(status.showError).toBe(true)
        // isError stays answer-less-only — a turn with an answer never renders as a full failure.
        expect(status.isError).toBe(false)
    })

    it("suppresses showError while the turn is still streaming", () => {
        const message = {id: "a1", role: "assistant", parts: []} as unknown as UIMessage
        const status = deriveTurnStatus(message, {
            isUser: false,
            isStreaming: true,
            runError: "stream died",
        })
        expect(status.showError).toBe(false)
        expect(status.isError).toBe(false)
    })
})
