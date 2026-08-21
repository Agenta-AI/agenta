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
    bareConnectionModelId,
    harnessAllowsModel,
    harnessAllowsProvider,
    harnessSupportsUserMcp,
    isDeploymentProviderKind,
    modelIdFromConfig,
    modelDisplayName,
    modelLabel,
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
        mcp: {
            user_servers: {
                connection_types: ["http"],
                credentials: ["none", "header_secret_refs"],
            },
        },
    },
    // A Pi-family harness that consumes the OpenAI-compatible `custom` deployment AND reaches the
    // openai provider family — the one combination an OpenAI-compatible connection may surface for.
    pi_openai_compat: {
        providers: ["openai"],
        deployments: ["direct", "custom"],
        connection_modes: ["agenta", "self_managed"],
        model_selection: "provider/id",
        models: {openai: ["gpt-5.5"]},
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
    it("shows external MCP authoring only when the harness publishes it", () => {
        expect(harnessSupportsUserMcp(CAPABILITIES, "claude")).toBe(true)
        expect(harnessSupportsUserMcp(CAPABILITIES, "pi_core")).toBe(false)
        expect(harnessSupportsUserMcp(null, "claude")).toBe(false)
    })

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

    it("supports custom-provider vault models with non-standard ID shapes when reachable by harness", () => {
        const secrets = [
            {
                name: "my-bedrock",
                provider: "bedrock",
                models: ["custom-bedrock-model-id-123"],
            },
        ]
        // claude harness consumes bedrock -> returns true even with non-standard model ID shape
        expect(
            harnessAllowsModel(
                CAPABILITIES,
                "claude",
                "custom-bedrock-model-id-123",
                secrets,
                "my-bedrock",
            ),
        ).toBe(true)
        // pi_core harness does not consume bedrock -> returns false
        expect(
            harnessAllowsModel(
                CAPABILITIES,
                "pi_core",
                "custom-bedrock-model-id-123",
                secrets,
                "my-bedrock",
            ),
        ).toBe(false)
        // bogus model id not in secrets or catalog -> returns false
        expect(
            harnessAllowsModel(CAPABILITIES, "claude", "bogus-model-id", secrets, "my-bedrock"),
        ).toBe(false)
    })

    it("accepts a connection's model_keys, which is what the picker persists", () => {
        // A credential-set (custom) connection publishes only `model_keys` — the fully qualified
        // "<name>/<kind>/<model>" spelling the picker saves — while `models` holds bare slugs. A
        // check against `models` alone reads a valid saved config back as unavailable and paints
        // the red "Unavailable" badge on a working agent.
        const secrets = [
            {
                name: "Starter credits",
                slug: "starter-credits",
                provider: "custom",
                models: [],
                modelKeys: ["Starter credits/custom/vertex_ai/gemini-3.6-flash"],
            },
        ]
        expect(
            harnessAllowsModel(
                CAPABILITIES,
                "pi_openai_compat",
                "Starter credits/custom/vertex_ai/gemini-3.6-flash",
                secrets,
                "starter-credits",
            ),
        ).toBe(true)
        // A key that connection does not publish is still unreachable.
        expect(
            harnessAllowsModel(
                CAPABILITIES,
                "pi_openai_compat",
                "someone-else/custom/x",
                secrets,
                "starter-credits",
            ),
        ).toBe(false)
    })

    it("requires a specific vault connection to explicitly support a model when slug is provided, skipping generic catalog checks (name collision)", () => {
        const secrets = [{name: "my-custom-conn", provider: "bedrock", models: ["other-model"]}]
        // "opus" is in the claude catalog.
        // A generic check (no slug) for "opus" returns true.
        expect(harnessAllowsModel(CAPABILITIES, "claude", "opus")).toBe(true)

        // But if we specifically ask whether "my-custom-conn" (which only supports "other-model")
        // allows "opus", it must return false, not falling back to the catalog.
        expect(harnessAllowsModel(CAPABILITIES, "claude", "opus", secrets, "my-custom-conn")).toBe(
            false,
        )

        // And it should return true for the model it actually supports
        expect(
            harnessAllowsModel(CAPABILITIES, "claude", "other-model", secrets, "my-custom-conn"),
        ).toBe(true)
    })

    it("matches a slugged record on its stored slug, and a legacy one on its name", () => {
        // What the picker persists is the record's slug when it has one, so that is what the
        // reachability check has to match on; a record predating slugs is still found by name.
        const slugged = [
            {
                slug: "my-bedrock-a1b2c3",
                name: "My Bedrock",
                provider: "bedrock",
                models: ["custom-bedrock-model-id-123"],
            },
        ]
        expect(
            harnessAllowsModel(
                CAPABILITIES,
                "claude",
                "custom-bedrock-model-id-123",
                slugged,
                "my-bedrock-a1b2c3",
            ),
        ).toBe(true)
        // The display name is not the identity once a slug is stored.
        expect(
            harnessAllowsModel(
                CAPABILITIES,
                "claude",
                "custom-bedrock-model-id-123",
                slugged,
                "My Bedrock",
            ),
        ).toBe(false)

        const legacy = [
            {name: "my-bedrock", provider: "bedrock", models: ["custom-bedrock-model-id-123"]},
        ]
        expect(
            harnessAllowsModel(
                CAPABILITIES,
                "claude",
                "custom-bedrock-model-id-123",
                legacy,
                "my-bedrock",
            ),
        ).toBe(true)
    })

    it("selectedKeepsModel regression: vault model flagged unavailable without secrets, available with them", () => {
        // Reproduces the false 'model not available' badge: the selectedKeepsModel derivation in
        // useModelHarness called harnessAllowsModel WITHOUT customSecrets or slug. The function is
        // correct — the call site was wrong. This test locks that in.
        const secrets = [
            {name: "my-bedrock", provider: "bedrock", models: ["custom-bedrock-model-id-123"]},
        ]
        // Old call (no secrets) — returns false → badge wrongly showed "model not available"
        expect(harnessAllowsModel(CAPABILITIES, "claude", "custom-bedrock-model-id-123")).toBe(
            false,
        )
        // Fixed call (secrets + slug threaded through) — returns true → badge shows "supports your model"
        expect(
            harnessAllowsModel(
                CAPABILITIES,
                "claude",
                "custom-bedrock-model-id-123",
                secrets,
                "my-bedrock",
            ),
        ).toBe(true)
        // Slug mismatch → still false (the credential is for a different connection)
        expect(
            harnessAllowsModel(
                CAPABILITIES,
                "claude",
                "custom-bedrock-model-id-123",
                secrets,
                "other-connection",
            ),
        ).toBe(false)
    })
})

