import type {UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {takeSettledToolCalls, toolCacheEffect} from "../../../src/model/settledTools"

const assistant = (parts: Record<string, unknown>[]): UIMessage =>
    ({id: "m1", role: "assistant", parts}) as unknown as UIMessage

const call = (name: string, state = "output-available", toolCallId = `call-${name}`) => ({
    type: `tool-${name}`,
    toolCallId,
    state,
    input: {cron: "0 9 * * 1"},
    output: "{}",
})

describe("toolCacheEffect", () => {
    it("maps every mutating trigger op to its list", () => {
        for (const op of ["create", "remove", "pause", "resume"]) {
            expect(toolCacheEffect(`${op}_schedule`)).toBe("trigger-schedules")
            expect(toolCacheEffect(`${op}_subscription`)).toBe("trigger-subscriptions")
        }
    })

    it("unwraps every harness spelling of our own platform tool", () => {
        expect(toolCacheEffect("mcp__agenta-tools__create_schedule")).toBe("trigger-schedules")
        expect(toolCacheEffect("mcp.agenta-tools.remove_subscription")).toBe(
            "trigger-subscriptions",
        )
        expect(toolCacheEffect("__ag__pause_schedule")).toBe("trigger-schedules")
    })

    it("does not treat a third-party server's tool of the same name as ours", () => {
        expect(toolCacheEffect("mcp__acme__create_schedule")).toBeNull()
        expect(toolCacheEffect("mcp.acme.create_subscription")).toBeNull()
    })

    it("ignores read-only trigger ops and unrelated tools", () => {
        for (const name of [
            "list_schedules",
            "list_subscriptions",
            "list_deliveries",
            "discover_triggers",
            "test_subscription",
            "bash",
            "Write",
        ]) {
            expect(toolCacheEffect(name)).toBeNull()
        }
    })

    it("does not resolve inherited object members from third-party tool names", () => {
        for (const name of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
            expect(toolCacheEffect(name)).toBeNull()
        }
    })
})

describe("takeSettledToolCalls", () => {
    it("returns the settled call with its wire name and input", () => {
        const message = assistant([{type: "text", text: "Scheduled."}, call("create_schedule")])
        expect(takeSettledToolCalls(message, new Set())).toEqual([
            {
                toolCallId: "call-create_schedule",
                name: "create_schedule",
                input: {cron: "0 9 * * 1"},
            },
        ])
    })

    it("reads the name off a dynamic-tool part", () => {
        const part = {
            type: "dynamic-tool",
            toolName: "create_subscription",
            toolCallId: "d1",
            state: "output-available",
            input: null,
        }
        expect(takeSettledToolCalls(assistant([part]), new Set())).toEqual([
            {toolCallId: "d1", name: "create_subscription", input: null},
        ])
    })

    it("skips running and failed calls without recording them", () => {
        const seen = new Set<string>()
        const message = assistant([
            call("create_schedule", "input-streaming", "a"),
            call("create_schedule", "input-available", "b"),
            call("create_schedule", "output-error", "c"),
        ])
        expect(takeSettledToolCalls(message, seen)).toEqual([])
        expect(seen.size).toBe(0)
    })

    it("returns a call once across stream commits, and once more after it settles", () => {
        const seen = new Set<string>()
        const running = assistant([call("create_schedule", "input-available", "x")])
        const settled = assistant([call("create_schedule", "output-available", "x")])

        expect(takeSettledToolCalls(running, seen)).toEqual([])
        expect(takeSettledToolCalls(settled, seen).map((c) => c.toolCallId)).toEqual(["x"])
        expect(takeSettledToolCalls(settled, seen)).toEqual([])
    })

    it("skips a part with no call id", () => {
        const part = {type: "tool-create_schedule", state: "output-available"}
        expect(takeSettledToolCalls(assistant([part]), new Set())).toEqual([])
    })
})
