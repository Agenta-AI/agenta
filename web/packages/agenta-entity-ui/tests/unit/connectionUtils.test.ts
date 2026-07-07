/**
 * Unit tests for the pure ModelRef <-> form helpers and the harness-filtered picker helpers in
 * connectionUtils.
 *
 * These back the agent config's unified provider + model + connection picker (agent-model-picker).
 * The model is ALWAYS a structured ModelRef (never a bare string); the picker filters to what the
 * selected harness publishes on `/inspect` meta.harness_capabilities. The helpers are extracted so
 * the round-trip and the option-building are testable without a React harness. Runs under
 * @agenta/entity-ui's own vitest runner.
 */
import {describe, expect, it} from "vitest"

import {
    allowedConnectionModes,
    allowedProviders,
    buildModelOptionGroups,
    composeModelValue,
    connectionFromConfig,
    harnessAllowsModel,
    harnessAllowsProvider,
    isDeploymentProviderKind,
    modelIdFromConfig,
    modelSelectionMode,
    providerForModel,
    vaultModelGroups,
    vaultPickedProviderFamily,
    type HarnessCapabilitiesMap,
} from "../../src/DrillInView/SchemaControls/connectionUtils"

// An inspect-shaped capability map (the `/inspect` meta.harness_capabilities payload).
const CAPABILITIES: HarnessCapabilitiesMap = {
    pi_core: {
        providers: ["openai", "anthropic", "gemini"],
        deployments: ["direct"],
        connection_modes: ["agenta", "self_managed"],
        model_selection: "provider/id",
        models: {
            openai: ["gpt-5.5", "gpt-5.4"],
            anthropic: ["anthropic/claude-opus-4-7"],
            gemini: ["gemini/gemini-2.5-pro"],
        },
    },
    claude: {
        providers: ["anthropic"],
        deployments: ["direct", "custom", "bedrock"],
        connection_modes: ["agenta", "self_managed"],
        model_selection: "alias",
        models: {anthropic: ["opus", "sonnet", "opus[1m]"]},
    },
}

describe("connectionUtils: modelIdFromConfig", () => {
    it("reads .model from a structured ModelRef", () => {
        expect(modelIdFromConfig({model: "gpt-5.5", provider: "openai"})).toBe("gpt-5.5")
    })

    it("still reads a legacy bare-string model", () => {
        expect(modelIdFromConfig("gpt-5.5")).toBe("gpt-5.5")
    })

    it("returns null for absent or malformed values", () => {
        expect(modelIdFromConfig(null)).toBeNull()
        expect(modelIdFromConfig(undefined)).toBeNull()
        expect(modelIdFromConfig({provider: "openai"})).toBeNull()
        expect(modelIdFromConfig(42)).toBeNull()
    })
})

describe("connectionUtils: connectionFromConfig", () => {
    it("reads provider and connection from a ModelRef", () => {
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
        expect(connectionFromConfig({model: "gpt-5.5", connection: {mode: "default"}}).mode).toBe(
            "agenta",
        )
        expect(connectionFromConfig({model: "gpt-5.5", connection: {mode: "bogus"}}).mode).toBe(
            "agenta",
        )
    })

    it("reads a legacy bare string as the default connection with no provider", () => {
        expect(connectionFromConfig("gpt-5.5")).toEqual({
            provider: null,
            mode: "agenta",
            slug: null,
        })
    })
})

describe("connectionUtils: composeModelValue (always a ModelRef)", () => {
    it("returns a structured object even for the default connection (no bare string)", () => {
        expect(
            composeModelValue({modelId: "gpt-5.5", provider: "openai", mode: "agenta", slug: null}),
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
                modelId: "opus",
                provider: "anthropic",
                mode: "self_managed",
                slug: null,
            }),
        ).toEqual({model: "opus", provider: "anthropic", connection: {mode: "self_managed"}})
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

    it("preserves extra ModelRef keys (params) and provider on a form edit", () => {
        const existing = {
            model: "gpt-5.5",
            provider: "openai",
            params: {reasoning_effort: "high"},
            connection: {mode: "agenta", slug: "openai-prod"},
        }
        const fields = connectionFromConfig(existing)
        const round = composeModelValue({modelId: "gpt-5.6", ...fields, existing})
        expect(round).toEqual({
            params: {reasoning_effort: "high"},
            model: "gpt-5.6",
            provider: "openai",
            connection: {mode: "agenta", slug: "openai-prod"},
        })
    })
})

