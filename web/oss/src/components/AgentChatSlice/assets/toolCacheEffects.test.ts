import type {UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {collectToolCacheEffects, toolCacheEffect} from "./toolCacheEffects"

const assistant = (parts: Record<string, unknown>[]): UIMessage =>
    ({id: "message-1", role: "assistant", parts}) as unknown as UIMessage

const settled = (name: string, toolCallId = `call-${name}`) => ({
    type: `tool-${name}`,
    toolCallId,
    state: "output-available",
    output: '{"count":1}',
})

const effectsOf = (parts: Record<string, unknown>[], seen = new Set<string>()) => [
    ...collectToolCacheEffects(assistant(parts), seen),
]

describe("toolCacheEffect", () => {
    it("routes mutating trigger ops to their list, and nothing else", () => {
        expect(toolCacheEffect("create_schedule")).toBe("trigger-schedules")
        expect(toolCacheEffect("pause_schedule")).toBe("trigger-schedules")
        expect(toolCacheEffect("remove_subscription")).toBe("trigger-subscriptions")
        expect(toolCacheEffect("list_schedules")).toBeNull()
        expect(toolCacheEffect("test_subscription")).toBeNull()
        expect(toolCacheEffect("bash")).toBeNull()
    })

    it("routes the same op wrapped by a harness's MCP naming (#5781 under Claude)", () => {
        expect(toolCacheEffect("mcp__agenta-tools__create_schedule")).toBe("trigger-schedules")
    })

    it("routes the Codex dot form of the same server", () => {
        expect(toolCacheEffect("mcp.agenta-tools.create_schedule")).toBe("trigger-schedules")
    })

    it("ignores a third-party MCP tool of the same bare name", () => {
        expect(toolCacheEffect("mcp__other__create_schedule")).toBeNull()
    })

    it("does not resolve inherited object members for MCP-supplied names", () => {
        for (const name of ["toString", "constructor", "valueOf", "hasOwnProperty"]) {
            expect(toolCacheEffect(name)).toBeNull()
        }
    })
})

describe("collectToolCacheEffects", () => {
    it("invalidates the schedules list when create_schedule settles (#5781)", () => {
        expect(effectsOf([{type: "text", text: "Scheduled."}, settled("create_schedule")])).toEqual(
            ["trigger-schedules"],
        )
    })

    it("reads the name off a dynamic-tool part too", () => {
        const part = {
            type: "dynamic-tool",
            toolName: "create_schedule",
            toolCallId: "call-1",
            state: "output-available",
        }
        expect(effectsOf([part])).toEqual(["trigger-schedules"])
    })

    it("invalidates for a Claude-harness call, which arrives MCP-wrapped", () => {
        expect(effectsOf([settled("mcp__agenta-tools__create_schedule")])).toEqual([
            "trigger-schedules",
        ])
    })

    it("ignores calls that have not succeeded", () => {
        expect(effectsOf([{...settled("create_schedule"), state: "output-error"}])).toEqual([])
        expect(effectsOf([{...settled("create_schedule"), state: "input-available"}])).toEqual([])
    })

    it("collects both lists when a turn touches schedules and subscriptions", () => {
        const effects = effectsOf([settled("create_schedule"), settled("remove_subscription")])
        expect(effects.sort()).toEqual(["trigger-schedules", "trigger-subscriptions"])
    })

    it("records every visited call so it acts once across stream commits", () => {
        const message = assistant([settled("create_schedule"), settled("list_schedules")])
        const seen = new Set<string>()

        expect([...collectToolCacheEffects(message, seen)]).toEqual(["trigger-schedules"])
        expect([...seen].sort()).toEqual(["call-create_schedule", "call-list_schedules"])
        expect([...collectToolCacheEffects(message, seen)]).toEqual([])
    })

    it("seeds from hydrated history so reopening a session refetches nothing", () => {
        const history = assistant([settled("create_schedule", "call-history")])
        const seen = new Set<string>()

        collectToolCacheEffects(history, seen) // the mount pass records without acting
        expect([...collectToolCacheEffects(history, seen)]).toEqual([])
    })
})
