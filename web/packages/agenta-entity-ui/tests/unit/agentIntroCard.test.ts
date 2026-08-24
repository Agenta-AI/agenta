/**
 * The agent intro card's capability chip. Harness built-ins are always active and are not
 * configured, so a legacy config that still carries `{type: "builtin"}` entries must not count them.
 */
import {describe, expect, it} from "vitest"

import {capabilityLabel} from "../../src/agent/AgentIntroCard"

const config = (tools: unknown[], skills: unknown[] = []) => ({agent: {tools, skills}})

describe("capabilityLabel", () => {
    it("ignores legacy harness built-in entries", () => {
        const legacy = ["read", "bash", "edit", "write"].map((name) => ({type: "builtin", name}))
        expect(capabilityLabel(config(legacy))).toBeNull()
    })

    it("counts only the custom tools of a mixed config", () => {
        expect(
            capabilityLabel(
                config([
                    {type: "builtin", name: "read"},
                    {type: "function", function: {name: "get_weather"}},
                ]),
            ),
        ).toBe("1 tool")
    })

    it("counts custom tools and skills", () => {
        expect(
            capabilityLabel(
                config(
                    [
                        {type: "function", function: {name: "get_weather"}},
                        {type: "mcp", name: "search"},
                    ],
                    [{name: "triage"}],
                ),
            ),
        ).toBe("2 tools · 1 skill")
    })

    it("returns null when there is nothing to show", () => {
        expect(capabilityLabel(config([]))).toBeNull()
        expect(capabilityLabel(null)).toBeNull()
    })
})
