import {describe, expect, it} from "vitest"

import {
    buildAgentModelCandidates,
    isSubscriptionConnection,
    subscriptionStatusLine,
    toProviderConnections,
    transformSecret,
    type HarnessCapabilityMap,
} from "../../src/secret/core"

const capabilities: HarnessCapabilityMap = {
    pi_core: {
        providers: ["openai"],
        deployments: ["direct"],
        connection_modes: ["agenta", "self_managed"],
        model_selection: "provider/id",
        models: {openai: ["openai/gpt-5.5"]},
    },
    claude: {
        providers: ["anthropic"],
        deployments: ["direct"],
        connection_modes: ["agenta"],
    },
}

/** One `/secrets/` row as the API returns it for a hosted subscription. */
const subscriptionSecret = (loginState: string, overrides: Record<string, unknown> = {}) =>
    ({
        id: "sub-1",
        slug: "chatgpt",
        kind: "subscription_provider",
        header: {name: "ChatGPT"},
        value_status: {configured: loginState !== "pending_login"},
        data: {
            provider: "chatgpt",
            harnesses: ["pi_core"],
            models: ["gpt-5.6-sol", "gpt-5.5"],
            model_keys: ["chatgpt/gpt-5.6-sol", "chatgpt/gpt-5.5"],
            login_state: loginState,
            login_version: 3,
            login_generation: 1,
            login_error: null,
            ...overrides,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any

const connectionsFor = (loginState: string, overrides?: Record<string, unknown>) =>
    toProviderConnections(transformSecret([subscriptionSecret(loginState, overrides)]))

describe("subscription_provider rows", () => {
    it("reads a subscription secret into a connection named for the product", () => {
        const [connection] = connectionsFor("ready")

        expect(connection).toMatchObject({
            id: "sub-1",
            slug: "chatgpt",
            name: "ChatGPT",
            title: "ChatGPT",
            // The FAMILY, so the logo and every family-keyed lookup still resolve.
            kind: "openai",
            models: ["gpt-5.6-sol", "gpt-5.5"],
            harnesses: ["pi_core"],
            hasStoredCredential: true,
        })
        expect(connection.subscription).toEqual({
            provider: "chatgpt",
            loginState: "ready",
            loginVersion: 3,
            loginGeneration: 1,
            loginError: null,
        })
        expect(isSubscriptionConnection(connection)).toBe(true)
    })

    it("reports no stored credential before the first sign-in", () => {
        const [connection] = connectionsFor("pending_login")
        expect(connection.hasStoredCredential).toBe(false)
    })

    it("survives a payload it cannot read rather than dropping the row", () => {
        const secret = subscriptionSecret("ready")
        secret.data = {provider: "chatgpt"}
        const [connection] = toProviderConnections(transformSecret([secret]))

        expect(connection.id).toBe("sub-1")
        expect(connection.subscription?.loginState).toBe("pending_login")
    })
})

describe("subscription candidates", () => {
    const candidatesFor = (loginState: string, overrides?: Record<string, unknown>) =>
        buildAgentModelCandidates({
            connections: connectionsFor(loginState, overrides),
            capabilities,
            harnessIds: ["pi_core", "claude"],
        })

    it("offers one self-managed route per model, carrying the record's slug", () => {
        const candidates = candidatesFor("ready")

        expect(candidates).toHaveLength(2)
        expect(candidates[0]).toEqual({
            modelId: "gpt-5.6-sol",
            // Pi drives a ChatGPT login through its own provider id.
            provider: "openai-codex",
            mode: "self_managed",
            slug: "chatgpt",
            harness: "pi_core",
            source: "subscription",
            connectionKey: "sub-1",
            managed: false,
        })
    })

    it("offers nothing while the sign-in is not ready", () => {
        expect(candidatesFor("pending_login")).toEqual([])
        expect(candidatesFor("needs_login")).toEqual([])
    })

    it("skips a harness the record does not name", () => {
        const candidates = candidatesFor("ready", {harnesses: ["codex"]})
        expect(candidates).toEqual([])
    })

    it("skips a harness that cannot run self-managed at all", () => {
        const candidates = buildAgentModelCandidates({
            connections: connectionsFor("ready", {harnesses: ["claude"]}),
            capabilities,
            harnessIds: ["claude"],
        })
        expect(candidates).toEqual([])
    })

    it("keeps its routes when the mounted-subscription rows are switched off", () => {
        // A hosted subscription is stored in the vault, so a deployment that can mount nothing
        // still runs it. Reading `showSubscriptions: false` as "no subscriptions at all" would
        // hide the one kind that works there.
        const candidates = buildAgentModelCandidates({
            connections: connectionsFor("ready"),
            capabilities,
            harnessIds: ["pi_core"],
            showSubscriptions: false,
        })
        expect(candidates).toHaveLength(2)
    })

    it("offers nothing when the record carries no slug to name the sign-in by", () => {
        const secret = subscriptionSecret("ready")
        delete secret.slug
        const candidates = buildAgentModelCandidates({
            connections: toProviderConnections(transformSecret([secret])),
            capabilities,
            harnessIds: ["pi_core"],
        })
        expect(candidates).toEqual([])
    })
})

describe("subscriptionStatusLine", () => {
    const needsLogin = (loginError?: string) =>
        subscriptionStatusLine({provider: "chatgpt", loginState: "needs_login", loginError})

    it("names each state", () => {
        expect(subscriptionStatusLine({provider: "chatgpt", loginState: "ready"})).toBe("Connected")
        expect(subscriptionStatusLine({provider: "chatgpt", loginState: "pending_login"})).toBe(
            "Not signed in",
        )
        expect(needsLogin()).toBe("Sign in needed")
    })

    it("explains a dead sign-in in a sentence, never in the server's own word", () => {
        // The card used to print "Sign in needed — refresh_rejected". The slug is safe to show,
        // no token and no path, but it is a log line: it tells the user nothing to do.
        for (const reason of ["login_unreadable", "refresh_rejected", "refresh_status_401"]) {
            expect(needsLogin(reason)).toBe(
                "Sign in needed. The ChatGPT sign-in is no longer valid.",
            )
            expect(needsLogin(reason)).not.toContain(reason)
        }
    })

    it("falls back to the general case for a reason it does not know", () => {
        // A new server reason must never reach the card as raw text.
        expect(needsLogin("something_new")).toBe(
            "Sign in needed. The ChatGPT sign-in needs to be renewed.",
        )
        expect(needsLogin("something_new")).not.toContain("something_new")
    })

    it("names the product the row is for, not ChatGPT by default", () => {
        expect(
            subscriptionStatusLine({
                provider: "grok",
                loginState: "needs_login",
                loginError: "refresh_rejected",
            }),
        ).toBe("Sign in needed. The grok sign-in is no longer valid.")
    })
})
