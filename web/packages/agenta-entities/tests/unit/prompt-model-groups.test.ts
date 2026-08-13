import {describe, expect, it} from "vitest"

import type {ProviderConnection} from "../../src/secret/core/connections"
import {
    CURRENT_SELECTION_GROUP_KEY,
    buildConnectionModelGroups,
    connectionSlugFor,
    connectionSlugFromOption,
    curatedModelName,
    selectedOptionKey,
    selectedOptionLabel,
    withCurrentSelectionGroup,
    withoutSlugBoundGroups,
} from "../../src/secret/core/promptModelGroups"
import {SecretKind} from "../../src/secret/core/types"

const CATALOG = {
    openai: ["gpt-4o", "gpt-4o-mini"],
    anthropic: ["anthropic/claude-haiku-4-5"],
}

const standard = (overrides: Partial<ProviderConnection> = {}): ProviderConnection => ({
    id: "conn-1",
    slug: "openai",
    name: "OpenAI",
    kind: "openai",
    title: "OpenAI",
    secretKind: SecretKind.ProviderKey,
    source: {},
    ...overrides,
})

const custom = (overrides: Partial<ProviderConnection> = {}): ProviderConnection => ({
    id: "conn-c",
    slug: "my-gw",
    name: "My gateway",
    kind: "custom",
    title: "OpenAI-compatible endpoint",
    secretKind: SecretKind.CustomProvider,
    models: ["gpt-4o-mini"],
    source: {modelKeys: ["my-gw/custom/gpt-4o-mini"]},
    ...overrides,
})

// The curated catalog the agent picker labels its rows from, as two harnesses spelling the same
// models differently — Pi prefixes the family, Codex does not.
const CAPS = {
    pi: {
        providers: ["openai", "anthropic"],
        models: {openai: ["openai/gpt-5.6-luna"], anthropic: ["anthropic/claude-haiku-4-5"]},
        model_catalog: [
            {id: "openai/gpt-5.6-luna", provider: "openai", label: "GPT-5.6 Luna"},
            {id: "anthropic/claude-haiku-4-5", provider: "anthropic", name: "Claude Haiku 4.5"},
            {id: "openai/twin-id", provider: "openai", label: "An OpenAI model"},
        ],
    },
    codex: {
        providers: ["openai"],
        models: {openai: ["gpt-5.6-luna"]},
        model_catalog: [{id: "gpt-5.6-luna", provider: "openai", label: "GPT-5.6 Luna"}],
    },
}

describe("curatedModelName", () => {
    it("reads the curated label, across the family prefix the harness happens to use", () => {
        expect(curatedModelName(CAPS, "openai", "gpt-5.6-luna")).toBe("GPT-5.6 Luna")
        expect(curatedModelName(CAPS, "openai", "openai/gpt-5.6-luna")).toBe("GPT-5.6 Luna")
    })

    it("falls back to the objective name when the catalog curates no label", () => {
        expect(curatedModelName(CAPS, "anthropic", "claude-haiku-4-5")).toBe("Claude Haiku 4.5")
    })

    it("never names a model from another family's entry with the same id", () => {
        expect(curatedModelName(CAPS, "anthropic", "twin-id")).toBeNull()
    })

    it("names nothing without a catalog, or for a model it does not list", () => {
        expect(curatedModelName(null, "openai", "gpt-5.6-luna")).toBeNull()
        expect(curatedModelName(CAPS, "openai", "gpt-4o-mini")).toBeNull()
    })
})

describe("connectionSlugFor", () => {
    it("uses the stable slug when the record has one", () => {
        expect(connectionSlugFor(standard({slug: "openai-2"}))).toBe("openai-2")
    })

    it("falls back to the provider family for a standard record that predates slugs", () => {
        expect(connectionSlugFor(standard({slug: undefined}))).toBe("openai")
    })

    it("falls back to the stored header name for a custom record that predates slugs", () => {
        // The API mirrors header.name into `data.provider_slug`, which is what the SDK matches.
        expect(
            connectionSlugFor(custom({slug: undefined, source: {displayName: "My gateway"}})),
        ).toBe("My gateway")
    })

    it("uses the vault kind, never the display name, for a renamed standard connection", () => {
        // `name` becomes the user's own words after a rename ("Prod key"), which is not a family.
        const renamed = standard({slug: undefined, name: "Prod key"})
        expect(connectionSlugFor(renamed)).toBe("openai")
    })

    it("has no identity for a custom record with neither a slug nor a stored name", () => {
        expect(
            connectionSlugFor(
                custom({slug: undefined, name: "OpenAI-compatible endpoint", source: {}}),
            ),
        ).toBeNull()
    })
})

