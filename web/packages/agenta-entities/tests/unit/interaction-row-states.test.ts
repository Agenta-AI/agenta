import {describe, expect, it} from "vitest"

import type {SessionInteraction} from "../../src/session/core/schema"
import {interactionStatesFromRows} from "../../src/session/state/interactionStatus"

const row = (request: Record<string, unknown>): SessionInteraction =>
    ({
        id: "row-1",
        token: "token-1",
        kind: "client_tool",
        status: "pending",
        data: {request},
    }) as SessionInteraction

describe("interactionStatesFromRows", () => {
    it("carries the request input in the order the row stored it", () => {
        const args = {
            message: "Three quick questions",
            requestedSchema: {
                type: "object",
                properties: {destination: {type: "string"}, budget: {type: "string"}},
            },
        }
        const state = interactionStatesFromRows([
            row({tool: "request_input", tool_call_id: "call_1", args}),
        ]).get("token-1")

        expect(state?.toolCallId).toBe("call_1")
        expect(state?.requestInput).toEqual(args)
        expect(
            Object.keys((state?.requestInput?.requestedSchema as {properties: object}).properties),
        ).toEqual(["destination", "budget"])
    })

    it("leaves requestInput unset when the row has no object args", () => {
        const state = interactionStatesFromRows([
            row({tool: "request_input", tool_call_id: "call_1", args: "nope"}),
        ]).get("token-1")

        expect(state?.requestInput).toBeUndefined()
    })
})
