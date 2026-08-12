/**
 * promptModelGroups — the prompt-side model picker's connection groups.
 *
 * The prompt playground and LLM-as-a-judge share one model catalog (the schema's `choices`, backed
 * by `supported_llm_models` in the SDK) and one credential resolver (`SecretsManager`). That
 * resolver used to map a model string back to a provider family and take the first matching key,
 * which breaks the moment a project holds two OpenAI connections. It now resolves by connection
 * slug first, so the picker has to offer — and persist — the connection alongside the model.
 *
 * These functions turn stored connections into picker groups. Custom-provider connections already
 * had groups here; standard connections join them. Pure (no React, no atoms) so the rules are
 * testable directly.
 *
 * Design: docs/design/provider-connections-models/plan.md, pull request 4.
 */

import type {ProviderConnection} from "./connections"
import {SecretKind} from "./types"

/** One option in a picker group. Structurally the `ProviderGroup` option `@agenta/ui` renders. */
export interface PromptModelOption {
    label: string
    value: string
    key: string
    metadata?: Record<string, unknown>
}

export interface PromptModelGroup {
    label: string
    options: PromptModelOption[]
    /** Provider family for the logo; also marks the label as a name to render verbatim. */
    iconKey?: string
}

export interface BuildConnectionModelGroupsArgs {
    /** Every stored connection, from `toProviderConnections`. */
    connections: ProviderConnection[]
    /**
     * The prompt-side static catalog as provider family -> model ids — the schema's `choices`.
     * Supplies the model list for a standard connection that saved none of its own.
     */
    catalog?: Record<string, string[]>
}

/**
 * The identity the credential resolver matches a connection on, or null when the record has none.
 *
 * A record created since named connections carries a stable slug. Older ones have none and stay
 * addressable the way they always were: a standard connection by its provider family (`kind`, the
 * canonical vault kind — NOT `name`, which is a derived title for an unnamed record and becomes
 * the user's own words after a rename), a custom one by its stored header name (which the API
 * mirrors into `data.provider_slug`).
 *
 * Mirrors `SecretsManager._parse_*_secrets` in the SDK — the two must agree or a persisted slug
 * resolves to nothing. Null when neither source is stored: the caller then persists no slug and
 * the run falls back to provider-family resolution, rather than inventing an identity that would
 * fail loud on a record that resolves fine today.
 */
export const connectionSlugFor = (connection: ProviderConnection): string | null => {
    if (connection.slug) return connection.slug
    if (connection.secretKind === SecretKind.ProviderKey) return connection.kind || null
    return connection.source.displayName || connection.source.name || null
}

/**
 * The models a connection offers the prompt picker.
 *
 * A saved list wins, including an empty one — the user chose to offer nothing. With no saved list,
 * a standard connection falls back to its provider family's catalog models. A custom connection
 * offers its stored `model_keys` (the `slug/kind/model` spelling both the resolver and litellm's
 * rewrite expect), falling back to bare slugs on a record that predates them.
 */
const modelsFor = (connection: ProviderConnection, catalog: Record<string, string[]>): string[] => {
    if (connection.secretKind === SecretKind.CustomProvider) {
        return connection.source.modelKeys ?? connection.models ?? []
    }
    return connection.models ?? catalog[connection.kind] ?? []
}

/**
 * Group the stored connections for the model picker: one group per connection, labeled with its
 * display name, each option stamped with the connection slug so picking a model can persist which
 * credential it runs on.
 *
 * A standard connection that saved no model list AND is the only one for its provider is skipped:
 * the static catalog group already offers exactly those models under the provider's name, and a
 * second identical group would just duplicate the menu. Its models still resolve — with no slug
 * persisted, the resolver falls back to the provider family, which is unambiguous precisely
 * because that connection is the only one.
 */
