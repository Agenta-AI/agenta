/**
 * Unit tests for the connection-first playground picker (`connectionPicker`).
 *
 * The rules these pin down are the ones the design turns on: a row is a CONNECTION (two OpenAI
 * keys are two rows), a connection's models are its saved list or Agenta's defaults, a model+harness
 * pair only exists when the harness can both drive the connection and spell the model, and a pick
 * persists the exact connection slug. Runs under @agenta/entity-ui's own vitest runner.
 */
import {SecretKind, type ProviderConnection} from "@agenta/entities/secret"
import {describe, expect, it} from "vitest"

import {
    COST_HINTS,
    buildConnectionPickerRows,
    buildPickerGroups,
    connectionModelIds,
    effectiveHarnesses,
    pickerSelectionFrom,
} from "../../src/DrillInView/SchemaControls/connectionPicker"
import {composeModelValue} from "../../src/DrillInView/SchemaControls/connectionUtils"
import type {HarnessCapabilitiesMap} from "../../src/DrillInView/SchemaControls/connectionUtils"

const CAPABILITIES: HarnessCapabilitiesMap = {
    pi_core: {
        providers: ["openai", "anthropic"],
        deployments: ["direct", "bedrock"],
        connection_modes: ["agenta", "self_managed"],
        model_selection: "provider/id",
        models: {
            openai: ["openai/gpt-5.5", "openai/gpt-5.4"],
            anthropic: ["anthropic/claude-fable-5"],
        },
        default_models: {openai: ["openai/gpt-5.5"]},
    },
    claude: {
        providers: ["anthropic"],
        deployments: ["direct"],
        connection_modes: ["agenta", "self_managed"],
        model_selection: "alias",
        models: {anthropic: ["claude-fable-5", "sonnet"]},
        default_models: {anthropic: ["claude-fable-5"]},
    },
}

const HARNESS_IDS = ["pi_core", "claude"]

const standard = (
    id: string,
    kind: string,
    overrides: Partial<ProviderConnection> = {},
): ProviderConnection => ({
    id,
    name: overrides.name ?? kind,
    kind,
    title: kind,
    secretKind: SecretKind.ProviderKey,
    source: {name: `${kind}_api_key`, title: kind, key: "sk-test"} as ProviderConnection["source"],
    ...overrides,
})

/** A `custom_provider` record — its models come from the endpoint, not from Agenta's catalog. */
const custom = (
    id: string,
    kind: string,
    modelKeys: string[],
    overrides: Partial<ProviderConnection> = {},
): ProviderConnection => ({
    id,
    name: overrides.name ?? `my-${kind}`,
    kind,
    title: kind,
    secretKind: SecretKind.CustomProvider,
    source: {name: `my-${kind}`, provider: kind, modelKeys} as ProviderConnection["source"],
    ...overrides,
})

describe("effectiveHarnesses", () => {
    it("defaults to every harness that can technically reach the provider", () => {
        expect(effectiveHarnesses(standard("1", "openai"), CAPABILITIES, HARNESS_IDS)).toEqual([
            "pi_core",
        ])
        expect(effectiveHarnesses(standard("2", "anthropic"), CAPABILITIES, HARNESS_IDS)).toEqual([
            "pi_core",
            "claude",
        ])
    })

    it("intersects the saved harness policy with technical reach", () => {
        const connection = standard("3", "anthropic", {harnesses: ["claude"]})
        expect(effectiveHarnesses(connection, CAPABILITIES, HARNESS_IDS)).toEqual(["claude"])
    })

    it("drops a saved harness the provider cannot be reached from", () => {
        const connection = standard("4", "openai", {harnesses: ["claude"]})
        expect(effectiveHarnesses(connection, CAPABILITIES, HARNESS_IDS)).toEqual([])
    })
})

describe("connectionModelIds", () => {
    it("uses the saved list when the connection has one", () => {
        const connection = standard("1", "openai", {models: ["gpt-5.4"]})
        expect(connectionModelIds(connection, CAPABILITIES)).toEqual(["gpt-5.4"])
    })

    it("honours an explicitly empty saved list", () => {
        const connection = standard("1", "openai", {models: []})
        expect(connectionModelIds(connection, CAPABILITIES)).toEqual([])
    })

    it("falls back to the provider's default models when none were saved", () => {
        expect(connectionModelIds(standard("1", "openai"), CAPABILITIES)).toEqual(["gpt-5.5"])
    })

    it("falls back to the family's full catalog when the backend publishes no defaults", () => {
        const noDefaults: HarnessCapabilitiesMap = {
            pi_core: {...CAPABILITIES.pi_core, default_models: undefined},
        }
        expect(connectionModelIds(standard("1", "openai"), noDefaults)).toEqual([
            "gpt-5.5",
            "gpt-5.4",
        ])
    })

    it("offers a credential-set connection its own model keys even under a plain family kind", () => {
        // A `custom_provider` saved under "openai" (a second, differently-configured endpoint)
        // serves what ITS endpoint serves. Defaulting to Agenta's openai catalog would offer
        // models this connection has never heard of, so the record's kind decides, not the
        // family's default shape.
        expect(
            connectionModelIds(custom("1", "openai", ["my-gateway/openai/gpt-oss"]), CAPABILITIES),
        ).toEqual(["my-gateway/openai/gpt-oss"])
    })
})

