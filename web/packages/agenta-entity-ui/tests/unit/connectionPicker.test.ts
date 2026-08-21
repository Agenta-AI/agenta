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
    buildConnectionPickerRows,
    connectionModelIds,
    effectiveHarnesses,
    modelRowKey,
    pickerSelectionFrom,
    selectedModelRowKey,
    selectionFromModelRow,
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
        // Mirrors the shipped catalog: Claude Code reaches one family through several hostings.
        deployments: ["direct", "custom", "bedrock", "vertex_ai"],
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

    it("prefers a credential-set connection's model keys over its bare saved slugs", () => {
        // The row carries both: `models` holds bare slugs (the card's spelling), `modelKeys` the
        // namespaced ids. The SDK matches a custom connection on `model_keys` only, so offering
        // the bare slug persists a value that resolves to no provider settings.
        const connection = custom("1", "openai", ["my-gateway/openai/gpt-oss"], {
            models: ["gpt-oss"],
        })
        expect(connectionModelIds(connection, CAPABILITIES)).toEqual(["my-gateway/openai/gpt-oss"])
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

    it("still offers a saved model the harness catalog does not publish", () => {
        // The catalog enumerates what a vendor advertises, not everything it accepts. Dropping the
        // unlisted id silently swallowed models the user had deliberately added.
        const rows = buildConnectionPickerRows({
            connections: [standard("1", "openai", {models: ["gpt-5.5", "not-a-model"]})],
            capabilities: CAPABILITIES,
            harnessIds: HARNESS_IDS,
        })
        expect(rows[0].models.map((model) => model.modelId)).toEqual([
            "openai/gpt-5.5",
            "openai/not-a-model",
        ])
    })

    it("spells an uncataloged saved id the harness's own way, prefixing exactly once", () => {
        // The founder's repro: a manually added OpenRouter variant. `:nitro` is a routing suffix no
        // curated catalog enumerates, so the id only ever arrives via the user's saved list.
        const variant = "deepseek/deepseek-v4-flash:nitro"
        const rows = buildConnectionPickerRows({
            connections: [
                standard("1", "openrouter", {
                    name: "OpenRouter",
                    slug: "openrouter",
                    models: [variant],
                }),
            ],
            capabilities: {
                pi_core: {
                    ...CAPABILITIES.pi_core,
                    providers: ["openrouter"],
                    models: {openrouter: ["openrouter/deepseek/deepseek-v4-flash"]},
                    default_models: undefined,
                },
            },
            harnessIds: ["pi_core"],
        })

        // Pi declares `model_selection: "provider/id"`, so the family prefix rides along — the bare
        // id the user typed would not route.
        expect(rows[0].models.map((model) => model.modelId)).toEqual([`openrouter/${variant}`])
        // …but it READS BACK exactly as typed, matching the completion picker. What routes and what
        // the row is called are allowed to differ; a curated row already does this.
        expect(rows[0].models.map((model) => model.label)).toEqual([variant])
        expect(selectionFromModelRow(rows[0].models[0])).toMatchObject({
            modelId: `openrouter/${variant}`,
            provider: "openrouter",
            slug: "openrouter",
            harness: "pi_core",
        })
    })

    it("does not prefix an uncataloged id twice, nor prefix one for an alias harness", () => {
        const saved = ["anthropic/my-fine-tune", "my-other-tune"]
        const rows = buildConnectionPickerRows({
            connections: [standard("1", "anthropic", {slug: "anthropic", models: saved})],
            capabilities: CAPABILITIES,
            harnessIds: HARNESS_IDS,
        })

        const spellingsFor = (harness: string) =>
            rows[0].models.filter((model) => model.harness === harness).map((m) => m.modelId)
        // Pi prefixes once, whether or not the saved id already carried the family.
        expect(spellingsFor("pi_core")).toEqual([
            "anthropic/my-fine-tune",
            "anthropic/my-other-tune",
        ])
        // Claude names bare aliases; a prefixed id would not resolve there.
        expect(spellingsFor("claude")).toEqual(["my-fine-tune", "my-other-tune"])
    })

    it("keeps the catalog intersection for a connection still on Agenta's defaults", () => {
        // No saved list means every id came FROM the catalog, so there is nothing the catalog
        // cannot spell — and nothing the user asked for that could be swallowed.
        const rows = buildConnectionPickerRows({
            connections: [standard("1", "openai")],
            capabilities: {
                pi_core: {
                    ...CAPABILITIES.pi_core,
                    default_models: {openai: ["openai/gpt-5.5", "openai/ghost-model"]},
                },
            },
            harnessIds: ["pi_core"],
        })
        expect(rows[0].models.map((model) => model.modelId)).toEqual(["openai/gpt-5.5"])
    })

    it("lists a subscription as its own row, with no slug to persist", () => {
        const rows = buildConnectionPickerRows({
            connections: [],
            capabilities: CAPABILITIES,
            harnessIds: HARNESS_IDS,
        })

        // The plan's consumer name, never "Claude subscription" — the picker's olive tag is what
        // says it is a subscription, so the name must not say it a second time.
        expect(rows.map((row) => row.name)).toEqual(["Claude"])
        const subscription = rows[0]
        expect(subscription.kind).toBe("subscription")
        expect(subscription.iconKey).toBe("anthropic")
        expect(subscription.models.every((model) => model.mode === "self_managed")).toBe(true)
        expect(subscription.models.every((model) => model.slug === null)).toBe(true)
    })

    it("identifies a subscription row by its PLAN, so two harnesses would share one row", () => {
        // The row key is the family, not the harness. That is the whole merge: a second harness
        // reaching the same plan appends its pairs to this row instead of opening a second one.
        // Unreachable through `SUBSCRIPTION_HARNESSES` today — its two entries name two different
        // families — so what is pinned here is the identity that makes the merge possible.
        const rows = buildConnectionPickerRows({
            connections: [],
            capabilities: {
                ...CAPABILITIES,
                codex: {
                    providers: ["openai"],
                    deployments: ["direct"],
                    connection_modes: ["agenta", "self_managed"],
                    model_selection: "alias",
                    models: {openai: ["gpt-5.6-sol"]},
                },
            },
            harnessIds: [...HARNESS_IDS, "codex"],
        })

        expect(rows.map((row) => [row.name, row.key])).toEqual([
            ["Claude", "subscription:anthropic"],
            ["ChatGPT", "subscription:openai"],
        ])
        // Every pair names its family; a self_managed pick without one fails server-side.
        expect(rows.every((row) => row.models.every((model) => model.provider))).toBe(true)
        // One row, one key per pair — `modelRowKey` folds the harness in, so a merged row's
        // options stay distinguishable.
        const keys = rows.flatMap((row) => row.models.map((model) => modelRowKey(row.key, model)))
        expect(new Set(keys).size).toBe(keys.length)
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

    it("hides subscription rows once the runner answered that nothing is ready", () => {
        // The regression this pins: an answered-but-empty status (every harness not_configured)
        // fell through to the static placeholder rows, so a deployment with no mounted login
        // offered "Claude" and "ChatGPT" subscription rows that could never work.
        const args = {
            connections: [standard("1", "anthropic", {slug: "anthropic"})],
            capabilities: CAPABILITIES,
            harnessIds: HARNESS_IDS,
        }

        expect(
            buildConnectionPickerRows({...args, subscriptionPairs: []}).some(
                (row) => row.kind === "subscription",
            ),
        ).toBe(false)
        // No answer at all (null) still keeps the placeholders, so the menu holds its shape
        // while the check is in flight or against an old runner.
        expect(
            buildConnectionPickerRows({...args, subscriptionPairs: null}).some(
                (row) => row.kind === "subscription",
            ),
        ).toBe(true)
    })

    it("offers the same model through a key and a subscription as separate rows", () => {
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

        // Reachable twice, and nothing on the row says which is cheaper — the rows are told apart
        // by their connection, not by a cost caption.
        const key = rows.find((row) => row.kind === "connection")!
        const subscription = rows.find((row) => row.kind === "subscription")!
        expect(key.models[0]).toMatchObject({modelId: "claude-fable-5", mode: "agenta"})
        expect(subscription.models.find((model) => model.modelId === "claude-fable-5")!.mode).toBe(
            "self_managed",
        )
    })
})

describe("selectionFromModelRow", () => {
    it("persists the row's own harness, so picking a model is what sets it", () => {
        const rows = buildConnectionPickerRows({
            connections: [
                standard("1", "anthropic", {slug: "anthropic", models: ["claude-fable-5"]}),
            ],
            capabilities: CAPABILITIES,
            harnessIds: HARNESS_IDS,
        })
        const claudeRow = rows[0].models.find((model) => model.harness === "claude")!
        expect(selectionFromModelRow(claudeRow)).toEqual({
            modelId: "claude-fable-5",
            provider: "anthropic",
            mode: "agenta",
            slug: "anthropic",
            harness: "claude",
        })
    })
})

describe("selectedModelRowKey", () => {
    const rows = () =>
        buildConnectionPickerRows({
            connections: [
                standard("1", "anthropic", {name: "A", slug: "a", models: ["claude-fable-5"]}),
                standard("2", "anthropic", {name: "B", slug: "b", models: ["claude-fable-5"]}),
            ],
            capabilities: CAPABILITIES,
            harnessIds: HARNESS_IDS,
        })

    const rowFor = (key: string | undefined) =>
        rows()
            .flatMap((row) =>
                row.models.map((model) => ({key: modelRowKey(row.key, model), model})),
            )
            .find((entry) => entry.key === key)

    it("marks the row of the exact stored connection AND harness", () => {
        const marked = rowFor(
            selectedModelRowKey(rows(), {
                modelId: "claude-fable-5",
                slug: "b",
                mode: "agenta",
                harness: "claude",
            }),
        )!
        expect(marked.model.slug).toBe("b")
        expect(marked.model.harness).toBe("claude")
    })

    it("keeps one model reachable through two connections distinguishable", () => {
        const keys = rows().flatMap((row) => row.models.map((model) => modelRowKey(row.key, model)))
        expect(new Set(keys).size).toBe(keys.length)
    })

    it("falls back to the same model elsewhere when no connection matches", () => {
        expect(
            selectedModelRowKey(rows(), {
                modelId: "claude-fable-5",
                slug: "since-renamed",
                mode: "agenta",
                harness: "claude",
            }),
        ).toBeDefined()
    })

    it("marks the subscription row for a self-managed pick", () => {
        const marked = rowFor(
            selectedModelRowKey(rows(), {
                modelId: "claude-fable-5",
                slug: null,
                mode: "self_managed",
                harness: "claude",
            }),
        )!
        expect(marked.model.mode).toBe("self_managed")
        expect(marked.model.connectionName).toBe("Claude")
    })

    it("marks nothing when no model is stored", () => {
        expect(
            selectedModelRowKey(rows(), {
                modelId: null,
                slug: null,
                mode: "agenta",
                harness: "claude",
            }),
        ).toBeUndefined()
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

/**
 * A deployment-hosted connection (bedrock/azure/vertex_ai/custom) names no provider family in its
 * kind, and its model ids often name only the model. Picking one used to leave the OUTGOING model's
 * family in place, so the run was submitted as (openrouter, bedrock) and the server rejected it:
 * "provider 'openrouter' is not supported by harness 'claude'". The family now comes from the pick.
 */
describe("a deployment-hosted connection's provider family", () => {
    /** Bedrock through Claude Code: the id names the model only, the kind names the hosting. */
    const bedrock = custom("1", "bedrock", ["claude-3-sonnet-20240229-v1:0"], {
        name: "aws-bedrock-52e8f59f0d07",
        slug: "aws-bedrock-52e8f59f0d07",
        harnesses: ["claude"],
    })

    const bedrockRow = () => {
        const rows = buildConnectionPickerRows({
            connections: [bedrock],
            capabilities: CAPABILITIES,
            harnessIds: HARNESS_IDS,
        })
        return rows.find((row) => row.key === "1")!.models[0]
    }

    it("resolves to the family the driving harness reaches, not the deployment kind", () => {
        // "bedrock" is a hosting mechanism; Claude Code reaches exactly one family, so there is
        // nothing to guess. The server accepts claude + anthropic + bedrock.
        expect(selectionFromModelRow(bedrockRow())).toEqual({
            modelId: "claude-3-sonnet-20240229-v1:0",
            provider: "anthropic",
            mode: "agenta",
            slug: "aws-bedrock-52e8f59f0d07",
            harness: "claude",
        })
    })

    it("never carries the previously selected model's family into the pick", () => {
        // The founder's repro: an OpenRouter model was selected, then the Bedrock row was picked.
        const previous = {
            model: "openrouter/some-model",
            provider: "openrouter",
            connection: {mode: "agenta", slug: "my-openrouter"},
        }
        const selection = selectionFromModelRow(bedrockRow())
        expect(
            composeModelValue({
                modelId: selection.modelId,
                provider: selection.provider,
                mode: selection.mode,
                slug: selection.slug,
                existing: previous,
            }),
        ).toEqual({
            model: "claude-3-sonnet-20240229-v1:0",
            provider: "anthropic",
            connection: {mode: "agenta", slug: "aws-bedrock-52e8f59f0d07"},
        })
    })

    it("writes no provider at all rather than a stale one when the family is undecidable", () => {
        // Same shape on Pi, which reaches several families: nothing resolves the vendor of an
        // opaque bedrock id, so the field is omitted and the vault record speaks for itself.
        const piBedrock = custom("2", "bedrock", ["some-opaque-id"], {
            name: "bedrock-pi",
            slug: "bedrock-pi",
            harnesses: ["pi_core"],
        })
        const rows = buildConnectionPickerRows({
            connections: [piBedrock],
            capabilities: CAPABILITIES,
            harnessIds: HARNESS_IDS,
        })
        const selection = selectionFromModelRow(rows.find((row) => row.key === "2")!.models[0])
        expect(selection.provider).toBeNull()
        expect(
            composeModelValue({
                modelId: selection.modelId,
                provider: selection.provider,
                mode: selection.mode,
                slug: selection.slug,
                existing: {model: "openrouter/some-model", provider: "openrouter"},
            }),
        ).not.toHaveProperty("provider")
    })
})

describe("buildConnectionPickerRows: a provisioned connection wears Agenta's mark", () => {
    // The deployment behind a provisioned connection is an implementation detail of the offer, so
    // its vendor mark would credit a vendor the user never chose. The row's NAME is untouched:
    // what the connection is called stays the record's to decide.
    const args = (connection: ProviderConnection) => ({
        connections: [connection],
        capabilities: CAPABILITIES,
        harnessIds: HARNESS_IDS,
        showSubscriptions: false,
    })

    it("keys the icon on managedBy, not on the deployment kind", () => {
        const managed = custom("m1", "bedrock", ["Agenta/custom/anthropic/claude-fable-5"], {
            name: "Agenta",
            managedBy: "starter-credits-bridge",
        })
        const [row] = buildConnectionPickerRows(args(managed))
        expect(row.iconKey).toBe("agenta")
        expect(row.name).toBe("Agenta")
    })

    it("leaves an ordinary custom connection on its own provider mark", () => {
        const own = custom("c1", "bedrock", ["my-bedrock/custom/anthropic/claude-fable-5"])
        const [row] = buildConnectionPickerRows(args(own))
        expect(row.iconKey).toBe("bedrock")
    })
})
