import {describe, expect, it} from "vitest"

import {SecretKind, SecretManagementPolicy, type ProviderConnection} from "../../src/secret/core"
import {
    applyAgentCreationPrefs,
    applyManagedConnectionDefault,
    ensureEnabledSandbox,
} from "../../src/workflow/state/agentCreationPrefs"

describe("applyAgentCreationPrefs", () => {
    it("leaves the template config untouched when no prefs are set", () => {
        const template = {harness: {kind: "claude"}, llm: {model: "gpt-4o"}}
        expect(applyAgentCreationPrefs(template, {version: 1})).toEqual(template)
    })

    it("overlays only the fields the prefs carry, keeping the rest of the template", () => {
        const template = {
            harness: {kind: "claude", max_iterations: 10},
            llm: {model: "gpt-4o", temperature: 0.7},
            tools: [{name: "gmail_search"}],
        }
        const result = applyAgentCreationPrefs(template, {version: 1, harness: "pi_core"})
        expect(result.harness).toEqual({kind: "pi_core", max_iterations: 10})
        expect(result.llm).toEqual({model: "gpt-4o", temperature: 0.7})
        expect(result.tools).toBe(template.tools)
    })

    it("overlays model/provider/connectionMode without dropping other llm keys", () => {
        const template = {llm: {model: "gpt-4o", temperature: 0.5}}
        const result = applyAgentCreationPrefs(template, {
            version: 1,
            model: "claude-opus-4",
            provider: "anthropic",
            connectionMode: "self_managed",
        })
        expect(result.llm).toEqual({
            model: "claude-opus-4",
            temperature: 0.5,
            provider: "anthropic",
            connection: {mode: "self_managed"},
        })
    })

    it("preserves an existing connection slug when only the mode is overlaid", () => {
        const template = {llm: {model: "gpt-4o", connection: {mode: "agenta", slug: "my-conn"}}}
        const result = applyAgentCreationPrefs(template, {version: 1, connectionMode: "agenta"})
        expect(result.llm).toEqual({
            model: "gpt-4o",
            connection: {mode: "agenta", slug: "my-conn"},
        })
    })

    it("restores the complete saved connection identity", () => {
        const result = applyAgentCreationPrefs(
            {llm: {model: "gpt-5.6-luna"}},
            {
                version: 1,
                model: "Agenta/custom/vertex_ai/gemini-3.6-flash",
                connectionMode: "agenta",
                connectionSlug: "starter-credits",
            },
        )

        expect(result.llm).toEqual({
            model: "Agenta/custom/vertex_ai/gemini-3.6-flash",
            connection: {mode: "agenta", slug: "starter-credits"},
        })
    })

    it("builds harness/llm objects from scratch when the template has none", () => {
        const result = applyAgentCreationPrefs(
            {},
            {version: 1, harness: "claude", model: "claude-opus-4"},
        )
        expect(result).toEqual({harness: {kind: "claude"}, llm: {model: "claude-opus-4"}})
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

describe("applyManagedConnectionDefault", () => {
    const managed = (over: Partial<ProviderConnection> = {}): ProviderConnection =>
        ({
            id: "sec-managed",
            slug: "starter-credits",
            name: "Starter credits",
            kind: "custom",
            title: "Custom",
            secretKind: SecretKind.CustomProvider,
            hasStoredCredential: true,
            managementPolicy: SecretManagementPolicy.ManagerOnly,
            harnesses: ["pi_core"],
            source: {
                modelKeys: ["Starter credits/custom/vertex_ai/gemini-3.6-flash"],
            } as ProviderConnection["source"],
            ...over,
        }) as ProviderConnection

    const ownKey = (kind: string): ProviderConnection =>
        ({
            id: `sec-${kind}`,
            name: kind,
            kind,
            title: kind,
            secretKind: SecretKind.ProviderKey,
            hasStoredCredential: true,
            source: {} as ProviderConnection["source"],
        }) as ProviderConnection

    const TEMPLATE = {llm: {provider: "openai", model: "gpt-5.6-luna"}, tools: []}

    it("repoints the template default at the managed connection's first model", () => {
        const result = applyManagedConnectionDefault(TEMPLATE, [managed()])
        expect(result.llm).toEqual({
            model: "Starter credits/custom/vertex_ai/gemini-3.6-flash",
            connection: {mode: "agenta", slug: "starter-credits"},
        })
        expect(result.tools).toBe(TEMPLATE.tools)
        expect(result.harness).toEqual({kind: "pi_core"})
    })

    it("writes no provider — the slug is the whole routing identity", () => {
        const result = applyManagedConnectionDefault(TEMPLATE, [managed()])
        expect(result.llm).not.toHaveProperty("provider")
    })

    it("prefers the managed recommendation over the replaceable static template default", () => {
        const connections = [ownKey("openai"), managed()]
        expect(
            (applyManagedConnectionDefault(TEMPLATE, connections).llm as Record<string, unknown>)
                .model,
        ).toBe("Starter credits/custom/vertex_ai/gemini-3.6-flash")
    })

    it("still repoints when the user's own key is for a different provider", () => {
        const result = applyManagedConnectionDefault(TEMPLATE, [ownKey("anthropic"), managed()])
        expect((result.llm as Record<string, unknown>).model).toBe(
            "Starter credits/custom/vertex_ai/gemini-3.6-flash",
        )
    })

    it("never overrides a config that already names a connection slug", () => {
        const chosen = {llm: {model: "gpt-4o", connection: {mode: "agenta", slug: "my-gateway"}}}
        expect(applyManagedConnectionDefault(chosen, [managed()])).toBe(chosen)
    })

    it("never overrides self-managed credentials", () => {
        const chosen = {llm: {model: "sonnet", connection: {mode: "self_managed"}}}
        expect(applyManagedConnectionDefault(chosen, [managed()])).toBe(chosen)
    })

    it("is a no-op when the project has no managed connection", () => {
        expect(applyManagedConnectionDefault(TEMPLATE, [ownKey("anthropic")])).toBe(TEMPLATE)
        expect(applyManagedConnectionDefault(TEMPLATE, [])).toBe(TEMPLATE)
    })

    it("skips a managed connection that publishes no models", () => {
        const empty = managed({source: {modelKeys: []} as ProviderConnection["source"]})
        expect(applyManagedConnectionDefault(TEMPLATE, [empty])).toBe(TEMPLATE)
    })

    it("keeps sibling llm keys (temperature, extras) while repointing", () => {
        const config = {llm: {provider: "openai", model: "gpt-5.6-luna", temperature: 0.3}}
        const result = applyManagedConnectionDefault(config, [managed()])
        expect((result.llm as Record<string, unknown>).temperature).toBe(0.3)
    })

    it("keeps sibling harness keys when the managed connection allows one harness", () => {
        const config = {harness: {kind: "codex", max_iterations: 12}, llm: TEMPLATE.llm}
        const result = applyManagedConnectionDefault(config, [managed()])

        expect(result.harness).toEqual({kind: "pi_core", max_iterations: 12})
    })

    it("does not guess a harness when the managed connection allows several", () => {
        const config = {harness: {kind: "codex"}, llm: TEMPLATE.llm}
        const result = applyManagedConnectionDefault(config, [
            managed({harnesses: ["pi_core", "codex"]}),
        ])

        expect(result.harness).toEqual({kind: "codex"})
    })
})
