import {describe, expect, it} from "vitest"

import type {ProviderConnection} from "../../src/secret/core/connections"
import {
    buildConnectionModelGroups,
    connectionSlugFor,
    connectionSlugFromOption,
    withoutAmbiguousCatalogGroups,
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
    it("skips a lone standard connection that saved no model list", () => {
        const groups = buildConnectionModelGroups({
            connections: [standard()],
            catalog: CATALOG,
        })

        // The static catalog group already offers exactly these models under the provider name,
        // and family resolution is unambiguous with one connection.
        expect(groups).toEqual([])
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

describe("withoutAmbiguousCatalogGroups", () => {
    // What `getOptionsFromSchema` produces from the schema's `choices`.
    const staticGroups = [
        {label: "Openai", options: [{value: "gpt-4o"}, {value: "gpt-4o-mini"}]},
        {label: "Anthropic", options: [{value: "anthropic/claude-haiku-4-5"}]},
    ]

    const filtered = (connections: ProviderConnection[]) =>
        withoutAmbiguousCatalogGroups({
            staticGroups,
            connectionGroups: buildConnectionModelGroups({connections, catalog: CATALOG}),
            catalog: CATALOG,
        }).map((group) => group.label)

    it("drops the family's static group once two connections offer its models", () => {
        expect(
            filtered([
                standard({id: "a", slug: "openai", name: "OpenAI"}),
                standard({id: "b", slug: "openai-2", name: "OpenAI 2"}),
            ]),
        ).toEqual(["Anthropic"])
    })

    it("keeps a lone connection's family, where no-slug resolution is unambiguous", () => {
        expect(filtered([standard()])).toEqual(["Openai", "Anthropic"])
    })

    it("keeps the family when only one of the two connections offers models", () => {
        // The other saved an empty list, so family resolution has a single claimant.
        expect(
            filtered([
                standard({id: "a", slug: "openai", models: []}),
                standard({id: "b", slug: "openai-2", models: ["gpt-4o"]}),
            ]),
        ).toEqual(["Openai", "Anthropic"])
    })

    it("keeps every static group when custom gateways are the only connections", () => {
        expect(filtered([custom(), custom({id: "c2", slug: "my-gw-2"})])).toEqual([
            "Openai",
            "Anthropic",
        ])
    })

    it("keeps a static group whose models the catalog does not cover", () => {
        const groups = withoutAmbiguousCatalogGroups({
            staticGroups: [{label: "Mystery", options: [{value: "unlisted-model"}]}],
            connectionGroups: buildConnectionModelGroups({
                connections: [
                    standard({id: "a", slug: "openai"}),
                    standard({id: "b", slug: "openai-2"}),
                ],
                catalog: CATALOG,
            }),
            catalog: CATALOG,
        })

        expect(groups.map((group) => group.label)).toEqual(["Mystery"])
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