describe("buildConnectionModelGroups", () => {
    it("groups a lone standard connection that saved no model list", () => {
        const groups = buildConnectionModelGroups({
            connections: [standard()],
            catalog: CATALOG,
        })

        // Skipping it as a catalog duplicate left a connected provider looking exactly like one
        // with no key at all. The catalog group for the family drops out instead.
        expect(groups.map((group) => group.label)).toEqual(["OpenAI"])
        expect(groups[0].options.map((option) => option.value)).toEqual(["gpt-4o", "gpt-4o-mini"])
    })

    it("labels a model with its curated name, keeping the id as the persisted value", () => {
        const groups = buildConnectionModelGroups({
            connections: [standard({models: ["gpt-5.6-luna"]})],
            capabilities: CAPS,
        })

        expect(groups[0].options).toMatchObject([{label: "GPT-5.6 Luna", value: "gpt-5.6-luna"}])
        // Nothing marks this one, so it carries no aside for the picker to grey out.
        expect(groups[0].options[0].hint).toBeUndefined()
    })

    it("splits the catalog's aside off the label, so the picker can quieten it", () => {
        const marked = {
            codex: {
                providers: ["openai"],
                models: {openai: ["gpt-5.6-sol"]},
                model_catalog: [{id: "gpt-5.6-sol", provider: "openai", label: "Sol (default)"}],
            },
        }
        const groups = buildConnectionModelGroups({
            connections: [standard({models: ["gpt-5.6-sol"]})],
            capabilities: marked,
        })

        expect(groups[0].options).toMatchObject([
            {label: "Sol", hint: "(default)", value: "gpt-5.6-sol"},
        ])
    })

    it("leaves a hand-added model's own parentheses alone — an id is not a curated label", () => {
        const groups = buildConnectionModelGroups({
            connections: [standard({models: ["my-model (beta)"]})],
            capabilities: CAPS,
        })

        expect(groups[0].options[0].label).toBe("my-model (beta)")
        expect(groups[0].options[0].hint).toBeUndefined()
    })

    it("labels a translated model too, matching on the id the connection stored", () => {
        const groups = buildConnectionModelGroups({
            connections: [
                standard({
                    id: "a",
                    slug: "anthropic-1",
                    kind: "anthropic",
                    models: ["claude-haiku-4-5"],
                }),
            ],
            capabilities: CAPS,
        })

        expect(groups[0].options).toMatchObject([
            {label: "Claude Haiku 4.5", value: "anthropic/claude-haiku-4-5"},
        ])
    })

    it("shows a manually added model exactly as it was stored", () => {
        // Nothing curates a hand-typed id, and inventing a prettier spelling for it would stop it
        // matching what the user knows they configured.
        const groups = buildConnectionModelGroups({
            connections: [standard({models: ["gpt-4o-mini", "my-fine-tune-v3"]})],
            capabilities: CAPS,
        })

        expect(groups[0].options.map((option) => option.label)).toEqual([
            "gpt-4o-mini",
            "my-fine-tune-v3",
        ])
    })

    it("leaves a custom gateway's model keys alone even when the catalog names one", () => {
        const groups = buildConnectionModelGroups({
            connections: [custom({source: {modelKeys: ["my-gw/custom/gpt-5.6-luna"]}})],
            capabilities: CAPS,
        })

        expect(groups[0].options).toMatchObject([
            {label: "my-gw/custom/gpt-5.6-luna", value: "my-gw/custom/gpt-5.6-luna"},
        ])
    })

    it("keys a group by the connection record, not its display name", () => {
        // Two connections of one provider share a display name, and a connection named after its
        // family collides with the catalog group — the picker hovers and selects by this key.
        const groups = buildConnectionModelGroups({
            connections: [
                standard({id: "a", slug: "openai", name: "OpenAI"}),
                standard({id: "b", slug: "openai-2", name: "OpenAI"}),
            ],
            catalog: CATALOG,
        })

        expect(groups.map((group) => group.key)).toEqual(["a", "b"])
    })

    it("captions a connection group with nothing — every group in the menu is connected", () => {
        // A "Connected" caption under every provider name says only what the connected-only menu
        // already says. The one caption left is the merged-in current selection's, which is the
        // row that is NOT connected.
        const groups = buildConnectionModelGroups({connections: [standard()], catalog: CATALOG})

        expect(groups[0].caption).toBeUndefined()
    })

    it("offers a saved model as a litellm id, not the provider spelling it was saved as", () => {
        // A connection saves the provider's own id so it resolves in every harness; the prompt
        // runtime is litellm. The value persists litellm's spelling and the label keeps the
        // provider's, so one model reads and persists identically wherever it was picked from.
        const groups = buildConnectionModelGroups({
            connections: [
                standard({
                    id: "a",
                    slug: "anthropic-1",
                    kind: "anthropic",
                    name: "Anthropic",
                    models: ["claude-haiku-4-5"],
                }),
            ],
            catalog: CATALOG,
        })

        expect(groups[0].options).toMatchObject([
            {value: "anthropic/claude-haiku-4-5", label: "claude-haiku-4-5"},
        ])
    })

    it("translates a saved model the catalog never listed, so new ids still resolve", () => {
        // The gap this closes: matching against the catalog could only spell ids the catalog
        // already knew, so a freshly discovered or hand-added model persisted bare and died.
        const groups = buildConnectionModelGroups({
            connections: [
                standard({
                    id: "a",
                    slug: "anthropic-1",
                    kind: "anthropic",
                    models: ["claude-unreleased-9"],
                }),
            ],
            catalog: CATALOG,
        })

        expect(groups[0].options.map((option) => option.value)).toEqual([
            "anthropic/claude-unreleased-9",
        ])
    })

    it("spells each family the way litellm does, including the two that disagree", () => {
        const groups = buildConnectionModelGroups({
            connections: [
                standard({id: "p", slug: "pplx", kind: "perplexityai", models: ["sonar-pro"]}),
                standard({id: "o", slug: "oai", kind: "openai", models: ["gpt-4o-mini"]}),
                standard({
                    id: "r",
                    slug: "or",
                    kind: "openrouter",
                    models: ["anthropic/claude-opus-4.8"],
                }),
            ],
        })

        expect(groups.flatMap((group) => group.options)).toMatchObject([
            // The vault kind is `perplexityai`; litellm's family is `perplexity`.
            {value: "perplexity/sonar-pro", label: "sonar-pro"},
            // Bare IS litellm's OpenAI spelling.
            {value: "gpt-4o-mini", label: "gpt-4o-mini"},
            // The vendor segment is part of the model id, not a prefix to collapse.
            {
                value: "openrouter/anthropic/claude-opus-4.8",
                label: "anthropic/claude-opus-4.8",
            },
        ])
    })

    it("does not re-prefix a saved id that already carries its family", () => {
        const groups = buildConnectionModelGroups({
            connections: [
                standard({
                    id: "a",
                    slug: "anthropic-1",
                    kind: "anthropic",
                    models: ["anthropic/claude-haiku-4-5"],
                }),
            ],
        })

        expect(groups[0].options.map((option) => option.value)).toEqual([
            "anthropic/claude-haiku-4-5",
        ])
    })

    it("translates catalog-supplied models too, so both sources persist one spelling", () => {
        const groups = buildConnectionModelGroups({
            connections: [standard({id: "a", slug: "anthropic-1", kind: "anthropic"})],
            catalog: {anthropic: ["claude-haiku-4-5"]},
        })

        expect(groups[0].options).toMatchObject([
            {value: "anthropic/claude-haiku-4-5", label: "claude-haiku-4-5"},
        ])
    })

    it("gives two connections of one provider a group each, from the catalog defaults", () => {
        const groups = buildConnectionModelGroups({
            connections: [
                standard({id: "a", slug: "openai", name: "OpenAI"}),
                standard({id: "b", slug: "openai-2", name: "OpenAI 2"}),
            ],
            catalog: CATALOG,
        })

        expect(groups.map((group) => group.label)).toEqual(["OpenAI", "OpenAI 2"])
        expect(groups[0].options.map((option) => option.value)).toEqual(["gpt-4o", "gpt-4o-mini"])
        expect(groups[1].options[0].metadata).toEqual({
            connectionSlug: "openai-2",
            provider: "openai",
            requiresConnectionSlug: true,
        })
    })

    it("offers a saved model list instead of the catalog, even for a lone connection", () => {
        const groups = buildConnectionModelGroups({
            connections: [standard({models: ["gpt-4o-mini"]})],
            catalog: CATALOG,
        })

        expect(groups).toHaveLength(1)
        expect(groups[0].options.map((option) => option.value)).toEqual(["gpt-4o-mini"])
    })

    it("offers nothing for a connection that saved an empty list", () => {
        const groups = buildConnectionModelGroups({
            connections: [standard({models: []}), standard({id: "b", slug: "openai-2"})],
            catalog: CATALOG,
        })

        expect(groups.map((group) => group.label)).toEqual(["OpenAI"])
        expect(groups[0].options).toHaveLength(2)
    })

    it("persists no slug for a connection with no stable identity, keeping family fallback", () => {
        const groups = buildConnectionModelGroups({
            connections: [custom({id: "c1", slug: undefined, source: {modelKeys: ["a/custom/m"]}})],
            catalog: CATALOG,
        })

        expect(groups[0].options[0].metadata).toEqual({provider: "custom"})
    })

    it("keeps a custom connection's stored model keys, which the resolver rewrites", () => {
        const groups = buildConnectionModelGroups({connections: [custom()], catalog: CATALOG})

        expect(groups).toEqual([
            {
                key: "conn-c",
                label: "My gateway",
                iconKey: "custom",
                options: [
                    {
                        label: "my-gw/custom/gpt-4o-mini",
                        value: "my-gw/custom/gpt-4o-mini",
                        key: "my-gw:my-gw/custom/gpt-4o-mini",
                        metadata: {connectionSlug: "my-gw", provider: "custom"},
                    },
                ],
            },
        ])
    })

    it("leaves every custom provider's model keys byte-identical to what it stored", () => {
        // The guarantee for azure/bedrock/sagemaker/vertex_ai/custom: their keys name the
        // connection and the resolver rewrites them itself, so translation must never touch them.
        const kinds = ["azure", "bedrock", "sagemaker", "vertex_ai", "custom"]
        const modelKeys = kinds.map((kind) => `gw-${kind}/${kind}/claude-haiku-4-5`)

        const groups = buildConnectionModelGroups({
            connections: kinds.map((kind, index) =>
                custom({
                    id: `c-${kind}`,
                    slug: `gw-${kind}`,
                    kind,
                    source: {modelKeys: [modelKeys[index]]},
                }),
            ),
            catalog: CATALOG,
        })

        expect(groups.flatMap((group) => group.options.map((option) => option.value))).toEqual(
            modelKeys,
        )
        expect(groups.flatMap((group) => group.options.map((option) => option.label))).toEqual(
            modelKeys,
        )
    })

    it("does not prefix a custom connection's bare model key either", () => {
        // A record that predates model keys stores bare slugs; a standard family's rules would
        // rewrite them into something the gateway never heard of.
        const groups = buildConnectionModelGroups({
            connections: [custom({kind: "azure", models: ["claude-haiku-4-5"], source: {}})],
        })

        expect(groups[0].options.map((option) => option.value)).toEqual(["claude-haiku-4-5"])
    })

    it("gives options unique keys when two connections offer the same model", () => {
        const groups = buildConnectionModelGroups({
            connections: [
                standard({id: "a", slug: "openai", models: ["gpt-4o-mini"]}),
                standard({id: "b", slug: "openai-2", models: ["gpt-4o-mini"]}),
            ],
            catalog: CATALOG,
        })

        const keys = groups.flatMap((group) => group.options.map((option) => option.key))
        expect(new Set(keys).size).toBe(keys.length)
    })

    it("offers nothing for a provider the catalog does not cover", () => {
        const groups = buildConnectionModelGroups({
            connections: [
                standard({id: "a", slug: "groq", kind: "groq", name: "Groq"}),
                standard({id: "b", slug: "groq-2", kind: "groq", name: "Groq 2"}),
            ],
            catalog: CATALOG,
        })

        expect(groups).toEqual([])
    })

    it("works with no catalog at all, offering only what connections saved", () => {
        const groups = buildConnectionModelGroups({
            connections: [standard(), custom()],
        })

        expect(groups.map((group) => group.label)).toEqual(["My gateway"])
    })
})