describe("connectionUtils: model_catalog is preferred when published", () => {
    // A capability map that carries the curated catalog alongside the ids-only models map.
    const WITH_CATALOG: HarnessCapabilitiesMap = {
        pi_core: {
            providers: ["openai", "anthropic"],
            deployments: ["direct"],
            connection_modes: ["agenta", "self_managed"],
            model_selection: "provider/id",
            models: {openai: ["gpt-5.5"], anthropic: ["anthropic/claude-opus-4-7"]},
            model_catalog: [
                {
                    id: "openai/gpt-5.5",
                    provider: "openai",
                    source: "pi_generated",
                    name: "GPT-5.5",
                    pricing: {input_per_mtok: 5, output_per_mtok: 30, currency: "USD"},
                    description: "OpenAI's flagship general model.",
                },
                {
                    id: "anthropic/claude-fable-5",
                    provider: "anthropic",
                    source: "pi_generated",
                    name: "Claude Fable 5",
                    label: "Fable",
                    pricing: {input_per_mtok: 10, output_per_mtok: 50, currency: "USD"},
                    description: "Anthropic's most capable model.",
                    ratings: {cost: 1, intelligence: 5, speed: 2},
                },
            ],
        },
    }

    it("builds options from the catalog, labeling by label ?? name ?? id", () => {
        const groups = buildModelOptionGroups(WITH_CATALOG, "pi_core")
        const openai = groups.find((g) => g.label === "Openai")!
        const anthropic = groups.find((g) => g.label === "Anthropic")!
        // Option value is the catalog id; label prefers label, then name, then id.
        expect(openai.options[0]).toMatchObject({label: "GPT-5.5", value: "openai/gpt-5.5"})
        expect(anthropic.options[0]).toMatchObject({
            label: "Fable",
            value: "anthropic/claude-fable-5",
        })
    })

    describe("modelLabel", () => {
        it("names a BARE stored id from a family-prefixed catalog entry", () => {
            // The pill's bug: Pi publishes `anthropic/claude-fable-5`, the config stores the bare
            // id, and an exact compare missed — so the pill read the raw id instead of "Fable".
            expect(modelLabel(WITH_CATALOG, "pi_core", "claude-fable-5")).toBe("Fable")
        })

        it("still names the id spelled exactly as the catalog lists it", () => {
            expect(modelLabel(WITH_CATALOG, "pi_core", "anthropic/claude-fable-5")).toBe("Fable")
        })

        it("falls back to `name` when the entry curates no label", () => {
            expect(modelLabel(WITH_CATALOG, "pi_core", "gpt-5.5")).toBe("GPT-5.5")
            expect(modelLabel(WITH_CATALOG, "pi_core", "openai/gpt-5.5")).toBe("GPT-5.5")
        })

        it("names nothing for a model the catalog does not carry", () => {
            // The uncataloged case the picker labels with the user's own saved spelling.
            expect(modelLabel(WITH_CATALOG, "pi_core", "deepseek/deepseek-v4:nitro")).toBeNull()
            expect(modelLabel(WITH_CATALOG, "pi_core", null)).toBeNull()
        })
    })

    describe("bareConnectionModelId / modelDisplayName", () => {
        it("strips a connection model key down to the model's own id", () => {
            // What a credential-set connection stores: "<connection>/<deployment>/<id>", and the
            // id can carry the deployment's own prefix too.
            expect(bareConnectionModelId("Agenta/custom/vertex_ai/gemini-3.6-flash")).toBe(
                "gemini-3.6-flash",
            )
            expect(bareConnectionModelId("Starter credits/custom/gpt-oss")).toBe("gpt-oss")
        })

        it("leaves anything that is not a connection model key alone", () => {
            // A family-prefixed id is two segments and must survive: stripping it would break
            // every catalog lookup that matches on the family prefix.
            expect(bareConnectionModelId("anthropic/claude-fable-5")).toBe("anthropic/claude-fable-5")
            expect(bareConnectionModelId("gpt-5.5")).toBe("gpt-5.5")
            expect(bareConnectionModelId("eu.anthropic.claude-haiku-4-5")).toBe(
                "eu.anthropic.claude-haiku-4-5",
            )
            // Second segment is a provider family, not a deployment — not a key.
            expect(bareConnectionModelId("some/openai/thing")).toBe("some/openai/thing")
        })

        it("names a connection model key by the catalog's curated name", () => {
            // The user-visible fix: the Model row and the picker read "GPT-5.5", never the key.
            expect(
                modelDisplayName(WITH_CATALOG, "pi_core", "Agenta/custom/openai/gpt-5.5"),
            ).toBe("GPT-5.5")
        })

        it("falls back to the bare id, never to a guessed prettification", () => {
            expect(
                modelDisplayName(WITH_CATALOG, "pi_core", "Agenta/custom/vertex_ai/gemini-3.6-flash"),
            ).toBe("gemini-3.6-flash")
        })

        it("still names an ordinary catalogued id, and returns the id for an unknown one", () => {
            expect(modelDisplayName(WITH_CATALOG, "pi_core", "claude-fable-5")).toBe("Fable")
            expect(modelDisplayName(WITH_CATALOG, "pi_core", "deepseek/deepseek-v4:nitro")).toBe(
                "deepseek/deepseek-v4:nitro",
            )
            expect(modelDisplayName(WITH_CATALOG, "pi_core", null)).toBe("")
        })
    })

    it("fills the metadata seam: pricing as {input, output} plus description/name/ratings", () => {
        const groups = buildModelOptionGroups(WITH_CATALOG, "pi_core")
        const fable = groups
            .flatMap((g) => g.options)
            .find((o) => o.value === "anthropic/claude-fable-5")!
        expect(fable.metadata).toEqual({
            input: 10,
            output: 50,
            description: "Anthropic's most capable model.",
            name: "Claude Fable 5",
            ratings: {cost: 1, intelligence: 5, speed: 2},
        })
    })

    it("resolves provider and reachability from the catalog id", () => {
        expect(providerForModel(WITH_CATALOG, "pi_core", "anthropic/claude-fable-5")).toBe(
            "anthropic",
        )
        expect(harnessAllowsModel(WITH_CATALOG, "pi_core", "anthropic/claude-fable-5")).toBe(true)
        // An id in neither the catalog nor the models map is not reachable.
        expect(harnessAllowsModel(WITH_CATALOG, "pi_core", "bogus/model")).toBe(false)
    })

    it("still resolves a legacy id that is only in the models map (migration fallback)", () => {
        // anthropic/claude-opus-4-7 is in `models` but not in the catalog; it must still resolve.
        expect(providerForModel(WITH_CATALOG, "pi_core", "anthropic/claude-opus-4-7")).toBe(
            "anthropic",
        )
        expect(harnessAllowsModel(WITH_CATALOG, "pi_core", "anthropic/claude-opus-4-7")).toBe(true)
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

    it("gates a NON-custom deployment kind (bedrock) against consumable deployments only", () => {
        // claude declares "bedrock" as a consumable deployment; its models encode their own family,
        // so deployment consumption alone is the gate (no single-family provider check).
        expect(
            vaultModelGroups(
                [
                    {
                        name: "my-bedrock",
                        provider: "bedrock",
                        models: ["eu.anthropic.claude-haiku-4-5"],
                    },
                ],
                CAPABILITIES,
                "claude",
            ),
        ).toHaveLength(1)
        // pi_core only consumes "direct" — a "bedrock" deployment connection stays hidden there.
        expect(
            vaultModelGroups(
                [
                    {
                        name: "my-bedrock",
                        provider: "bedrock",
                        models: ["eu.anthropic.claude-haiku-4-5"],
                    },
                ],
                CAPABILITIES,
                "pi_core",
            ),
        ).toEqual([])
    })

    it("gates an OpenAI-compatible (custom) connection by BOTH consumable deployment and openai reach", () => {
        // A harness that consumes `custom` AND reaches openai is offered it.
        expect(
            vaultModelGroups(
                [{name: "my-gateway", provider: "custom", models: ["gpt-oss"]}],
                CAPABILITIES,
                "pi_openai_compat",
            ),
        ).toHaveLength(1)
        // claude consumes `custom` but only reaches anthropic — the OpenAI-compatible connection is
        // NOT offered (it resolves to the openai family Claude cannot run).
        expect(
            vaultModelGroups(
                [{name: "my-gateway", provider: "custom", models: ["gpt-oss"]}],
                CAPABILITIES,
                "claude",
            ),
        ).toEqual([])
        // pi_core does not consume `custom` at all — hidden regardless of provider reach.
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
        // A custom connection is also offered under a missing map (both gates read permissive).
        expect(
            vaultModelGroups(
                [{name: "my-gateway", provider: "custom", models: ["gpt-oss"]}],
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

    // Regression pins: the OpenAI-compatible feature adds a `custom`-only branch. Every flow that
    // does NOT involve a custom connection must stay byte-identical to pre-feature behavior.
    it("regression: an empty vault yields no groups on any harness (default picker state)", () => {
        expect(vaultModelGroups([], CAPABILITIES, "pi_core")).toEqual([])
        expect(vaultModelGroups([], CAPABILITIES, "claude")).toEqual([])
        expect(vaultModelGroups(null, CAPABILITIES, "claude")).toEqual([])
    })

    it("regression: a Claude harness still sees its reachable (anthropic) vault connection unchanged", () => {
        expect(
            vaultModelGroups(
                [{name: "my-anthropic", provider: "anthropic", models: ["a1"]}],
                CAPABILITIES,
                "claude",
            ),
        ).toHaveLength(1)
    })

    it("stamps the stored slug, not the display name, when the record carries one", () => {
        // Records created since the vault slice carry a real slug, and the picker persists it —
        // so the group's option metadata must name the slug the resolver matches on.
        expect(
            vaultModelGroups(
                [
                    {
                        slug: "my-bedrock-a1b2c3",
                        name: "My Bedrock",
                        provider: "bedrock",
                        models: ["eu.anthropic.claude-haiku-4-5"],
                    },
                ],
                CAPABILITIES,
                "claude",
            ),
        ).toEqual([
            {
                label: "My Bedrock",
                options: [
                    {
                        label: "eu.anthropic.claude-haiku-4-5",
                        value: "eu.anthropic.claude-haiku-4-5",
                        metadata: {connectionSlug: "my-bedrock-a1b2c3", provider: "bedrock"},
                    },
                ],
            },
        ])
    })

    it("regression: a non-custom deployment connection to Claude is unchanged by the custom gate", () => {
        // Claude consumes bedrock; the new openai-family check must NOT touch non-custom kinds.
        expect(
            vaultModelGroups(
                [
                    {
                        name: "my-bedrock",
                        provider: "bedrock",
                        models: ["eu.anthropic.claude-haiku-4-5"],
                    },
                ],
                CAPABILITIES,
                "claude",
            ),
        ).toHaveLength(1)
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
        // safe family to derive from these two alone, so the caller must write NO provider rather
        // than an invalid one (a deployment kind fails the server's harness/provider check).
        expect(vaultPickedProviderFamily("my-model-1", "bedrock", CAPABILITIES)).toBeNull()
    })

    it("resolves a deployment kind's family from the driving harness when it reaches only one", () => {
        // The live bug: a Bedrock connection under Claude Code, whose model id names only the model
        // ("claude-3-sonnet-20240229-v1:0"). Bedrock hosts many vendors, but Claude Code reaches
        // exactly one family, so the answer is not a guess — and it is the pair the server accepts.
        expect(
            vaultPickedProviderFamily(
                "claude-3-sonnet-20240229-v1:0",
                "bedrock",
                CAPABILITIES,
                "claude",
            ),
        ).toBe("anthropic")
        // A harness reaching several families leaves it undecidable — still null, never a guess.
        expect(
            vaultPickedProviderFamily("some-opaque-id", "bedrock", CAPABILITIES, "pi_core"),
        ).toBeNull()
    })

    it("returns null when neither the id nor the metadata provider resolve a family", () => {
        expect(vaultPickedProviderFamily("my-model-1", null, CAPABILITIES)).toBeNull()
        expect(vaultPickedProviderFamily(null, null, CAPABILITIES)).toBeNull()
    })

    it("still resolves the family from metadata alone when the id is absent", () => {
        expect(vaultPickedProviderFamily(null, "openai", CAPABILITIES)).toBe("openai")
    })

    it("writes NO provider for an OpenAI-compatible (custom) connection", () => {
        // A named custom connection routes by slug alone. Its models are stored as `model_keys`
        // ("<name>/custom/<model>") and the resolver matches them against
        // `ModelRef.to_model_string()`, which a written provider turns into "<provider>/<key>" —
        // matching no key, so the raw id reaches the endpoint. The resolver supplies the family
        // itself (`resolved_provider` normalizes a provider-less custom connection to openai).
        expect(vaultPickedProviderFamily("gpt-oss", "custom", CAPABILITIES)).toBeNull()
        expect(vaultPickedProviderFamily("qwen2.5-coder:7b", "custom", CAPABILITIES)).toBeNull()
    })

    it("writes no provider for a custom connection even when the id encodes a family", () => {
        // The prefix would break the model_keys match just the same, and "anthropic/" is not a
        // route the OpenAI-compatible endpoint understands.
        expect(
            vaultPickedProviderFamily("eu.anthropic.claude-haiku-4-5", "custom", CAPABILITIES),
        ).toBeNull()
    })
})

describe("connectionUtils: a custom pick keeps the slug and omits the provider", () => {
    // Mirrors what `useModelHarness.writeModel` composes for a picked OpenAI-compatible option: the
    // option's own connection slug (threaded through `metadata.connectionSlug`) is the whole
    // routing identity, and no provider rides along to prefix the model id.
    it("composes a ModelRef with the agenta slug and no provider key", () => {
        const provider = vaultPickedProviderFamily("gpt-oss", "custom", CAPABILITIES)
        const ref = composeModelValue({
            modelId: "gpt-oss",
            provider,
            mode: "agenta",
            slug: "my-gateway",
        })
        expect(ref).toEqual({
            model: "gpt-oss",
            connection: {mode: "agenta", slug: "my-gateway"},
        })
        expect(ref).not.toHaveProperty("provider")
    })
})
