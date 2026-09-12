import {describe, expect, it} from "vitest"

import {
    agentModelSelectionIsRunnable,
    firstAgentModelForConnection,
    buildAgentModelCandidates,
    resolveAgentModelSelection,
    type AgentModelCandidate,
} from "../../src/secret/core/agentModelCandidates"
import type {ProviderConnection} from "../../src/secret/core/connections"

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
    managed: false,
    ...overrides,
})

describe("resolveAgentModelSelection", () => {
    const first = candidate("first")
    const managed = candidate("managed", {managed: true})
    const last = candidate("last")
    const explicit = candidate("explicit")
    const candidates = [first, managed, last, explicit]

    it("keeps a runnable explicit draft choice before every automatic default", () => {
        expect(resolveAgentModelSelection({candidates, explicit, last})).toBe(explicit)
    })

    it("uses the complete runnable last choice when there is no explicit choice", () => {
        expect(resolveAgentModelSelection({candidates, last})).toBe(last)
    })

    it("prefers the first managed connection when saved choices are stale", () => {
        expect(resolveAgentModelSelection({candidates, last: candidate("gone")})).toBe(managed)
    })

    it("uses the first model offered by the managed connection", () => {
        const managedSecondModel = candidate("managed-2", {managed: true})
        expect(resolveAgentModelSelection({candidates: [first, managed, managedSecondModel]})).toBe(
            managed,
        )
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

describe("a custom endpoint's declared protocol", () => {
    const capabilities = {
        pi_core: {
            providers: ["openai", "anthropic"],
            deployments: ["direct", "custom"],
            model_selection: "provider/id",
        },
        claude: {
            providers: ["anthropic"],
            deployments: ["direct", "custom"],
            model_selection: "alias",
        },
    }
    const harnessIds = ["pi_core", "claude"]

    const endpoint = (
        id: string,
        modelKeys: string[],
        overrides: Partial<ProviderConnection> = {},
    ): ProviderConnection => ({
        id,
        slug: `gw-${id}`,
        name: "Gateway",
        kind: "custom",
        title: "OpenAI-compatible endpoint",
        secretKind: "custom_provider" as never,
        hasStoredCredential: true,
        source: {name: "Gateway", provider: "custom", modelKeys} as never,
        ...overrides,
    })

    const routes = (connection: ProviderConnection) =>
        buildAgentModelCandidates({
            connections: [connection],
            capabilities,
            harnessIds,
            showSubscriptions: false,
        }).map((candidate) => [candidate.harness, candidate.modelId])

    it("offers Claude Code on an endpoint declared as Anthropic Messages", () => {
        expect(routes(endpoint("1", ["claude-fable-5"], {protocol: "anthropic"}))).toEqual([
            ["claude", "claude-fable-5"],
        ])
    })

    it("withholds Claude Code from an endpoint declared as OpenAI-compatible", () => {
        // Anthropic-named models and all: the declaration is about the wire format, and Claude Code
        // against an OpenAI-compatible endpoint is the 422 nobody sees.
        expect(routes(endpoint("2", ["claude-fable-5"], {protocol: "openai"}))).toEqual([
            ["pi_core", "claude-fable-5"],
        ])
    })

    // The declared protocol is the operator's own statement; the model's vendor is a guess, and a
    // LiteLLM gateway serving OpenAI-named models over Anthropic Messages is exactly why.
    it("prefers the declared protocol over the model's vendor", () => {
        expect(routes(endpoint("3", ["gpt-4o-mini"], {protocol: "anthropic"}))).toEqual([
            ["claude", "gpt-4o-mini"],
        ])
    })

    // A record written before the field declares nothing, so nothing is narrowed on it: the
    // per-model guess (#6692) stays its only decider. Reading it as `openai` would take Claude Code
    // away from an Anthropic gateway that has been running since before the field existed.
    it("still offers Claude Code on an undeclared record whose models are Anthropic-named", () => {
        expect(routes(endpoint("4", ["anthropic/claude-fable-5", "gpt-4o-mini"]))).toEqual([
            ["pi_core", "anthropic/claude-fable-5"],
            ["pi_core", "gpt-4o-mini"],
            ["claude", "anthropic/claude-fable-5"],
        ])
    })

    // The guess is per model, not per connection: one Anthropic id on a mixed undeclared gateway
    // must not hand Claude Code the OpenAI ids beside it.
    it("withholds the OpenAI-named models of an undeclared record from Claude Code", () => {
        expect(routes(endpoint("4b", ["gpt-4o-mini"]))).toEqual([["pi_core", "gpt-4o-mini"]])
    })

    // The regression this rule exists to prevent: a gateway saved as Anthropic-only before the
    // protocol field shipped. Its saved policy is the user's own statement and nothing overrides it.
    it("keeps a saved Claude policy on an undeclared record", () => {
        expect(routes(endpoint("4c", ["claude-fable-5"], {harnesses: ["claude"]}))).toEqual([
            ["claude", "claude-fable-5"],
        ])
    })

    it("drops a saved harness policy the declared protocol contradicts", () => {
        expect(
            routes(endpoint("5", ["claude-fable-5"], {protocol: "openai", harnesses: ["claude"]})),
        ).toEqual([])
    })
})
