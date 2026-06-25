/**
 * Unit tests for the pure ModelRef <-> form helpers in connectionUtils.
 *
 * These back the agent config's Connection sub-form (provider-model-auth, PR 5). The
 * helpers are extracted so the round-trip between `config.model` and the form fields is
 * testable without a React harness. Runs under @agenta/entity-ui's own vitest runner.
 */
import {describe, expect, it} from "vitest"

import {
    allowedConnectionModes,
    allowedProviders,
    composeModelValue,
    connectionFromConfig,
    harnessAllowsProvider,
    modelIdFromConfig,
} from "../../src/DrillInView/SchemaControls/connectionUtils"

describe("connectionUtils: modelIdFromConfig", () => {
    it("returns a plain string model as itself", () => {
        expect(modelIdFromConfig("gpt-5.5")).toBe("gpt-5.5")
    })

    it("reads .model from a structured object", () => {
        expect(modelIdFromConfig({model: "gpt-5.5", provider: "openai"})).toBe("gpt-5.5")
    })

    it("returns null for absent or malformed values", () => {
        expect(modelIdFromConfig(null)).toBeNull()
        expect(modelIdFromConfig(undefined)).toBeNull()
        expect(modelIdFromConfig({provider: "openai"})).toBeNull()
        expect(modelIdFromConfig(42)).toBeNull()
    })
})

describe("connectionUtils: connectionFromConfig", () => {
    it("treats a plain string as the implicit default (agenta, no slug) connection", () => {
        expect(connectionFromConfig("gpt-5.5")).toEqual({
            provider: null,
            mode: "agenta",
            slug: null,
        })
    })

    it("reads provider and connection from a structured object", () => {
        expect(
            connectionFromConfig({
                model: "gpt-5.5",
                provider: "openai",
                connection: {mode: "agenta", slug: "openai-prod"},
            }),
        ).toEqual({provider: "openai", mode: "agenta", slug: "openai-prod"})
    })

    it("defaults the mode to agenta when the connection block is absent or unknown", () => {
        expect(connectionFromConfig({model: "gpt-5.5"}).mode).toBe("agenta")
        // The removed "default" mode (and any bogus value) maps to agenta.
        expect(connectionFromConfig({model: "gpt-5.5", connection: {mode: "default"}}).mode).toBe(
            "agenta",
        )
        expect(connectionFromConfig({model: "gpt-5.5", connection: {mode: "bogus"}}).mode).toBe(
            "agenta",
        )
    })
})

describe("connectionUtils: composeModelValue", () => {
    it("keeps the plain string for the default (agenta, no slug) connection with no provider", () => {
        expect(
            composeModelValue({modelId: "gpt-5.5", provider: null, mode: "agenta", slug: null}),
        ).toBe("gpt-5.5")
    })

    it("emits a structured object once a provider is overridden", () => {
        expect(
            composeModelValue({
                modelId: "gpt-5.5",
                provider: "openai",
                mode: "agenta",
                slug: null,
            }),
        ).toEqual({model: "gpt-5.5", provider: "openai"})
    })

    it("includes the agenta connection with its slug", () => {
        expect(
            composeModelValue({
                modelId: "gpt-5.5",
                provider: "openai",
                mode: "agenta",
                slug: "openai-prod",
            }),
        ).toEqual({
            model: "gpt-5.5",
            provider: "openai",
            connection: {mode: "agenta", slug: "openai-prod"},
        })
    })

    it("omits the slug for a self_managed connection", () => {
        expect(
            composeModelValue({
                modelId: "claude-opus-4-8",
                provider: null,
                mode: "self_managed",
                slug: null,
            }),
        ).toEqual({model: "claude-opus-4-8", connection: {mode: "self_managed"}})
    })

    it("round-trips a default string through the helpers as a string", () => {
        const fields = connectionFromConfig("gpt-5.5")
        const round = composeModelValue({
            modelId: modelIdFromConfig("gpt-5.5"),
            ...fields,
        })
        expect(round).toBe("gpt-5.5")
    })

    it("round-trips a structured object through the helpers", () => {
        const value = {
            model: "gpt-5.5",
            provider: "openai",
            connection: {mode: "agenta", slug: "openai-prod"},
        }
        const fields = connectionFromConfig(value)
        const round = composeModelValue({modelId: modelIdFromConfig(value), ...fields})
        expect(round).toEqual(value)
    })

    it("preserves extra ModelRef keys (params) on a form edit", () => {
        const existing = {
            model: "gpt-5.5",
            params: {reasoning_effort: "high"},
            connection: {mode: "agenta", slug: "openai-prod"},
        }
        // The user swaps the model id; provider/connection/params must survive.
        const fields = connectionFromConfig(existing)
        const round = composeModelValue({
            modelId: "gpt-5.6",
            ...fields,
            existing,
        })
        expect(round).toEqual({
            params: {reasoning_effort: "high"},
            model: "gpt-5.6",
            connection: {mode: "agenta", slug: "openai-prod"},
        })
    })

    it("keeps extras even for a default connection (no longer a bare string)", () => {
        const existing = {model: "gpt-5.5", params: {temperature: 0.2}}
        const round = composeModelValue({
            modelId: "gpt-5.5",
            provider: null,
            mode: "agenta",
            slug: null,
            existing,
        })
        expect(round).toEqual({params: {temperature: 0.2}, model: "gpt-5.5"})
    })

    it("changing the model id preserves a set connection", () => {
        const existing = {
            model: "gpt-5.5",
            provider: "openai",
            connection: {mode: "agenta", slug: "openai-prod"},
        }
        const fields = connectionFromConfig(existing)
        const round = composeModelValue({modelId: "gpt-5.6", ...fields, existing})
        expect(round).toEqual({
            model: "gpt-5.6",
            provider: "openai",
            connection: {mode: "agenta", slug: "openai-prod"},
        })
    })
})

describe("connectionUtils: harness capability gating", () => {
    it("pi_core and pi_agenta reach the vault providers (real list, not a wildcard) and both modes", () => {
        // Real list, not "*": the eight vault-mapped providers (mirrors the SDK table).
        expect(allowedProviders("pi_core")).toContain("openai")
        expect(allowedProviders("pi_core")).toContain("together_ai")
        expect(allowedProviders("pi_core")).not.toContain("*")
        expect(allowedProviders("pi_agenta")).toEqual(allowedProviders("pi_core"))
        expect(allowedConnectionModes("pi_core")).toEqual(["agenta", "self_managed"])
        expect(harnessAllowsProvider("pi_core", "openai")).toBe(true)
        // An unmapped provider is NOT reachable (the wildcard is gone).
        expect(harnessAllowsProvider("pi_core", "anything")).toBe(false)
    })

    it("claude is narrow: anthropic only", () => {
        expect(allowedProviders("claude")).toEqual(["anthropic"])
        expect(harnessAllowsProvider("claude", "anthropic")).toBe(true)
        expect(harnessAllowsProvider("claude", "Anthropic")).toBe(true)
        expect(harnessAllowsProvider("claude", "openai")).toBe(false)
        // both connection modes
        expect(allowedConnectionModes("claude")).toEqual(["agenta", "self_managed"])
    })

    it("is permissive for an unknown or missing harness", () => {
        expect(allowedProviders("future-harness")).toEqual(["*"])
        expect(allowedProviders(null)).toEqual(["*"])
        expect(allowedConnectionModes(undefined)).toEqual(["agenta", "self_managed"])
        expect(harnessAllowsProvider("future-harness", "whatever")).toBe(true)
    })
})