describe("withoutSlugBoundGroups", () => {
    const groupsFor = (connections: ProviderConnection[]) =>
        buildConnectionModelGroups({connections, catalog: CATALOG})

    it("drops standard-connection groups, which a model-only control cannot bind", () => {
        // A control that writes just the model (GroupedChoiceControl) would store "gpt-4o-mini"
        // with no slug, running on whichever OpenAI key the family fallback reaches first.
        const groups = groupsFor([
            standard({id: "a", slug: "openai", name: "OpenAI"}),
            standard({id: "b", slug: "openai-2", name: "OpenAI 2"}),
        ])

        expect(groups).toHaveLength(2)
        expect(withoutSlugBoundGroups(groups)).toEqual([])
    })

    it("drops a standard connection's saved model list too", () => {
        const groups = groupsFor([standard({models: ["gpt-4o-mini"]})])

        expect(groups).toHaveLength(1)
        expect(withoutSlugBoundGroups(groups)).toEqual([])
    })

    it("keeps custom-provider groups, whose model keys name the connection", () => {
        const groups = groupsFor([
            custom(),
            standard({id: "b", slug: "openai-2", models: ["gpt-4o"]}),
        ])

        expect(withoutSlugBoundGroups(groups).map((group) => group.label)).toEqual(["My gateway"])
    })

    it("drops a standard group from a record that predates slugs, which binds by family", () => {
        const groups = groupsFor([standard({slug: undefined, models: ["gpt-4o-mini"]})])

        expect(withoutSlugBoundGroups(groups)).toEqual([])
    })

    it("keeps a group with no stable identity at all — there is nothing to bind", () => {
        const groups = groupsFor([custom({slug: undefined, source: {modelKeys: ["a/custom/m"]}})])

        expect(withoutSlugBoundGroups(groups)).toEqual(groups)
    })
})

