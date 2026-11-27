import {describe, expect, it} from "vitest"

import {
    applyAgentModelSelection,
    ensureEnabledSandbox,
    selectionFromAgentCreationPrefs,
} from "../../src/workflow/state/agentCreationPrefs"

describe("applyAgentModelSelection", () => {
    describe.each(["pi_core", "claude", "codex"])("routing to %s", (harness) => {
        it.each(["allow", "ask", "deny"])("preserves an existing %s policy", (policy) => {
            const existing = {
                harness: {kind: "pi_core", max_iterations: 10},
                llm: {model: "old-model", temperature: 0.5},
                runner: {permissions: {default: policy}},
                tools: [{type: "builtin", name: "read"}],
            }
            const model = harness === "claude" ? "sonnet" : "gpt-5.5"
            const provider = harness === "claude" ? "anthropic" : "openai"

            const result = applyAgentModelSelection(existing, {
                harness,
                modelId: model,
                provider,
                mode: "agenta",
                slug: provider,
            })

            expect(result).toEqual({
                ...existing,
                harness: {kind: harness, max_iterations: 10},
                llm: {
                    model,
                    temperature: 0.5,
                    provider,
                    connection: {mode: "agenta", slug: provider},
                },
            })
            expect(result.runner).toEqual({permissions: {default: policy}})
            expect(existing.harness.kind).toBe("pi_core")
            expect(existing.llm.model).toBe("old-model")
            expect(existing.runner).toEqual({permissions: {default: policy}})
        })
    })
})

describe("a built-in pick's namespace", () => {
    const builtin = {
        harness: "pi_core",
        modelId: "gpt-5.5",
        provider: "openai",
        mode: "agenta" as const,
        slug: "agenta",
        namespace: "builtin" as const,
    }

    it("is saved beside the slug, so a custom endpoint named alike cannot take the run", () => {
        expect(applyAgentModelSelection({}, builtin).llm).toEqual({
            model: "gpt-5.5",
            provider: "openai",
            connection: {mode: "agenta", slug: "agenta", namespace: "builtin"},
        })
    })

    it("survives the last-used preferences", () => {
        expect(
            selectionFromAgentCreationPrefs({
                version: 1,
                harness: "pi_core",
                model: "gpt-5.5",
                provider: "openai",
                connectionMode: "agenta",
                connectionSlug: "agenta",
                connectionNamespace: "builtin",
            }),
        ).toEqual(builtin)
    })
})

describe("a hosted subscription pick", () => {
    // A stored sign-in is `self_managed` WITH a slug. Dropping the slug turns the run into a
    // runner-mounted login, which a Daytona sandbox refuses.
    const subscription = {
        harness: "claude",
        modelId: "default",
        provider: "anthropic",
        mode: "self_managed" as const,
        slug: "claude",
        namespace: null,
    }

    it("keeps the sign-in's slug on the new agent", () => {
        expect(applyAgentModelSelection({}, subscription).llm).toEqual({
            model: "default",
            provider: "anthropic",
            connection: {mode: "self_managed", slug: "claude"},
        })
    })

    it("survives the last-used preferences", () => {
        expect(
            selectionFromAgentCreationPrefs({
                version: 1,
                harness: "claude",
                model: "default",
                provider: "anthropic",
                connectionMode: "self_managed",
                connectionSlug: "claude",
            }),
        ).toEqual(subscription)
    })

    it("writes no slug for a runner-mounted login", () => {
        expect(applyAgentModelSelection({}, {...subscription, slug: null}).llm).toEqual({
            model: "default",
            provider: "anthropic",
            connection: {mode: "self_managed"},
        })
    })
})

describe("ensureEnabledSandbox", () => {
    it("leaves the config untouched when the current kind is enabled", () => {
        const config = {sandbox: {kind: "local", permissions: {network: "on"}}, llm: {model: "x"}}
        expect(ensureEnabledSandbox(config, ["local"])).toBe(config)
    })

    it("leaves the config untouched when local is unset but local is enabled (runtime default)", () => {
        const config = {llm: {model: "x"}}
        expect(ensureEnabledSandbox(config, ["local", "daytona"])).toBe(config)
    })

    it("coerces the template's local default to the first enabled provider (daytona-only)", () => {
        const config = {sandbox: {kind: "local"}, llm: {model: "x"}}
        const result = ensureEnabledSandbox(config, ["daytona"])
        expect(result.sandbox).toEqual({kind: "daytona"})
        expect(result.llm).toEqual({model: "x"})
    })

    it("coerces an unset (implicit local) sandbox when local is not enabled", () => {
        const config = {llm: {model: "x"}}
        const result = ensureEnabledSandbox(config, ["daytona"])
        expect(result.sandbox).toEqual({kind: "daytona"})
    })

    it("preserves sibling sandbox keys (e.g. permissions) while coercing the kind", () => {
        const config = {sandbox: {kind: "local", permissions: {network: "off"}}}
        const result = ensureEnabledSandbox(config, ["daytona"])
        expect(result.sandbox).toEqual({kind: "daytona", permissions: {network: "off"}})
    })

    it("is a no-op when the enabled set is empty (never hide every option)", () => {
        const config = {sandbox: {kind: "local"}}
        expect(ensureEnabledSandbox(config, [])).toBe(config)
    })
})

describe("an organization subscription pick", () => {
    it("keeps the organization namespace when restored", () => {
        expect(
            selectionFromAgentCreationPrefs({
                version: 1,
                harness: "pi_core",
                model: "gpt-5.5",
                provider: "openai-codex",
                connectionMode: "self_managed",
                connectionSlug: "chatgpt",
                connectionNamespace: "organization",
            })?.namespace,
        ).toBe("organization")
    })
})
