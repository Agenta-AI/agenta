/**
 * Subscription × harness pairs — the drawer's Subscriptions section is built from these.
 *
 * The rules that matter here are the ones the drawer can get visibly wrong: a plan showing up
 * once per harness rather than once per plan, a non-ready login producing a row that claims to
 * work, and the numbered-duplicate state the spec forbids outright.
 */
import {describe, expect, it} from "vitest"

import {
    mountedSubscriptionName,
    subscriptionPairModels,
    subscriptionPairsFrom,
    subscriptionPlanName,
} from "../../src/secret/core/subscriptionPairs"

describe("subscriptionPairsFrom", () => {
    it("gives the same plan one row per harness that can use it", () => {
        const pairs = subscriptionPairsFrom({
            claude: {state: "ready", provider: "anthropic"},
            codex: {state: "ready", provider: "openai"},
            pi_core: {state: "ready", provider: "openai"},
        })

        expect(pairs.map((pair) => `${pair.name} · ${pair.harness}`)).toEqual([
            "Claude (deployment login) · claude",
            "ChatGPT (deployment login) · codex",
            "ChatGPT (deployment login) · pi_core",
        ])
    })

    it("names the plan a user pays for, not the company behind it", () => {
        expect(subscriptionPlanName("anthropic")).toBe("Claude")
        expect(subscriptionPlanName("openai")).toBe("ChatGPT")
    })

    it("says where a mounted login comes from, so a hosted row is not its twin", () => {
        // A deployment can mount a ChatGPT login AND hold a hosted ChatGPT subscription. Both are
        // subscription rows to the same plan with different model lists, so the plain plan name
        // on both left the user choosing between two identical rows.
        expect(mountedSubscriptionName("openai")).toBe("ChatGPT (deployment login)")
        expect(mountedSubscriptionName("anthropic")).toBe("Claude (deployment login)")
    })

    it("qualifies an unknown family too, rather than falling back to a bare id", () => {
        expect(mountedSubscriptionName("acme")).toBe("acme (deployment login)")
    })

    it("lists only the logins that work — a setup state is not a row", () => {
        const pairs = subscriptionPairsFrom({
            claude: {state: "ready", provider: "anthropic"},
            codex: {state: "login_missing", provider: "openai"},
            pi_core: {state: "not_configured", provider: "openai"},
        })

        expect(pairs.map((pair) => pair.harness)).toEqual(["claude"])
    })

    it("resolves the provider from the harness when the runner did not name one", () => {
        const pairs = subscriptionPairsFrom({
            claude: {state: "ready"},
            codex: {state: "ready"},
        })

        expect(pairs.map((pair) => pair.provider)).toEqual(["anthropic", "openai"])
    })

    it("drops a ready login it cannot attribute — a nameless row says nothing", () => {
        expect(subscriptionPairsFrom({pi_core: {state: "ready"}})).toEqual([])
    })

    it("gives a Pi mount one row per plan its login file holds", () => {
        // The runner is the only thing that can say WHICH plans a Pi mount holds; both plans run
        // through the same harness, so both are rows.
        const pairs = subscriptionPairsFrom({
            pi_core: {state: "ready", providers: ["anthropic", "openai"]},
        })

        expect(pairs.map((pair) => `${pair.name} · ${pair.harness}`)).toEqual([
            "Claude (deployment login) · pi_core",
            "ChatGPT (deployment login) · pi_core",
        ])
        expect(new Set(pairs.map((pair) => pair.key)).size).toBe(2)
    })

    it("keeps a plan one row per harness when Pi and a dedicated harness share it", () => {
        const pairs = subscriptionPairsFrom({
            codex: {state: "ready"},
            pi_core: {state: "ready", providers: ["openai"]},
            pi_agenta: {state: "ready", providers: ["openai"]},
        })

        expect(pairs.map((pair) => pair.harness)).toEqual(["codex", "pi_agenta", "pi_core"])
        expect(new Set(pairs.map((pair) => pair.provider))).toEqual(new Set(["openai"]))
    })

    it("ignores an empty provider list — it is not a claim about anything", () => {
        expect(subscriptionPairsFrom({pi_core: {state: "ready", providers: []}})).toEqual([])
        expect(
            subscriptionPairsFrom({codex: {state: "ready", providers: []}}).map(
                (pair) => pair.provider,
            ),
        ).toEqual(["openai"])
    })

    it("lists a plan only where the login is ready, whoever named it", () => {
        const pairs = subscriptionPairsFrom({
            pi_core: {state: "login_missing", providers: ["openai"]},
        })

        expect(pairs).toEqual([])
    })

    it("never produces a numbered duplicate: pairs multiply by harness, not by count", () => {
        const pairs = subscriptionPairsFrom({
            claude: {state: "ready", provider: "anthropic"},
            codex: {state: "ready", provider: "openai"},
        })

        expect(new Set(pairs.map((pair) => pair.key)).size).toBe(pairs.length)
        expect(pairs.some((pair) => /\d$/.test(pair.name))).toBe(false)
    })

    it("returns null before the runner has answered — unanswered is not 'none ready'", () => {
        // Consumers gate static fallbacks on this difference: null keeps the placeholder rows,
        // while an answered-but-empty status must hide every subscription row.
        expect(subscriptionPairsFrom(undefined)).toBeNull()
        expect(subscriptionPairsFrom(null)).toBeNull()
    })

    it("returns an empty list when the runner answered and nothing is ready", () => {
        expect(
            subscriptionPairsFrom({
                claude: {state: "not_configured", provider: "anthropic"},
                codex: {state: "not_configured", provider: "openai"},
                pi_core: {state: "not_configured"},
            }),
        ).toEqual([])
    })
})

describe("subscriptionPairModels", () => {
    const capabilities = {
        codex: {
            models: {openai: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]},
            default_models: {openai: ["gpt-5.6-sol", "gpt-5.6-terra"]},
        },
        pi_core: {
            models: {openai: ["openai/gpt-5.6-sol"]},
            default_models: {openai: ["openai/gpt-5.6-sol"]},
        },
    }

    it("reads the pair's OWN harness, not the union across harnesses", () => {
        expect(
            subscriptionPairModels(capabilities, {harness: "codex", provider: "openai"}).models,
        ).toEqual(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"])
        expect(
            subscriptionPairModels(capabilities, {harness: "pi_core", provider: "openai"}).models,
        ).toEqual(["openai/gpt-5.6-sol"])
    })

    it("marks the plan's recommended set", () => {
        expect(
            subscriptionPairModels(capabilities, {harness: "codex", provider: "openai"}).defaults,
        ).toEqual(["gpt-5.6-sol", "gpt-5.6-terra"])
    })

    it("offers nothing for a harness the catalog has never heard of", () => {
        expect(
            subscriptionPairModels(capabilities, {harness: "claude", provider: "openai"}),
        ).toEqual({models: [], defaults: []})
    })
})