describe("gateway variant ids (vendor/model:variant)", () => {
    // OpenRouter exposes routing variants as a `:suffix` on the model id. No catalog lists them,
    // so every surface has to carry an id it has never heard of, exactly as the user typed it.
    const NITRO = "deepseek/deepseek-v4-flash:nitro"

    const openRouter = (models: string[]) =>
        standard({id: "or", slug: "openrouter", kind: "openrouter", name: "OpenRouter", models})

    it("offers a hand-added variant id, prefixed exactly once and labeled as stored", () => {
        const groups = buildConnectionModelGroups({
            connections: [openRouter(["deepseek/deepseek-v4-flash", NITRO])],
            capabilities: CAPS,
        })

        expect(groups[0].options).toMatchObject([
            {value: "openrouter/deepseek/deepseek-v4-flash", label: "deepseek/deepseek-v4-flash"},
            {value: `openrouter/${NITRO}`, label: NITRO},
        ])
    })

    it("does not re-prefix a variant id that already carries its family", () => {
        const groups = buildConnectionModelGroups({
            connections: [openRouter([`openrouter/${NITRO}`])],
        })

        expect(groups[0].options[0].value).toBe(`openrouter/${NITRO}`)
    })

    it("never labels a variant with the base model's curated name", () => {
        // `:nitro` is a different route with different economics; borrowing the base model's
        // curated label would name it as something it is not.
        const caps = {
            pi: {
                providers: ["openrouter"],
                models: {openrouter: ["openrouter/deepseek/deepseek-v4-flash"]},
                model_catalog: [
                    {
                        id: "openrouter/deepseek/deepseek-v4-flash",
                        provider: "openrouter",
                        label: "DeepSeek V4 Flash",
                    },
                ],
            },
        }

        expect(curatedModelName(caps, "openrouter", NITRO)).toBeNull()
        expect(curatedModelName(caps, "openrouter", "deepseek/deepseek-v4-flash")).toBe(
            "DeepSeek V4 Flash",
        )

        const groups = buildConnectionModelGroups({
            connections: [openRouter([NITRO])],
            capabilities: caps,
        })
        expect(groups[0].options[0].label).toBe(NITRO)
    })

    it("highlights the variant from either stored spelling", () => {
        const groups = buildConnectionModelGroups({connections: [openRouter([NITRO])]})
        const key = `openrouter:openrouter/${NITRO}`

        // Written by today's picker (litellm-spelled), and by anything older (bare).
        expect(selectedOptionKey({groups, model: `openrouter/${NITRO}`})).toBe(key)
        expect(selectedOptionKey({groups, model: NITRO})).toBe(key)
    })

    it("does not confuse the variant with the base model it is derived from", () => {
        const groups = buildConnectionModelGroups({
            connections: [openRouter(["deepseek/deepseek-v4-flash", NITRO])],
        })

        expect(selectedOptionKey({groups, model: NITRO})).toBe(`openrouter:openrouter/${NITRO}`)
        expect(selectedOptionKey({groups, model: "deepseek/deepseek-v4-flash"})).toBe(
            "openrouter:openrouter/deepseek/deepseek-v4-flash",
        )
    })

    it("keeps the variant visible as the current selection when the connection is gone", () => {
        const orphan = withCurrentSelectionGroup({groups: [], model: `openrouter/${NITRO}`})

        expect(orphan[0].options[0].label).toBe(`openrouter/${NITRO}`)
    })
})

