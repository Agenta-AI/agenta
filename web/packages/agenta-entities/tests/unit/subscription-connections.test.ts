import {describe, expect, it} from "vitest"

import {
    buildAgentModelCandidates,
    firstAgentModelForConnection,
    isSubscriptionConnection,
    subscriptionAttemptFailure,
    subscriptionAvailability,
    subscriptionConnectionFor,
    subscriptionConnectMethod,
    subscriptionHarnesses,
    subscriptionProviderFamily,
    subscriptionProviderName,
    subscriptionRunProvider,
    subscriptionStatus,
    subscriptionTokenErrorText,
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
    codex: {
        providers: ["openai"],
        deployments: ["direct"],
        connection_modes: ["agenta", "self_managed"],
        model_selection: "provider/id",
        models: {openai: ["openai/gpt-5.5"]},
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

    it("offers nothing to a harness that cannot consume the login", () => {
        // Codex refuses a login file without an `id_token`, and the ChatGPT device login never
        // issues one. The record naming the harness is not enough: an offered row would be a run
        // that cannot authenticate, and the SDK refuses the same pair at resolution.
        const candidates = buildAgentModelCandidates({
            connections: connectionsFor("ready", {harnesses: ["pi_core", "codex"]}),
            capabilities,
            harnessIds: ["codex"],
        })
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

describe("subscriptionStatus", () => {
    const needsLogin = (loginError?: string) =>
        subscriptionStatus({provider: "chatgpt", loginState: "needs_login", loginError})

    it("names each state", () => {
        expect(subscriptionStatus({provider: "chatgpt", loginState: "ready"})).toBe("connected")
        expect(subscriptionStatus({provider: "chatgpt", loginState: "pending_login"})).toBe(
            "notSignedIn",
        )
        expect(needsLogin()).toBe("signInNeeded")
        expect(subscriptionStatus(null)).toBeNull()
    })

    it("reads a dead sign-in from the server's reason, never shows the reason", () => {
        for (const reason of ["login_unreadable", "refresh_rejected", "refresh_status_401"]) {
            expect(needsLogin(reason)).toBe("signInNoLongerValid")
        }
    })

    it("falls back to the general case for a reason it does not know", () => {
        expect(needsLogin("something_new")).toBe("signInNeedsRenewal")
    })
})

describe("subscriptionAttemptFailure", () => {
    it("maps every slug the server uses, and any other, to a known failure", () => {
        expect(subscriptionAttemptFailure("attempt not found; try again")).toBe("lost")
        expect(subscriptionAttemptFailure("invalid_login")).toBe("invalidLogin")
        expect(subscriptionAttemptFailure("access_denied")).toBe("declined")
        expect(subscriptionAttemptFailure("expired_token")).toBe("expired")
        expect(subscriptionAttemptFailure("expired")).toBe("expired")
        expect(subscriptionAttemptFailure("login_failed")).toBe("incomplete")
        expect(subscriptionAttemptFailure("something_the_runner_invented")).toBe("incomplete")
    })

    it("has a failure for an attempt that ended with no reason at all", () => {
        expect(subscriptionAttemptFailure(null)).toBe("incomplete")
        expect(subscriptionAttemptFailure(undefined)).toBe("incomplete")
    })
})

describe("subscription availability", () => {
    it("is ready only when the sign-in is, and only for a harness it drives", () => {
        const [ready] = connectionsFor("ready")
        const [dead] = connectionsFor("needs_login")

        expect(subscriptionAvailability(ready, ["pi_core"])).toBe("ready")
        expect(subscriptionAvailability(dead, ["pi_core"])).toBe("sign_in_needed")
        // An agent that runs only Claude gains nothing by signing in, so the row says nothing.
        expect(subscriptionAvailability(dead, ["claude"])).toBe("not_applicable")
        // No narrowing at all: every row applies.
        expect(subscriptionAvailability(dead)).toBe("sign_in_needed")
    })

    it("falls back to the default harness when the record names none", () => {
        const [connection] = connectionsFor("needs_login", {harnesses: []})
        expect(subscriptionAvailability(connection, ["pi_core"])).toBe("sign_in_needed")
    })
})

describe("the subscription provider table", () => {
    it("names each provider, its family, and how it is connected", () => {
        expect(subscriptionProviderName("claude")).toBe("Claude")
        expect(subscriptionProviderFamily("claude")).toBe("anthropic")
        expect(subscriptionConnectMethod("claude")).toBe("token")
        expect(subscriptionProviderName("chatgpt")).toBe("ChatGPT")
        expect(subscriptionProviderFamily("chatgpt")).toBe("openai")
        expect(subscriptionConnectMethod("chatgpt")).toBe("device")
    })

    it("keys the run provider on the harness and the provider together", () => {
        expect(subscriptionRunProvider("claude", "claude")).toBe("anthropic")
        expect(subscriptionRunProvider("pi_core", "chatgpt")).toBe("openai-codex")
        // Neither login runs on the other's harness.
        expect(subscriptionRunProvider("pi_core", "claude")).toBeNull()
        expect(subscriptionRunProvider("claude", "chatgpt")).toBeNull()
    })

    it("falls back to the provider's own harness when the record names none", () => {
        expect(
            subscriptionHarnesses({subscription: {provider: "claude", loginState: "ready"}}),
        ).toEqual(["claude"])
        expect(
            subscriptionHarnesses({subscription: {provider: "chatgpt", loginState: "ready"}}),
        ).toEqual(["pi_core"])
    })
})

describe("a Claude subscription connection", () => {
    const claudeCapabilities: HarnessCapabilityMap = {
        ...capabilities,
        claude: {
            providers: ["anthropic"],
            deployments: ["direct"],
            connection_modes: ["agenta", "self_managed"],
        },
    }
    const claudeSecret = (loginState: string) =>
        subscriptionSecret(loginState, {
            provider: "claude",
            harnesses: ["claude"],
            models: ["sonnet", "haiku"],
            model_keys: ["claude/sonnet", "claude/haiku"],
        })

    const connections = () =>
        toProviderConnections(
            transformSecret([
                subscriptionSecret("ready"),
                {
                    ...claudeSecret("ready"),
                    id: "claude-1",
                    slug: "claude",
                    header: {name: "Claude"},
                },
            ]),
        )

    it("reads as a Claude connection under the anthropic family", () => {
        const claude = subscriptionConnectionFor(connections(), "claude")
        expect(claude).toMatchObject({id: "claude-1", name: "Claude", kind: "anthropic"})
        expect(subscriptionConnectionFor(connections(), "chatgpt")?.id).toBe("sub-1")
    })

    it("offers its models on Claude Code only, with the Anthropic run provider", () => {
        const candidates = buildAgentModelCandidates({
            connections: connections(),
            capabilities: claudeCapabilities,
            harnessIds: ["claude", "pi_core"],
        })
        const claude = candidates.filter((item) => item.connectionKey === "claude-1")

        expect(claude.map((item) => item.modelId)).toEqual(["sonnet", "haiku"])
        expect(
            claude.every(
                (item) =>
                    item.harness === "claude" &&
                    item.provider === "anthropic" &&
                    item.mode === "self_managed" &&
                    item.slug === "claude",
            ),
        ).toBe(true)
        // The connection just connected is found by its id, not by its kind.
        expect(firstAgentModelForConnection(candidates, "claude-1")?.modelId).toBe("sonnet")
        expect(firstAgentModelForConnection(candidates, "sub-1")?.harness).toBe("pi_core")
    })
})

describe("subscriptionTokenErrorText", () => {
    it("joins the API's diagnosis and next step", () => {
        const error = {
            body: {
                detail: {
                    code: "subscription_token_rejected",
                    message: "Claude did not accept this token.",
                    retryable: false,
                    next_step: "Run `claude setup-token` again and paste the new token.",
                },
            },
        }
        expect(subscriptionTokenErrorText(error)).toBe(
            "Claude did not accept this token. Run `claude setup-token` again and paste the new token.",
        )
    })

    it("returns null for an error with no refusal in it", () => {
        expect(subscriptionTokenErrorText(new Error("network"))).toBeNull()
        expect(subscriptionTokenErrorText({body: {detail: "Not found"}})).toBeNull()
    })
})