describe("connectionUtils: capability gating (inspect-fed)", () => {
    it("reads providers and modes from the passed-in capability map", () => {
        expect(allowedProviders(CAPABILITIES, "pi_core")).toEqual(["openai", "anthropic", "gemini"])
        expect(allowedProviders(CAPABILITIES, "claude")).toEqual(["anthropic"])
        expect(allowedConnectionModes(CAPABILITIES, "pi_core")).toEqual(["agenta", "self_managed"])
        expect(harnessAllowsProvider(CAPABILITIES, "claude", "anthropic")).toBe(true)
        expect(harnessAllowsProvider(CAPABILITIES, "claude", "Anthropic")).toBe(true)
        expect(harnessAllowsProvider(CAPABILITIES, "claude", "openai")).toBe(false)
    })

    it("exposes the per-harness model selection mode", () => {
        expect(modelSelectionMode(CAPABILITIES, "pi_core")).toBe("provider/id")
        expect(modelSelectionMode(CAPABILITIES, "claude")).toBe("alias")
    })

    it("is permissive when the map or harness is missing", () => {
        expect(allowedProviders(null, "pi_core")).toEqual(["*"])
        expect(allowedProviders(CAPABILITIES, "future-harness")).toEqual(["*"])
        expect(allowedProviders(CAPABILITIES, null)).toEqual(["*"])
        expect(allowedConnectionModes(undefined, "pi_core")).toEqual(["agenta", "self_managed"])
        expect(harnessAllowsProvider(CAPABILITIES, "future-harness", "whatever")).toBe(true)
        expect(modelSelectionMode(null, "pi_core")).toBe("provider/id")
    })
})

describe("connectionUtils: harness-filtered model picker", () => {
    it("builds grouped options from the harness's published models", () => {
        const groups = buildModelOptionGroups(CAPABILITIES, "pi_core")
        const byLabel = Object.fromEntries(
            groups.map((g) => [g.label, g.options.map((o) => o.value)]),
        )
        expect(byLabel["Openai"]).toEqual(["gpt-5.5", "gpt-5.4"])
        expect(byLabel["Anthropic"]).toEqual(["anthropic/claude-opus-4-7"])
        expect(byLabel["Gemini"]).toEqual(["gemini/gemini-2.5-pro"])
    })

    it("groups Claude aliases under anthropic (alias selection)", () => {
        const groups = buildModelOptionGroups(CAPABILITIES, "claude")
        expect(groups).toHaveLength(1)
        expect(groups[0].label).toBe("Anthropic")
        expect(groups[0].options.map((o) => o.value)).toEqual(["opus", "sonnet", "opus[1m]"])
    })

    it("attaches pricing metadata when provided", () => {
        const metadata = {openai: {"gpt-5.5": {input: 1, output: 2}}}
        const groups = buildModelOptionGroups(CAPABILITIES, "pi_core", metadata)
        const openai = groups.find((g) => g.label === "Openai")!
        expect(openai.options.find((o) => o.value === "gpt-5.5")?.metadata).toEqual({
            input: 1,
            output: 2,
        })
    })

    it("returns [] when the harness publishes no models (FE falls back to the catalog)", () => {
        expect(buildModelOptionGroups(null, "pi_core")).toEqual([])
        expect(buildModelOptionGroups(CAPABILITIES, "future-harness")).toEqual([])
    })

    it("derives the provider from the picked model (sets both provider and model)", () => {
        expect(providerForModel(CAPABILITIES, "pi_core", "gpt-5.5")).toBe("openai")
        expect(providerForModel(CAPABILITIES, "pi_core", "gemini/gemini-2.5-pro")).toBe("gemini")
        // Claude alias derives anthropic.
        expect(providerForModel(CAPABILITIES, "claude", "opus")).toBe("anthropic")
        // A stale id under the wrong harness derives nothing.
        expect(providerForModel(CAPABILITIES, "claude", "gpt-5.5")).toBeNull()
    })

    it("clears a model unreachable under a switched harness", () => {
        // gpt-5.5 is a pi_core model; not reachable on claude.
        expect(harnessAllowsModel(CAPABILITIES, "pi_core", "gpt-5.5")).toBe(true)
        expect(harnessAllowsModel(CAPABILITIES, "claude", "gpt-5.5")).toBe(false)
        expect(harnessAllowsModel(CAPABILITIES, "claude", "opus")).toBe(true)
        // No published models -> permissive (don't over-clear the catalog fallback).
        expect(harnessAllowsModel(CAPABILITIES, "future-harness", "anything")).toBe(true)
        expect(harnessAllowsModel(CAPABILITIES, "pi_core", null)).toBe(true)
    })
})

