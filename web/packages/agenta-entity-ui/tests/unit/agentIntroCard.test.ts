/**
 * The agent intro card's capability chip. Harness built-ins are always active and are not
 * configured, so a legacy config that still carries `{type: "builtin"}` entries must not count them.
 */
import {describe, expect, it} from "vitest"

import {agentModelLabel, capabilityLabel} from "../../src/agent/AgentIntroCard"
import type {HarnessCapabilitiesMap} from "../../src/DrillInView/SchemaControls/connectionUtils"

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

describe("agentModelLabel", () => {
    const agent = (model: string, harness = "pi_core") => ({
        agent: {llm: {model}, harness: {kind: harness}},
    })
    const catalog = {
        pi_core: {
            model_catalog: [
                {id: "google/gemini-3.7-flash", provider: "google", name: "Gemini 3.7 Flash"},
            ],
        },
    } as unknown as HarnessCapabilitiesMap

    it("never shows a connection model key whole", () => {
        // A built-in Gemini model is stored under its connection key; before the catalog loads
        // (or when it does not list the model) the card falls back to the bare id.
        expect(agentModelLabel(agent("Agenta/custom/vertex_ai/gemini-3.7-flash"), null)).toBe(
            "gemini-3.7-flash",
        )
    })

    it("uses the catalog's curated name when the harness lists the model", () => {
        expect(agentModelLabel(agent("Agenta/custom/vertex_ai/gemini-3.7-flash"), catalog)).toBe(
            "Gemini 3.7 Flash",
        )
    })

    it("leaves an id the catalog does not know exactly as stored", () => {
        expect(agentModelLabel(agent("anthropic/claude-fable-5"), catalog)).toBe(
            "anthropic/claude-fable-5",
        )
    })

    it("reads the legacy flat model field and returns null without a model", () => {
        expect(agentModelLabel({agent: {model: "gpt-5.5"}}, null)).toBe("gpt-5.5")
        expect(agentModelLabel({agent: {}}, null)).toBeNull()
    })
})
