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

    it("reports a subscription check it could not make, rather than answering 'no models'", () => {
        const error = new Error("Failed to fetch")
        const state = resolveAgentModelCandidateSources({
            // The shape behind the wrong banner: nothing in the vault, so every candidate would
            // have to come from a subscription pair, and the check for those failed.
            vaultRows: [],
            capabilities,
            subscriptionStatus: undefined,
            subscriptionSettled: false,
            subscriptionError: error,
            showSubscriptions: true,
        })

        expect(state).toMatchObject({status: "error", error, candidates: []})
        // `ready` here is what activated the connect-a-model gate and told the user to add a
        // provider key when the real fault was that Agenta could not reach the runner.
        expect(state.status).not.toBe("ready")
    })

    it("answers from the vault when the subscription check fails but is not needed", () => {
        // The failure only changes the answer when nothing else is runnable. A project with a
        // stored key has its answer already, and the pairs we could not read would have added
        // more routes, never removed one.
        const state = resolveAgentModelCandidateSources({
            vaultRows,
            capabilities,
            subscriptionStatus: undefined,
            subscriptionSettled: false,
            subscriptionError: new Error("Failed to fetch"),
            showSubscriptions: true,
        })

        expect(state.status).toBe("ready")
        expect(state.candidates.length).toBeGreaterThan(0)
    })

    it("still answers 'no candidates' when the runner genuinely reports none", () => {
        const state = resolveAgentModelCandidateSources({
            vaultRows: [],
            capabilities,
            subscriptionStatus: null,
            subscriptionSettled: true,
            subscriptionError: undefined,
            showSubscriptions: true,
        })

        expect(state).toMatchObject({status: "ready", candidates: []})
    })

    it("ignores a subscription failure once an answer is already in hand", () => {
        // A background refetch that fails must not retract an answer the app already has.
        const state = resolveAgentModelCandidateSources({
            vaultRows,
            capabilities,
            subscriptionStatus: {runner: "unavailable", checked_at: null},
            subscriptionSettled: true,
            subscriptionError: new Error("Failed to fetch"),
            showSubscriptions: true,
        })

        expect(state.status).toBe("ready")
        expect(state.candidates).toHaveLength(1)
    })

    it("does not treat a subscription failure as fatal when subscriptions are off", () => {
        const state = resolveAgentModelCandidateSources({
            vaultRows,
            capabilities,
            subscriptionError: new Error("Failed to fetch"),
            subscriptionSettled: true,
            showSubscriptions: false,
        })

        expect(state.status).toBe("ready")
    })
})
