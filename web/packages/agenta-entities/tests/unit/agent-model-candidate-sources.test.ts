import {describe, expect, it} from "vitest"

import {resolveAgentModelCandidateSources} from "../../src/workflow/state/agentModelCandidates"

const capabilities = {
    pi_core: {
        providers: ["openai"],
        deployments: ["direct"],
        connection_modes: ["agenta", "self_managed"],
        model_selection: "provider/id",
        models: {openai: ["openai/gpt-5"]},
        default_models: {openai: ["openai/gpt-5"]},
    },
}

const vaultRows = [
    {
        id: "openai",
        type: "provider_key",
        title: "OpenAI",
        displayName: "OpenAI",
        slug: "openai",
        hasKey: true,
    },
]

describe("resolveAgentModelCandidateSources", () => {
    it("waits for subscription status when subscriptions are enabled", () => {
        const state = resolveAgentModelCandidateSources({
            vaultRows,
            capabilities,
            subscriptionSettled: false,
            showSubscriptions: true,
        })

        expect(state.status).toBe("loading")
    })

    it("treats terminal runner status without harnesses as resolved and empty", () => {
        const state = resolveAgentModelCandidateSources({
            vaultRows,
            capabilities,
            subscriptionStatus: {runner: "unavailable", checked_at: null},
            subscriptionSettled: true,
            showSubscriptions: true,
        })

        expect(state.status).toBe("ready")
        expect(state.candidates).toHaveLength(1)
        expect(state.candidates[0].source).toBe("connection")
    })

    it("does not manufacture subscription candidates when the runner has none", () => {
        const state = resolveAgentModelCandidateSources({
            vaultRows: [],
            capabilities,
            subscriptionStatus: null,
            subscriptionSettled: true,
            showSubscriptions: true,
        })

        expect(state).toMatchObject({status: "ready", candidates: []})
    })

    it("reports required source failures instead of loading forever", () => {
        const error = new Error("vault unavailable")
        const state = resolveAgentModelCandidateSources({
            vaultError: error,
            capabilities,
            subscriptionSettled: true,
            showSubscriptions: false,
        })

        expect(state).toMatchObject({status: "error", error})
    })
})
