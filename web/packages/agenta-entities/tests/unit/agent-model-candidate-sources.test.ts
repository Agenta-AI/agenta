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

/** The runner answering, in full, that it holds no subscription login for any harness. */
const RUNNER_WITH_NO_PAIRS = {
    runner: "connected",
    checked_at: "2026-09-08T18:49:13Z",
    harnesses: {
        claude: {state: "not_configured", provider: "anthropic"},
        codex: {state: "not_configured", provider: "openai"},
        pi_core: {state: "not_configured"},
    },
} as const

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
            subscriptionStatus: RUNNER_WITH_NO_PAIRS,
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

        // The routes we DO know about stay usable, so this remains `ready` for creation and the
        // picker. The flag is what stops an empty list being read as "you have no key".
        expect(state).toMatchObject({status: "ready", candidates: [], subscriptionUnknown: true})
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
            subscriptionStatus: RUNNER_WITH_NO_PAIRS,
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
    it("never answers 'no routes' from an empty harness catalog", () => {
        // `fetchHarnessCapabilities` built `{}` from any 200 without harnesses, and the query
        // persists to disk, so one bad answer kept the gate up over working keys (#6660).
        const state = resolveAgentModelCandidateSources({
            vaultRows,
            capabilities: {},
            subscriptionStatus: null,
            subscriptionSettled: true,
            showSubscriptions: true,
        })

        expect(state.status).not.toBe("ready")
        expect(state.status).toBe("loading")
    })

    it("reports a catalog failure even when an empty map is cached beside it", () => {
        // The cached map keeps `data` defined, so the atom used to swallow the refetch error and
        // sit in `loading` with no notice and no retry.
        const error = new Error("Harness catalog returned no harnesses")
        const state = resolveAgentModelCandidateSources({
            vaultRows,
            capabilities: {},
            capabilitiesError: error,
            subscriptionSettled: true,
            showSubscriptions: false,
        })

        expect(state).toMatchObject({status: "error", error})
    })

    it("never reads an unreadable subscription answer as 'no subscriptions'", () => {
        // `null` is the boundary schema's fallback for an answer we could not parse. Reading it as
        // "this deployment has none" raised the add-a-key banner on a claim never established.
        const state = resolveAgentModelCandidateSources({
            vaultRows: [],
            capabilities,
            subscriptionStatus: null,
            subscriptionSettled: true,
            showSubscriptions: true,
        })

        expect(state).toMatchObject({status: "ready", candidates: [], subscriptionUnknown: true})
    })

    it("calls the subscription source established when the runner really answers", () => {
        const state = resolveAgentModelCandidateSources({
            vaultRows: [],
            capabilities,
            subscriptionStatus: RUNNER_WITH_NO_PAIRS,
            subscriptionSettled: true,
            showSubscriptions: true,
        })

        expect(state).toMatchObject({status: "ready", subscriptionUnknown: false})
    })

    it("answers from the vault when the subscription answer is unreadable", () => {
        // Unknown pairs would only have added routes. With one runnable already, the answer stands.
        const state = resolveAgentModelCandidateSources({
            vaultRows,
            capabilities,
            subscriptionStatus: null,
            subscriptionSettled: true,
            showSubscriptions: true,
        })

        expect(state.status).toBe("ready")
        expect(state.candidates).toHaveLength(1)
    })

    it("treats a runner it could not read as unknown, but an absent runner as none", () => {
        // The service answers `incompatible` for a runner whose shape it cannot read, and
        // `unavailable` for one that is not there. Only the first leaves the pairs unknown.
        const unreadable = resolveAgentModelCandidateSources({
            vaultRows: [],
            capabilities,
            subscriptionStatus: {runner: "incompatible", checked_at: null},
            subscriptionSettled: true,
            showSubscriptions: true,
        })
        const absent = resolveAgentModelCandidateSources({
            vaultRows: [],
            capabilities,
            subscriptionStatus: {runner: "unavailable", checked_at: null},
            subscriptionSettled: true,
            showSubscriptions: true,
        })

        expect(unreadable.subscriptionUnknown).toBe(true)
        expect(absent.subscriptionUnknown).toBe(false)
    })
})