describe("connectionUtils: vaultModelGroups (custom_provider connections)", () => {
    it("includes a connection whose kind is a plain provider family the harness reaches", () => {
        // pi_core reaches "openai" directly — a second, differently-configured "openai"-kind
        // connection (e.g. a self-hosted OpenAI-compatible gateway) must still surface its models.
        const groups = vaultModelGroups(
            [{name: "my-provider", provider: "openai", models: ["my-model-1"]}],
            CAPABILITIES,
            "pi_core",
        )
        expect(groups).toEqual([
            {
                label: "my-provider",
                options: [
                    {
                        label: "my-model-1",
                        value: "my-model-1",
                        metadata: {connectionSlug: "my-provider", provider: "openai"},
                    },
                ],
            },
        ])
    })

    it("excludes a plain-provider-family connection the harness cannot reach", () => {
        // claude only reaches anthropic — an "openai"-kind connection is not selectable there.
        expect(
            vaultModelGroups(
                [{name: "my-provider", provider: "openai", models: ["my-model-1"]}],
                CAPABILITIES,
                "claude",
            ),
        ).toEqual([])
    })

    it("gates a deployment-kind connection (custom/bedrock/vertex_ai) against consumable deployments, not providers", () => {
        // claude's capability entry declares "custom" as a consumable deployment.
        expect(
            vaultModelGroups(
                [{name: "my-gateway", provider: "custom", models: ["gpt-oss"]}],
                CAPABILITIES,
                "claude",
            ),
        ).toHaveLength(1)
        // pi_core only consumes "direct" — a "custom" deployment connection stays hidden there
        // (matches the runner: Pi ignores a resolved custom endpoint/base_url in v1).
        expect(
            vaultModelGroups(
                [{name: "my-gateway", provider: "custom", models: ["gpt-oss"]}],
                CAPABILITIES,
                "pi_core",
            ),
        ).toEqual([])
    })

    it("is permissive when the capability map is missing (no over-filtering a standalone control)", () => {
        expect(
            vaultModelGroups(
                [{name: "my-provider", provider: "openai", models: ["my-model-1"]}],
                null,
                "pi_core",
            ),
        ).toHaveLength(1)
    })

    it("skips connections with no slug or no models", () => {
        expect(
            vaultModelGroups(
                [
                    {name: "", provider: "openai", models: ["m1"]},
                    {name: "empty", provider: "openai", models: []},
                ],
                CAPABILITIES,
                "pi_core",
            ),
        ).toEqual([])
    })
})

describe("connectionUtils: isDeploymentProviderKind", () => {
    it("names deployment surfaces (hosting mechanisms, not model families)", () => {
        expect(isDeploymentProviderKind("bedrock")).toBe(true)
        expect(isDeploymentProviderKind("azure")).toBe(true)
        expect(isDeploymentProviderKind("vertex_ai")).toBe(true)
        expect(isDeploymentProviderKind("custom")).toBe(true)
        expect(isDeploymentProviderKind("sagemaker")).toBe(true)
        expect(isDeploymentProviderKind("BEDROCK")).toBe(true)
    })

    it("does not treat a plain provider family as a deployment kind", () => {
        expect(isDeploymentProviderKind("openai")).toBe(false)
        expect(isDeploymentProviderKind("anthropic")).toBe(false)
        expect(isDeploymentProviderKind(null)).toBe(false)
        expect(isDeploymentProviderKind(undefined)).toBe(false)
    })
})

describe("connectionUtils: vaultPickedProviderFamily (F1 — vault pick must persist a provider)", () => {
    it("prefers the family the model id itself encodes over the connection's own kind", () => {
        // A deployment-hosted id ("eu.anthropic...") already encodes anthropic — the connection's
        // own "bedrock" kind (a hosting mechanism) must not override it.
        expect(
            vaultPickedProviderFamily("eu.anthropic.claude-haiku-4-5", "bedrock", CAPABILITIES),
        ).toBe("anthropic")
    })

    it("falls back to the connection's own kind when it is already a plain family", () => {
        // The regression case: a plain custom connection (kind "openai") whose own model id
        // ("my-model-1") encodes no family. Before the fix this silently dropped the provider.
        expect(vaultPickedProviderFamily("my-model-1", "openai", CAPABILITIES)).toBe("openai")
    })

    it("never falls back to a deployment kind as the provider (not itself a model family)", () => {
        // No vendor-prefixed id AND the connection's own kind is a deployment surface: there is no
        // safe family to derive, so the caller (useModelHarness.writeModel) falls back further to
        // the prior provider rather than persisting an invalid one.
        expect(vaultPickedProviderFamily("my-model-1", "bedrock", CAPABILITIES)).toBeNull()
    })

    it("returns null when neither the id nor the metadata provider resolve a family", () => {
        expect(vaultPickedProviderFamily("my-model-1", null, CAPABILITIES)).toBeNull()
        expect(vaultPickedProviderFamily(null, null, CAPABILITIES)).toBeNull()
    })

    it("still resolves the family from metadata alone when the id is absent", () => {
        expect(vaultPickedProviderFamily(null, "openai", CAPABILITIES)).toBe("openai")
    })
})