describe("one model list per connection", () => {
    // The founder's bug: Settings called his OpenAI connection "Defaults" (3 models) and the agent
    // picker offered 3, while this picker offered 40 — because the no-saved-list fallback read the
    // prompt schema's `choices` instead of the effective set every other surface reads.
    const CAPS_WITH_DEFAULTS = {
        pi_core: {
            providers: ["openai"],
            models: {openai: ["openai/gpt-5.6-sol", "openai/gpt-5.6-luna", "openai/gpt-4o-mini"]},
            default_models: {openai: ["openai/gpt-5.6-sol", "openai/gpt-5.6-luna"]},
        },
        // A second harness reaching the same family must not double anything up.
        pi_agenta: {
            providers: ["openai"],
            models: {openai: ["openai/gpt-5.6-sol", "openai/gpt-5.6-luna", "openai/gpt-4o-mini"]},
            default_models: {openai: ["openai/gpt-5.6-sol"]},
        },
    }

    const BIG_SCHEMA_CATALOG = {
        openai: Array.from({length: 40}, (_, index) => `schema-model-${index}`),
    }

    const offered = (args: Parameters<typeof buildConnectionModelGroups>[0]) =>
        buildConnectionModelGroups(args)[0]?.options.map((option) => option.value) ?? []

    it("offers the effective default set, not the prompt schema's catalog", () => {
        expect(
            offered({
                connections: [standard({models: undefined})],
                catalog: BIG_SCHEMA_CATALOG,
                capabilities: CAPS_WITH_DEFAULTS,
            }),
        ).toEqual(["gpt-5.6-sol", "gpt-5.6-luna"])
    })

    it("offers everything the family publishes when it declares no defaults", () => {
        const caps = {
            pi_core: {
                providers: ["openai"],
                models: {openai: ["openai/gpt-5.6-sol", "openai/gpt-4o-mini"]},
            },
        }

        expect(
            offered({
                connections: [standard({models: undefined})],
                catalog: BIG_SCHEMA_CATALOG,
                capabilities: caps,
            }),
        ).toEqual(["gpt-5.6-sol", "gpt-4o-mini"])
    })

    it("still prefers the connection's own saved list over the defaults", () => {
        expect(
            offered({
                connections: [standard({models: ["gpt-4o-mini"]})],
                catalog: BIG_SCHEMA_CATALOG,
                capabilities: CAPS_WITH_DEFAULTS,
            }),
        ).toEqual(["gpt-4o-mini"])
    })

    it("falls back to the schema catalog only when no harness catalog is in hand", () => {
        // An older backend, or a first paint before the catalog resolves: a populated menu beats
        // an empty one, and it self-corrects once the catalog lands.
        expect(offered({connections: [standard({models: undefined})], catalog: CATALOG})).toEqual([
            "gpt-4o",
            "gpt-4o-mini",
        ])
    })

    it("recomputes from the record, so a saved edit shows up on the next read", () => {
        // The builder holds no cache of its own: both surfaces read one refetched vault record,
        // so a save cannot leave this picker on the pre-edit list.
        const args = {catalog: BIG_SCHEMA_CATALOG, capabilities: CAPS_WITH_DEFAULTS}
        const before = offered({connections: [standard({models: undefined})], ...args})
        const after = offered({connections: [standard({models: ["gpt-4o-mini"]})], ...args})

        expect(before).toEqual(["gpt-5.6-sol", "gpt-5.6-luna"])
        expect(after).toEqual(["gpt-4o-mini"])
    })
})

