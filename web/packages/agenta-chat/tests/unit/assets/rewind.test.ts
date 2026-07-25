import type {UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {messageText, sideEffectingToolsInRange} from "../../../src/assets/rewind"

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
            parts: [{type: "text", text: "ok"}, {type: "tool-search_docs", state: "output-available"}],
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

    it("dedupes repeated tool names across messages", () => {
        const messages = [
            toolMessage("m1", "send_email", "output-available"),
            toolMessage("m2", "send_email", "output-available"),
        ]
        expect(sideEffectingToolsInRange(messages)).toEqual(["send_email"])
    })
})