export const buildConnectionModelGroups = ({
    connections,
    catalog = {},
}: BuildConnectionModelGroupsArgs): PromptModelGroup[] => {
    const standardPerKind = connections.reduce<Record<string, number>>((acc, connection) => {
        if (connection.secretKind === SecretKind.ProviderKey) {
            acc[connection.kind] = (acc[connection.kind] ?? 0) + 1
        }
        return acc
    }, {})

    const groups: PromptModelGroup[] = []

    for (const connection of connections) {
        const isStandard = connection.secretKind === SecretKind.ProviderKey
        if (isStandard && connection.models === undefined && standardPerKind[connection.kind] === 1)
            continue

        const models = modelsFor(connection, catalog).filter(Boolean)
        if (!models.length) continue

        const slug = connectionSlugFor(connection)
        groups.push({
            label: connection.name,
            iconKey: connection.kind,
            options: models.map((model) => ({
                label: model,
                value: model,
                // Two connections can offer the same model id, so the value alone is not a
                // unique React key within the merged menu.
                key: `${slug ?? connection.id}:${model}`,
                // No stable identity means no slug to persist — the pick resolves by provider
                // family, exactly as it does today.
                metadata: {
                    ...(slug ? {connectionSlug: slug} : {}),
                    provider: connection.kind,
                    // A standard connection's model id (`gpt-4o-mini`) names only its family, so
                    // the option resolves to THIS credential only while the slug rides with it. A
                    // custom connection's model key (`slug/kind/model`) names the connection
                    // itself, so it resolves without one.
                    ...(isStandard && slug ? {requiresConnectionSlug: true} : {}),
                },
            })),
        })
    }

    return groups
}

/** A group whose options only reach the right credential when their slug is persisted too. */
const requiresConnectionSlug = (group: {
    options: {metadata?: Record<string, unknown>}[]
}): boolean => group.options.some((option) => option.metadata?.requiresConnectionSlug === true)

/**
 * The groups a picker may offer when it can write the model but NOT a sibling connection slug.
 *
 * Standard-connection groups drop out: picking "OpenAI 2 / gpt-4o-mini" in such a control would
 * store a bare model id and silently run on whichever OpenAI key resolves first. Custom-provider
 * groups stay — their model keys carry the connection, so they resolve without a slug.
 */
export const withoutSlugBoundGroups = <
    TGroup extends {options: {metadata?: Record<string, unknown>}[]},
>(
    groups: TGroup[],
): TGroup[] => groups.filter((group) => !requiresConnectionSlug(group))

/**
 * The static catalog groups still worth showing beside the connection groups.
 *
 * A family whose models are offered by two or more connections loses its static group: those
 * options carry no slug, so picking one binds to whichever connection the resolver reaches first —
 * a coin flip between two of the user's own keys. The per-connection groups above already offer
 * the same models with the slug attached. A family with a single offering connection keeps its
 * static group: with one credential in play, no-slug resolution is unambiguous.
 */
export const withoutAmbiguousCatalogGroups = <
    TGroup extends {options: {value: string; metadata?: Record<string, unknown>}[]},
>({
    staticGroups,
    connectionGroups,
    catalog = {},
}: {
    staticGroups: TGroup[]
    connectionGroups: {options: {metadata?: Record<string, unknown>}[]}[]
    catalog?: Record<string, string[]>
}): TGroup[] => {
    const groupsPerFamily = connectionGroups.reduce<Record<string, number>>((acc, group) => {
        const family = group.options[0]?.metadata?.provider
        if (typeof family === "string" && family) acc[family] = (acc[family] ?? 0) + 1
        return acc
    }, {})

    const familyOf = (group: TGroup): string | undefined => {
        const sample = group.options[0]?.value
        if (!sample) return undefined
        return Object.entries(catalog).find(([, models]) => models.includes(sample))?.[0]
    }

    return staticGroups.filter((group) => {
        const family = familyOf(group)
        return !family || (groupsPerFamily[family] ?? 0) < 2
    })
}

/** The connection slug a picked option carries, or null when it came from the static catalog. */
export const connectionSlugFromOption = (
    metadata: Record<string, unknown> | undefined | null,
): string | null => {
    const slug = metadata?.connectionSlug
    return typeof slug === "string" && slug ? slug : null
}