describe("connected-only menu", () => {
    // The prompt picker offers `buildConnectionModelGroups` and nothing else — the schema's static
    // catalog groups no longer join them. What the catalog still does is supply the model list for
    // a connection that saved none of its own.
    const menuFor = (connections: ProviderConnection[]) =>
        buildConnectionModelGroups({connections, catalog: CATALOG})

    it("offers no group for a family the project holds no connection for", () => {
        // Anthropic is in the catalog; without a connection it is not offered, because picking it
        // could only fail at run time for want of a credential.
        const groups = menuFor([standard()])

        expect(groups.map((group) => group.label)).toEqual(["OpenAI"])
        expect(groups.flatMap((group) => group.options.map((option) => option.value))).toEqual([
            "gpt-4o",
            "gpt-4o-mini",
        ])
    })

    it("offers nothing at all when the project has no connections", () => {
        expect(menuFor([])).toEqual([])
    })

    it("offers a custom gateway's models without pulling the catalog's families in", () => {
        expect(menuFor([custom()]).map((group) => group.label)).toEqual(["My gateway"])
    })
})

describe("withCurrentSelectionGroup", () => {
    const openAIGroups = () =>
        buildConnectionModelGroups({connections: [standard()], catalog: CATALOG})

    const labelsOf = (groups: {label?: string}[]) => groups.map((group) => group.label)

    it("merges a stored model no connection offers, so the selection stays on screen", () => {
        const groups = withCurrentSelectionGroup({
            groups: openAIGroups(),
            model: "anthropic/claude-haiku-4-5",
        })

        expect(labelsOf(groups)).toEqual(["OpenAI", "Current selection"])
        expect(groups[1].options).toEqual([
            {
                label: "anthropic/claude-haiku-4-5",
                value: "anthropic/claude-haiku-4-5",
                key: `${CURRENT_SELECTION_GROUP_KEY}:anthropic/claude-haiku-4-5`,
                caption: "Not connected",
                metadata: {},
            },
        ])
    })

    it("marks the merged group as coming from no connection", () => {
        const [, orphan] = withCurrentSelectionGroup({groups: openAIGroups(), model: "claude-x"})

        expect(orphan.caption).toBe("Not offered by a connected provider")
        // Its own key, so the picker's hover/selection never confuses it with a connection.
        expect(orphan.key).toBe(CURRENT_SELECTION_GROUP_KEY)
    })

    it("merges nothing when a connection already offers the model", () => {
        expect(
            labelsOf(withCurrentSelectionGroup({groups: openAIGroups(), model: "gpt-4o-mini"})),
        ).toEqual(["OpenAI"])
    })

    it("merges nothing for a config stored in the provider's own spelling", () => {
        // The offered option is `anthropic/claude-haiku-4-5`; the config predates translation.
        const groups = buildConnectionModelGroups({
            connections: [
                standard({
                    id: "a",
                    slug: "anthropic-1",
                    kind: "anthropic",
                    models: ["claude-haiku-4-5"],
                }),
            ],
        })

        expect(withCurrentSelectionGroup({groups, model: "claude-haiku-4-5"})).toEqual(groups)
    })

    it("merges nothing when there is no stored model", () => {
        expect(withCurrentSelectionGroup({groups: openAIGroups(), model: null})).toEqual(
            openAIGroups(),
        )
    })

    it("leaves an empty menu empty when nothing is stored either", () => {
        // Both halves empty is what the popover reads as "nothing connected", where it shows the
        // set-up affordance instead of a picker.
        expect(withCurrentSelectionGroup({groups: [], model: undefined})).toEqual([])
    })

    it("is the whole menu for a stored model with no connections at all", () => {
        const groups = withCurrentSelectionGroup({groups: [], model: "gpt-4o-mini"})

        expect(labelsOf(groups)).toEqual(["Current selection"])
        expect(groups[0].options[0].value).toBe("gpt-4o-mini")
    })

    it("keeps the stored slug, so re-picking the row rewrites the pair it came from", () => {
        const [orphan] = withCurrentSelectionGroup({
            groups: [],
            model: "gpt-4o-mini",
            connectionSlug: "openai-gone",
        })

        expect(orphan.options[0].metadata).toEqual({connectionSlug: "openai-gone"})
    })

    it("merges nothing when the stored slug names a connection offering the model", () => {
        const groups = buildConnectionModelGroups({
            connections: [
                standard({id: "a", slug: "openai", models: ["gpt-4o-mini"]}),
                standard({id: "b", slug: "openai-2", models: ["gpt-4o-mini"]}),
            ],
            catalog: CATALOG,
        })

        expect(
            withCurrentSelectionGroup({groups, model: "gpt-4o-mini", connectionSlug: "openai-2"}),
        ).toEqual(groups)
    })

    it("hands the merged row to selectedOptionKey, so it reads as the selected one", () => {
        const groups = withCurrentSelectionGroup({groups: openAIGroups(), model: "claude-x"})

        expect(selectedOptionKey({groups, model: "claude-x"})).toBe(
            `${CURRENT_SELECTION_GROUP_KEY}:claude-x`,
        )
    })

    it("drops the merged row once the user picks a connected model instead", () => {
        // What the next open computes from the newly stored pair: the connection claims it, so
        // there is nothing left to merge.
        const groups = withCurrentSelectionGroup({
            groups: openAIGroups(),
            model: "gpt-4o",
            connectionSlug: "openai",
        })

        expect(labelsOf(groups)).toEqual(["OpenAI"])
        expect(selectedOptionKey({groups, model: "gpt-4o", connectionSlug: "openai"})).toBe(
            "openai:gpt-4o",
        )
    })
})

