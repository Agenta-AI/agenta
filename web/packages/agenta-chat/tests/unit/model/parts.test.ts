import type {ToolUIPart, UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {
    isEmptyAssistantTurn,
    isToolPart,
    isVisiblePart,
    partToolName,
    toolIdentity,
} from "../../../src/model/parts"
import emptyTurnsFixture from "../fixtures/emptyTurns.json"

describe("isToolPart", () => {
    it("is true for typed tool-* parts", () => {
        expect(isToolPart("tool-web_search")).toBe(true)
    })

    it("is true for dynamic-tool parts", () => {
        expect(isToolPart("dynamic-tool")).toBe(true)
    })

    it("is false for a plain text part", () => {
        expect(isToolPart("text")).toBe(false)
    })
})

describe("isVisiblePart", () => {
    it("is false for a blank reasoning part", () => {
        expect(isVisiblePart({type: "reasoning", text: "   "} as UIMessage["parts"][number])).toBe(
            false,
        )
    })

    it("is true for a file part", () => {
        expect(
            isVisiblePart({
                type: "file",
                mediaType: "text/plain",
                url: "https://example.com/a.txt",
            } as UIMessage["parts"][number]),
        ).toBe(true)
    })
})

describe("isEmptyAssistantTurn", () => {
    it("matches the real predicate over the fixture turns", () => {
        const messages = emptyTurnsFixture as UIMessage[]
        expect(messages.map(isEmptyAssistantTurn)).toEqual([false, true, true, false])
    })
})

describe("toolIdentity", () => {
    it("dedup-keys on type + stringified input", () => {
        const part = {type: "tool-x", input: {a: 1}} as unknown as ToolUIPart
        expect(toolIdentity(part)).toBe('tool-x::{"a":1}')
    })

    it("falls back to a null input key when the part has no input", () => {
        const part = {type: "dynamic-tool"} as unknown as ToolUIPart
        expect(toolIdentity(part)).toBe("dynamic-tool::null")
    })
})

describe("partToolName", () => {
    it("strips the tool- prefix off a typed tool part", () => {
        const part = {type: "tool-web_search"} as unknown as ToolUIPart
        expect(partToolName(part)).toBe("web_search")
    })

    it("reads toolName off a dynamic-tool part", () => {
        const part = {type: "dynamic-tool", toolName: "custom_tool"} as unknown as ToolUIPart
        expect(partToolName(part)).toBe("custom_tool")
    })

    it("falls back to 'tool' when a dynamic-tool part has no toolName", () => {
        const part = {type: "dynamic-tool"} as unknown as ToolUIPart
        expect(partToolName(part)).toBe("tool")
    })
})
