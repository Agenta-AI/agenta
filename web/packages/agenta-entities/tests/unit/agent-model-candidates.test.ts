import {describe, expect, it} from "vitest"

import {
    agentModelSelectionIsRunnable,
    firstAgentModelForConnection,
    buildAgentModelCandidates,
    resolveAgentModelSelection,
    type AgentModelCandidate,
} from "../../src/secret/core/agentModelCandidates"

const candidate = (
    key: string,
    overrides: Partial<AgentModelCandidate> = {},
): AgentModelCandidate => ({
    modelId: `openai/${key}`,
    provider: "openai",
    mode: "agenta",
    slug: key,
    harness: "pi_core",
    source: "connection",
    connectionKey: key,
    connectionName: key,
    iconKey: "openai",
    managed: false,
    recommended: false,
    ...overrides,
})

describe("resolveAgentModelSelection", () => {
    const first = candidate("first")
    const managed = candidate("managed", {managed: true, recommended: true})
    const last = candidate("last")
    const explicit = candidate("explicit")
    const candidates = [first, managed, last, explicit]

    it("keeps a runnable explicit draft choice before every automatic default", () => {
        expect(resolveAgentModelSelection({candidates, explicit, last})).toBe(explicit)
    })

    it("uses the complete runnable last choice when there is no explicit choice", () => {
        expect(resolveAgentModelSelection({candidates, last})).toBe(last)
    })

    it("prefers the managed recommendation when saved choices are stale", () => {
        expect(resolveAgentModelSelection({candidates, last: candidate("gone")})).toBe(managed)
    })

    it("does not confuse manager-only authorization with recommendation", () => {
        const locked = candidate("locked", {managed: true, recommended: false})

        expect(resolveAgentModelSelection({candidates: [first, locked]})).toBe(first)
    })

    it("falls back to the deterministic first candidate and then null", () => {
        expect(resolveAgentModelSelection({candidates: [first, last]})).toBe(first)
        expect(resolveAgentModelSelection({candidates: []})).toBeNull()
    })

    it("requires the complete route, including provider", () => {
        expect(agentModelSelectionIsRunnable(candidates, explicit)).toBe(true)
        expect(
            agentModelSelectionIsRunnable(candidates, {...explicit, provider: "anthropic"}),
        ).toBe(false)
    })

    it("selects a newly saved connection by its stable API id", () => {
        expect(firstAgentModelForConnection(candidates, "last")).toBe(last)
        expect(firstAgentModelForConnection(candidates, "missing")).toBeNull()
    })
})

describe("buildAgentModelCandidates", () => {
    const capabilities = {
        pi_core: {
            providers: ["openai"],
            connection_modes: ["agenta", "self_managed"],
            model_selection: "provider/id",
            models: {openai: ["openai/gpt-5"]},
            default_models: {openai: ["openai/gpt-5"]},
        },
        pi_agenta: {
            providers: ["openai"],
            connection_modes: ["self_managed"],
            model_selection: "provider/id",
            models: {openai: ["openai/gpt-hidden"]},
            default_models: {openai: ["openai/gpt-hidden"]},
        },
    }

    it("does not call an uncredentialed vault row runnable", () => {
        const candidates = buildAgentModelCandidates({
            connections: [
                {
                    id: "empty",
                    slug: "openai",
                    name: "OpenAI",
                    kind: "openai",
                    title: "OpenAI",
                    secretKind: "provider_key" as never,
                    models: ["gpt-5"],
                    hasStoredCredential: false,
                    source: {} as never,
                },
            ],
            capabilities,
            harnessIds: ["pi_core"],
            showSubscriptions: false,
        })

        expect(candidates).toEqual([])
    })

    it("does not reintroduce a hidden harness through live subscription status", () => {
        const candidates = buildAgentModelCandidates({
            connections: [],
            capabilities,
            harnessIds: ["pi_core"],
            subscriptionPairs: [
                {key: "hidden", harness: "pi_agenta", provider: "openai", name: "OpenAI"},
            ],
        })

        expect(candidates).toEqual([])
    })
})