describe("selectedOptionKey", () => {
    const twoOpenAIKeys = () =>
        buildConnectionModelGroups({
            connections: [
                standard({id: "a", slug: "openai", name: "OpenAI", models: ["gpt-4o-mini"]}),
                standard({id: "b", slug: "openai-2", name: "OpenAI 2", models: ["gpt-4o-mini"]}),
            ],
            catalog: CATALOG,
        })

    it("names one option when two connections offer the same model", () => {
        const groups = twoOpenAIKeys()

        expect(selectedOptionKey({groups, model: "gpt-4o-mini", connectionSlug: "openai-2"})).toBe(
            "openai-2:gpt-4o-mini",
        )
    })

    it("resolves a stored model with no slug, as long as one group offers it", () => {
        // Everything written before connections stored a bare model id.
        const groups = buildConnectionModelGroups({
            connections: [standard({models: ["gpt-4o-mini"]})],
            catalog: CATALOG,
        })

        expect(selectedOptionKey({groups, model: "gpt-4o-mini"})).toBe("openai:gpt-4o-mini")
    })

    it("still names exactly one option when the stored slug matches none of them", () => {
        // A renamed or deleted connection: one row selected beats none.
        const keys = twoOpenAIKeys().flatMap((group) => group.options.map((option) => option.key))
        const picked = selectedOptionKey({
            groups: twoOpenAIKeys(),
            model: "gpt-4o-mini",
            connectionSlug: "openai-gone",
        })

        expect(keys).toContain(picked)
    })

    it("reads nothing from a model no group offers, or from no model at all", () => {
        expect(selectedOptionKey({groups: twoOpenAIKeys(), model: "gpt-4o"})).toBeNull()
        expect(selectedOptionKey({groups: twoOpenAIKeys(), model: undefined})).toBeNull()
    })

    it("falls back to the value for a static catalog option, which carries no key", () => {
        const staticGroups = [{options: [{value: "gpt-4o"}, {value: "gpt-4o-mini"}]}]

        expect(selectedOptionKey({groups: staticGroups, model: "gpt-4o"})).toBe("gpt-4o")
    })

    const anthropicGroups = () =>
        buildConnectionModelGroups({
            connections: [
                standard({
                    id: "a",
                    slug: "anthropic-1",
                    kind: "anthropic",
                    models: ["claude-haiku-4-5"],
                }),
            ],
        })

    it("highlights a config stored with the provider's spelling against a litellm option", () => {
        // Configs written before pick-time translation hold the bare id.
        expect(selectedOptionKey({groups: anthropicGroups(), model: "claude-haiku-4-5"})).toBe(
            "anthropic-1:anthropic/claude-haiku-4-5",
        )
    })

    it("highlights a litellm config against an option still spelled bare", () => {
        // The reverse direction: a group built without translation (a caller's own option list).
        const groups = [
            {
                options: [
                    {
                        value: "claude-haiku-4-5",
                        key: "anthropic-1:claude-haiku-4-5",
                        metadata: {connectionSlug: "anthropic-1", provider: "anthropic"},
                    },
                ],
            },
        ]

        expect(selectedOptionKey({groups, model: "anthropic/claude-haiku-4-5"})).toBe(
            "anthropic-1:claude-haiku-4-5",
        )
    })

    it("matches a stored litellm id against the option that now carries it", () => {
        expect(
            selectedOptionKey({groups: anthropicGroups(), model: "anthropic/claude-haiku-4-5"}),
        ).toBe("anthropic-1:anthropic/claude-haiku-4-5")
    })

    it("still lets the stored slug break a tie between spellings", () => {
        const groups = buildConnectionModelGroups({
            connections: [
                standard({id: "a", slug: "anthropic-1", kind: "anthropic", models: ["claude-x"]}),
                standard({
                    id: "b",
                    slug: "anthropic-2",
                    kind: "anthropic",
                    models: ["anthropic/claude-x"],
                }),
            ],
        })

        expect(selectedOptionKey({groups, model: "claude-x", connectionSlug: "anthropic-2"})).toBe(
            "anthropic-2:anthropic/claude-x",
        )
    })

    it("never normalizes a custom provider's model key into a match", () => {
        const groups = buildConnectionModelGroups({
            connections: [custom({kind: "azure", source: {modelKeys: ["gw/azure/claude-x"]}})],
        })

        expect(selectedOptionKey({groups, model: "gw/azure/claude-x"})).toBe(
            "my-gw:gw/azure/claude-x",
        )
        expect(selectedOptionKey({groups, model: "claude-x"})).toBeNull()
        expect(selectedOptionKey({groups, model: "azure/gw/azure/claude-x"})).toBeNull()
    })
})

