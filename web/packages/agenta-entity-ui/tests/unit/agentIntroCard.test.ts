/** The agent intro card's model label. */
import {describe, expect, it} from "vitest"

import {agentModelLabel} from "../../src/agent/AgentIntroCard"
import type {HarnessCapabilitiesMap} from "../../src/DrillInView/SchemaControls/connectionUtils"

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
