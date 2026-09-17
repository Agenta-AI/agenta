import type {ToolUIPart, UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {MCP_SERVER_NOTICE_PART} from "../../../src/model/mcpServerNotice"
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

    it("is true for an MCP server notice", () => {
        // The turn's only content can be the notice: the model asked for a tool on a server
        // that never joined, so there is no text and no tool part, and the sentence saying
        // why — plus the Connect action beside it — is the whole answer.
        expect(
            isVisiblePart({
                type: MCP_SERVER_NOTICE_PART,
                data: {serverName: "mock-mcp"},
            } as unknown as UIMessage["parts"][number]),
        ).toBe(true)
    })

    it("is false for a notice the reader refuses", () => {
        // A part of this type that names no server draws nothing, so treating it as visible
        // keeps an otherwise empty turn on screen with no content in it.
        expect(
            isVisiblePart({
                type: MCP_SERVER_NOTICE_PART,
                data: {serverName: "  "},
            } as unknown as UIMessage["parts"][number]),
        ).toBe(false)
    })
})

describe("isEmptyAssistantTurn", () => {
    it("matches the real predicate over the fixture turns", () => {
        const messages = emptyTurnsFixture as UIMessage[]
        expect(messages.map(isEmptyAssistantTurn)).toEqual([false, true, true, false])
    })

    it("does not call a turn carrying only a server notice empty", () => {
        // An empty turn is collapsed when it follows another, and a "no response" turn with
        // nothing else to show renders as a failure. Either would lose the notice.
        const turn = {
            id: "turn-1",
            role: "assistant",
            parts: [{type: MCP_SERVER_NOTICE_PART, data: {serverName: "mock-mcp"}}],
        } as unknown as UIMessage
        expect(isEmptyAssistantTurn(turn)).toBe(false)
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
