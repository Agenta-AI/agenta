import type {ToolUIPart, UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {
    buildTurnRenderItems,
    executedToolIdentities,
    isSupersededGate,
    type RenderItem,
} from "../../../src/model/renderModel"
import supersededGateFixture from "../fixtures/supersededGate.json"
import toolTurnFixture from "../fixtures/toolTurn.json"

const noClientTools = () => false

describe("executedToolIdentities", () => {
    it("collects tool identities that reached output-available or output-error", () => {
        const [message] = toolTurnFixture as UIMessage[]
        const executed = executedToolIdentities(message.parts)
        expect(executed.size).toBe(2)
    })
})

describe("buildTurnRenderItems", () => {
    it("folds consecutive tool parts into one tools group between the surrounding text parts", () => {
        const [message] = toolTurnFixture as UIMessage[]
        const executed = executedToolIdentities(message.parts)
        const items = buildTurnRenderItems(message.parts, {
            executed,
            isClientToolPart: noClientTools,
        })
        expect(items.map((i) => i.kind)).toEqual(["part", "tools", "part"])
        expect((items[1] as Extract<RenderItem, {kind: "tools"}>).parts).toHaveLength(2)
    })

    it("drops a superseded approval-responded gate while keeping an in-flight one", () => {
        const [message] = supersededGateFixture as UIMessage[]
        const executed = executedToolIdentities(message.parts)
        const items = buildTurnRenderItems(message.parts, {
            executed,
            isClientToolPart: noClientTools,
        })
        // The write_file gate is dropped (superseded); its executed sibling and the still-pending
        // send_mail gate fold into a single consecutive tools group.
        expect(items).toHaveLength(1)
        expect(items[0].kind).toBe("tools")
        const toolParts = (items[0] as Extract<RenderItem, {kind: "tools"}>).parts
        expect(toolParts.map((p) => p.toolCallId)).toEqual(["call_gate_replay", "call_mail_gate"])
    })

    it("breaks the tool fold across a client-tool part", () => {
        const parts = [
            {type: "text", text: "before"},
            {type: "tool-a", toolCallId: "t1", state: "output-available", output: {}},
            {type: "tool-b", toolCallId: "t2", state: "output-available", output: {}},
            {type: "tool-client", toolCallId: "client_1", state: "output-available", output: {}},
            {type: "text", text: "after"},
        ] as unknown as UIMessage["parts"]
        const items = buildTurnRenderItems(parts, {
            executed: new Set(),
            isClientToolPart: (p: ToolUIPart) => p.toolCallId === "client_1",
        })
        expect(items.map((i) => i.kind)).toEqual(["part", "tools", "clientTool", "part"])
        expect((items[1] as Extract<RenderItem, {kind: "tools"}>).parts).toHaveLength(2)
    })
})

describe("isSupersededGate", () => {
    it("is true for an approval-responded gate whose identity is in the executed set", () => {
        const [message] = supersededGateFixture as UIMessage[]
        const [gate] = message.parts as ToolUIPart[]
        const executed = executedToolIdentities(message.parts)
        expect(isSupersededGate(gate, executed)).toBe(true)
    })

    it("is false when the identity hasn't executed", () => {
        const part = {
            type: "tool-x",
            state: "approval-responded",
            input: {a: 1},
        } as unknown as ToolUIPart
        expect(isSupersededGate(part, new Set())).toBe(false)
    })
})