describe("selectedOptionLabel", () => {
    // The closed trigger must read exactly like the open menu. It used to print the stored id, so
    // a picker row saying "DeepSeek: DeepSeek V4 Flash" sat under a trigger saying
    // "openrouter/deepseek/deepseek-v4-flash".
    const caps = {
        pi: {
            providers: ["openai", "openrouter"],
            models: {openai: ["openai/gpt-5.6-luna"]},
            model_catalog: [
                {id: "openai/gpt-5.6-luna", provider: "openai", label: "GPT-5.6 Luna"},
                {
                    id: "openrouter/deepseek/deepseek-v4-flash",
                    provider: "openrouter",
                    label: "DeepSeek: DeepSeek V4 Flash",
                },
            ],
        },
    }

    it("names a catalogued model the way the menu does", () => {
        const groups = buildConnectionModelGroups({
            connections: [standard({models: ["gpt-5.6-luna"]})],
            capabilities: caps,
        })

        expect(selectedOptionLabel({groups, model: "gpt-5.6-luna"})).toBe("GPT-5.6 Luna")
    })

    it("names a litellm-prefixed stored id by its curated name, not its slug", () => {
        const groups = buildConnectionModelGroups({
            connections: [
                standard({
                    id: "or",
                    slug: "openrouter",
                    kind: "openrouter",
                    models: ["deepseek/deepseek-v4-flash"],
                }),
            ],
            capabilities: caps,
        })

        expect(selectedOptionLabel({groups, model: "openrouter/deepseek/deepseek-v4-flash"})).toBe(
            "DeepSeek: DeepSeek V4 Flash",
        )
    })

    it("gives a manually added id back exactly as typed", () => {
        const groups = buildConnectionModelGroups({
            connections: [standard({models: ["my-fine-tune-v3"]})],
            capabilities: caps,
        })

        expect(selectedOptionLabel({groups, model: "my-fine-tune-v3"})).toBe("my-fine-tune-v3")
    })

    it("names the merged-in current selection with its stored id", () => {
        const groups = withCurrentSelectionGroup({
            groups: buildConnectionModelGroups({connections: [standard()], catalog: CATALOG}),
            model: "legacy/model-nobody-offers",
        })

        expect(selectedOptionLabel({groups, model: "legacy/model-nobody-offers"})).toBe(
            "legacy/model-nobody-offers",
        )
    })

    it("names nothing when no group offers the model, so the caller prints the id", () => {
        const groups = buildConnectionModelGroups({connections: [standard()], catalog: CATALOG})

        expect(selectedOptionLabel({groups, model: "legacy/model-nobody-offers"})).toBeNull()
        expect(selectedOptionLabel({groups, model: null})).toBeNull()
    })

    it("picks the label off the connection the stored slug names", () => {
        const groups = buildConnectionModelGroups({
            connections: [
                standard({id: "a", slug: "openai", name: "OpenAI", models: ["gpt-5.6-luna"]}),
                standard({id: "b", slug: "openai-2", name: "OpenAI 2", models: ["gpt-5.6-luna"]}),
            ],
            capabilities: caps,
        })

        expect(
            selectedOptionLabel({groups, model: "gpt-5.6-luna", connectionSlug: "openai-2"}),
        ).toBe("GPT-5.6 Luna")
    })
})

describe("connectionSlugFromOption", () => {
    it("reads the slug a connection group stamped", () => {
        expect(connectionSlugFromOption({connectionSlug: "openai-2"})).toBe("openai-2")
    })

    it("reads null from a static catalog option, which clears the stored slug", () => {
        expect(connectionSlugFromOption(undefined)).toBeNull()
        expect(connectionSlugFromOption({input: 1, output: 2})).toBeNull()
        expect(connectionSlugFromOption({connectionSlug: ""})).toBeNull()
    })
})