describe("buildConnectionPickerRows", () => {
    it("gives two OpenAI connections two rows", () => {
        const rows = buildConnectionPickerRows({
            connections: [
                standard("1", "openai", {name: "OpenAI", slug: "openai"}),
                standard("2", "openai", {name: "OpenAI 2", slug: "openai-2"}),
            ],
            capabilities: CAPABILITIES,
            harnessIds: HARNESS_IDS,
        }).filter((row) => row.kind === "connection")

        expect(rows.map((row) => row.name)).toEqual(["OpenAI", "OpenAI 2"])
        expect(rows.map((row) => row.key)).toEqual(["1", "2"])
        expect(rows.every((row) => row.iconKey === "openai")).toBe(true)
    })

    it("emits one row per model and harness pair, in the harness's own spelling", () => {
        const rows = buildConnectionPickerRows({
            connections: [
                standard("1", "anthropic", {
                    name: "Anthropic",
                    slug: "anthropic",
                    models: ["claude-fable-5"],
                }),
            ],
            capabilities: CAPABILITIES,
            harnessIds: HARNESS_IDS,
        })

        expect(rows[0].models.map((model) => [model.harness, model.modelId])).toEqual([
            // Pi prefixes the family, Claude names the bare alias — the same saved model.
            ["pi_core", "anthropic/claude-fable-5"],
            ["claude", "claude-fable-5"],
        ])
        expect(rows[0].models.every((model) => model.slug === "anthropic")).toBe(true)
        expect(rows[0].models.every((model) => model.provider === "anthropic")).toBe(true)
    })

    it("drops a saved model the harness does not publish", () => {
        const rows = buildConnectionPickerRows({
            connections: [standard("1", "openai", {models: ["gpt-5.5", "not-a-model"]})],
            capabilities: CAPABILITIES,
            harnessIds: HARNESS_IDS,
        })
        expect(rows[0].models.map((model) => model.modelId)).toEqual(["openai/gpt-5.5"])
    })

    it("hints at cost only when a model is reachable more than once", () => {
        const rows = buildConnectionPickerRows({
            connections: [
                standard("1", "anthropic", {slug: "a", models: ["claude-fable-5"]}),
                standard("2", "openai", {slug: "b", models: ["gpt-5.4"]}),
            ],
            capabilities: CAPABILITIES,
            harnessIds: HARNESS_IDS,
        })

        const anthropic = rows.find((row) => row.key === "1")!
        const openai = rows.find((row) => row.key === "2")!
        // Reachable through Pi AND Claude, and through the Claude subscription.
        expect(anthropic.models.every((model) => model.costHint === COST_HINTS.api)).toBe(true)
        // Reachable once (Pi only).
        expect(openai.models.map((model) => model.costHint)).toEqual([null])
    })

    it("lists a subscription as its own row, with no slug to persist", () => {
        const rows = buildConnectionPickerRows({
            connections: [],
            capabilities: CAPABILITIES,
            harnessIds: HARNESS_IDS,
        })

        expect(rows.map((row) => row.name)).toEqual(["Claude subscription"])
        const subscription = rows[0]
        expect(subscription.kind).toBe("subscription")
        expect(subscription.iconKey).toBe("anthropic")
        expect(subscription.models.every((model) => model.mode === "self_managed")).toBe(true)
        expect(subscription.models.every((model) => model.slug === null)).toBe(true)
    })

    it("drops subscription rows where no login can be mounted (cloud)", () => {
        const args = {
            connections: [standard("1", "anthropic", {slug: "anthropic"})],
            capabilities: CAPABILITIES,
            harnessIds: HARNESS_IDS,
        }

        expect(
            buildConnectionPickerRows({...args, showSubscriptions: false}).every(
                (row) => row.kind === "connection",
            ),
        ).toBe(true)
        // The stored connections are untouched by the gate.
        expect(
            buildConnectionPickerRows({...args, showSubscriptions: false}).map((row) => row.key),
        ).toEqual(["1"])
        expect(buildConnectionPickerRows(args).some((row) => row.kind === "subscription")).toBe(
            true,
        )
    })

    it("marks a subscription's shared model as free and the API one as metered", () => {
        const rows = buildConnectionPickerRows({
            connections: [
                standard("1", "anthropic", {
                    slug: "anthropic",
                    models: ["claude-fable-5"],
                    harnesses: ["claude"],
                }),
            ],
            capabilities: CAPABILITIES,
            harnessIds: HARNESS_IDS,
        })

        const key = rows.find((row) => row.kind === "connection")!
        const subscription = rows.find((row) => row.kind === "subscription")!
        expect(key.models[0].costHint).toBe(COST_HINTS.api)
        expect(
            subscription.models.find((model) => model.modelId === "claude-fable-5")!.costHint,
        ).toBe(COST_HINTS.subscription)
    })
})

describe("buildPickerGroups", () => {
    it("carries the harness tag, the cost hint and the connection as the search subtitle", () => {
        const groups = buildPickerGroups(
            buildConnectionPickerRows({
                connections: [
                    standard("1", "anthropic", {
                        name: "Anthropic prod",
                        slug: "anthropic-prod",
                        models: ["claude-fable-5"],
                    }),
                ],
                capabilities: CAPABILITIES,
                harnessIds: HARNESS_IDS,
            }),
        )

        const connectionGroup = groups.find((group) => group.label === "Anthropic prod")!
        expect(connectionGroup.key).toBe("1")
        expect(connectionGroup.iconKey).toBe("anthropic")
        // The flat search view has no group column, so each option names its connection itself.
        expect(
            connectionGroup.options.every((option) => option.searchCaption === "Anthropic prod"),
        ).toBe(true)
        expect(connectionGroup.options.map((option) => option.tag)).toEqual(["Pi", "Claude Code"])
        expect(connectionGroup.options.every((option) => option.caption === COST_HINTS.api)).toBe(
            true,
        )
        // One model under two harnesses: the value repeats, so the key must not.
        expect(new Set(connectionGroup.options.map((option) => option.key)).size).toBe(
            connectionGroup.options.length,
        )
    })
})

describe("a standard connection's slug", () => {
    it("does not make its model look unreachable", async () => {
        const {harnessAllowsModel} =
            await import("../../src/DrillInView/SchemaControls/connectionUtils")
        // Every pick now persists a slug, including a standard connection's. Only a slug that
        // names a CUSTOM connection restricts the model list to that connection's own models.
        expect(harnessAllowsModel(CAPABILITIES, "claude", "claude-fable-5", [], "anthropic")).toBe(
            true,
        )
        expect(
            harnessAllowsModel(
                CAPABILITIES,
                "claude",
                "claude-fable-5",
                [{name: "my-bedrock", provider: "bedrock", models: ["other-model"]}],
                "my-bedrock",
            ),
        ).toBe(false)
    })
})

describe("pickerSelectionFrom", () => {
    it("reads the connection, mode and harness off the picked option", () => {
        expect(
            pickerSelectionFrom("openai/gpt-5.5", {
                connectionSlug: "openai-2",
                connectionMode: "agenta",
                harness: "pi_core",
                provider: "openai",
            }),
        ).toEqual({
            modelId: "openai/gpt-5.5",
            provider: "openai",
            mode: "agenta",
            slug: "openai-2",
            harness: "pi_core",
        })
    })

    it("clears the slug for a subscription pick", () => {
        expect(
            pickerSelectionFrom("claude-fable-5", {
                connectionSlug: "anthropic",
                connectionMode: "self_managed",
                harness: "claude",
            }),
        ).toMatchObject({mode: "self_managed", slug: null})
    })

    it("resolves an option with no metadata to the project-default connection", () => {
        expect(pickerSelectionFrom("gpt-5.5")).toEqual({
            modelId: "gpt-5.5",
            provider: null,
            mode: "agenta",
            slug: null,
            harness: null,
        })
    })
})

describe("the persisted ModelRef", () => {
    const persist = (metadata: Record<string, unknown> | undefined, existing?: unknown) => {
        const selection = pickerSelectionFrom("openai/gpt-5.5", metadata)
        return composeModelValue({
            modelId: selection.modelId,
            provider: selection.provider,
            mode: selection.mode,
            slug: selection.slug,
            existing,
        })
    }

    it("writes the exact connection slug beside the model and provider", () => {
        expect(
            persist({connectionSlug: "openai-2", connectionMode: "agenta", provider: "openai"}),
        ).toEqual({
            model: "openai/gpt-5.5",
            provider: "openai",
            connection: {mode: "agenta", slug: "openai-2"},
        })
    })

    it("clears a stale slug when the new pick carries none", () => {
        const existing = {
            model: "anthropic/claude-fable-5",
            provider: "anthropic",
            connection: {mode: "agenta", slug: "anthropic-prod"},
        }
        expect(persist({connectionMode: "agenta", provider: "openai"}, existing)).toEqual({
            model: "openai/gpt-5.5",
            provider: "openai",
        })
    })

    it("keeps extra ModelRef keys through a pick", () => {
        const existing = {model: "gpt-5.4", params: {reasoning_effort: "high"}}
        expect(
            persist(
                {connectionSlug: "openai", connectionMode: "agenta", provider: "openai"},
                existing,
            ),
        ).toMatchObject({params: {reasoning_effort: "high"}})
    })
})
