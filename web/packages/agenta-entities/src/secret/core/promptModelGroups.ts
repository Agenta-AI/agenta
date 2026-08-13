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

import {splitCuratedLabel} from "@agenta/shared/utils"

import {
    bareModelId,
    defaultModelsFor,
    type HarnessCapabilityMap,
    type ProviderConnection,
} from "./connections"
import {fromLitellmModelId, toLitellmModelId} from "./litellmModelId"
import {SecretKind} from "./types"

/** One option in a picker group. Structurally the `ProviderGroup` option `@agenta/ui` renders. */
export interface PromptModelOption {
    label: string
    value: string
    key: string
    /** Muted second line under the option label. */
    caption?: string
    /** The curated label's trailing aside — "(default)", "(cheapest)" — drawn quietly beside it. */
    hint?: string
    metadata?: Record<string, unknown>
}

export interface PromptModelGroup {
    label: string
    options: PromptModelOption[]
    /**
     * Stable group identity. Two connections of one family share a display name, and a connection
     * named after its family collides with the catalog group — the picker keys hover, selection and
     * the open model column off this, so it must not be the label.
     */
    key?: string
    /** Provider family for the logo; also marks the label as a name to render verbatim. */
    iconKey?: string
    /** Muted second line under the group name. */
    caption?: string
}

export interface BuildConnectionModelGroupsArgs {
    /** Every stored connection, from `toProviderConnections`. */
    connections: ProviderConnection[]
    /**
     * The prompt-side static catalog as provider family -> model ids — the schema's `choices`.
     * Last resort only: what a connection with no saved list offers when the harness catalog is
     * unavailable. `capabilities` is the source that agrees with Settings.
     */
    catalog?: Record<string, string[]>
    /**
     * The harness catalog: the curated model names, AND the effective model set a connection
     * offers when it saved none of its own. Absent (an older backend, or a caller with nothing to
     * hand) falls back to `catalog` and leaves every row on its model id.
     */
    capabilities?: HarnessCapabilityMap | null
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
 * The name the catalog curates for a model, or null when it curates none.
 *
 * The same lookup the agent picker's rows use, minus the harness: a prompt runs on litellm, not on
 * a harness, so the name is taken from whichever harness publishes the model — the record is about
 * the model, and the harnesses that share one agree on what it is called. Ids are matched on their
 * bare spelling because harnesses prefix the family differently and litellm differently again.
 */
export const curatedModelName = (
    capabilities: HarnessCapabilityMap | null | undefined,
    family: string,
    model: string,
): string | null => {
    if (!capabilities || !family || !model) return null

    const wanted = bareModelId(model, family).toLowerCase()
    for (const harness of Object.values(capabilities)) {
        for (const entry of harness?.model_catalog ?? []) {
            if (entry.provider !== family || !entry.id) continue
            if (bareModelId(entry.id, family).toLowerCase() !== wanted) continue
            const curated = entry.label ?? entry.name
            if (curated) return curated
        }
    }
    return null
}

/**
 * What a standard connection offers when it saved no model list of its own.
 *
 * The SAME rule the settings card and the agent picker apply (`connectionModelIds`): Agenta's
 * default set for the family, else everything the family publishes. Reading the prompt schema's
 * `choices` here instead is what let one connection offer 40 models in this picker while Settings
 * called it "Defaults" and the agent picker offered 3 — three surfaces, three answers, for a
 * record whose model list is a single fact about the connection.
 *
 * The schema catalog survives only as the last resort, for a deployment whose harness catalog has
 * not loaded (or is too old to publish one): a stale-but-populated menu beats an empty one.
 */
const fallbackModels = (
    connection: ProviderConnection,
    catalog: Record<string, string[]>,
    capabilities: HarnessCapabilityMap | null | undefined,
): string[] => {
    const effective = defaultModelsFor(connection, capabilities)
    return effective.length ? effective : (catalog[connection.kind] ?? [])
}

/** One offered model: what gets persisted, and what the menu calls it. */
interface ConnectionModel {
    /** The litellm-spelled id a pick writes into the config. */
    value: string
    /** The provider's own spelling, which is the one the user recognises. */
    label: string
    /** The curated label's trailing aside, when it carries one. */
    hint?: string
}

/**
 * The models a connection offers the prompt picker.
 *
 * A saved list wins, including an empty one — the user chose to offer nothing. With no saved list,
 * a standard connection falls back to its provider family's catalog models. A custom connection
 * offers its stored `model_keys` (the `slug/kind/model` spelling both the resolver and litellm's
 * rewrite expect), falling back to bare slugs on a record that predates them.
 *
 * A saved list stores the provider's own spelling (`claude-sonnet-5`) so it resolves in every
 * harness, while the prompt runtime is litellm (`anthropic/claude-sonnet-5`). Every standard
 * option's VALUE is translated, so one model persists identically wherever it was picked from and
 * an id the catalog never listed — freshly discovered, or added by hand — still gets its prefix.
 * Matching against the catalog could only ever spell ids the catalog already knew.
 *
 * The LABEL is the curated name when the catalog has one ("GPT-5.6 Luna"), which is what the agent
 * picker shows and what a user recognises. Everything the catalog does not name — a model added by
 * hand, a gateway's own id — keeps the id it was stored as, so a manually configured model reads
 * back exactly as it was typed.
 *
 * Custom-provider model keys pass through byte-identical: they name the connection, and the
 * resolver rewrites them itself.
 */
const modelsFor = (
    connection: ProviderConnection,
    catalog: Record<string, string[]>,
    capabilities: HarnessCapabilityMap | null | undefined,
): ConnectionModel[] => {
    if (connection.secretKind === SecretKind.CustomProvider) {
        const keys = connection.source.modelKeys ?? connection.models ?? []
        return keys.map((model) => ({value: model, label: model}))
    }

    const models = connection.models ?? fallbackModels(connection, catalog, capabilities)
    return models.map((model) => {
        const value = toLitellmModelId(model, connection.kind)
        const curated = curatedModelName(capabilities, connection.kind, model)
        // Only a CURATED label carries an aside; a raw id's parentheses are part of the id.
        const {name, hint} = curated
            ? splitCuratedLabel(curated)
            : {name: fromLitellmModelId(value, connection.kind), hint: undefined}
        return {value, label: name, ...(hint ? {hint} : {})}
    })
}

/**
 * Group the stored connections for the model picker: one group per connection, labeled with its
 * display name, each option stamped with the connection slug so picking a model can persist which
 * credential it runs on.
 *
 * EVERY connection with models to offer gets a group, including a lone standard one still on the
 * catalog defaults. These groups ARE the prompt menu: the static catalog groups no longer appear
 * beside them, so every row a user can pick names a credential the project actually holds, and a
 * vendor with no connection is absent rather than offered and then failing at run time. The stored
 * model is merged back in separately (`withCurrentSelectionGroup`) when no connection offers it.
 */
export const buildConnectionModelGroups = ({
    connections,
    catalog = {},
    capabilities,
}: BuildConnectionModelGroupsArgs): PromptModelGroup[] => {
    const groups: PromptModelGroup[] = []

    for (const connection of connections) {
        const isStandard = connection.secretKind === SecretKind.ProviderKey
        const models = modelsFor(connection, catalog, capabilities).filter((model) => !!model.value)
        if (!models.length) continue

        const slug = connectionSlugFor(connection)
        groups.push({
            // The record id, not the slug: a record that predates slugs falls back to its provider
            // family, which is exactly the identity that collides with the catalog group.
            key: connection.id,
            label: connection.name,
            iconKey: connection.kind,
            options: models.map(({label, value, hint}) => ({
                label,
                value,
                ...(hint ? {hint} : {}),
                // Two connections can offer the same model id, so the value alone is not a
                // unique React key within the merged menu.
                key: `${slug ?? connection.id}:${value}`,
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

/** The provider family an option was built from, or null for a static catalog option. */
const providerFamilyOf = (metadata: Record<string, unknown> | undefined | null): string | null => {
    const family = metadata?.provider
    return typeof family === "string" && family ? family : null
}

/**
 * Whether an option offers the stored model, in either spelling.
 *
 * Options now carry litellm ids, but configs written before that (and any hand-edited one) hold the
 * provider's own spelling. Both sides are normalized through the option's family so the two agree;
 * a custom-provider or unknown family normalizes to itself, leaving those an exact comparison.
 */
const offersModel = (
    option: {value: string; metadata?: Record<string, unknown>},
    model: string,
): boolean => {
    if (option.value === model) return true
    const family = providerFamilyOf(option.metadata)
    if (!family) return false
    return toLitellmModelId(option.value, family) === toLitellmModelId(model, family)
}

/**
 * The key of the ONE option a stored model + connection pair selects, or null when nothing matches.
 *
 * Matching on the model id alone lights up every group offering that id — two keys for one provider
 * both claim the same `gpt-4o-mini`. The stored connection slug picks between them. A config that
 * stored no slug (everything written before connections, and every pick from a catalog group) still
 * resolves whenever the id is offered once, which is the common case; ambiguity is the only thing
 * the slug has to break.
 */
export const selectedOptionKey = ({
    groups,
    model,
    connectionSlug,
}: {
    groups: {options: {value: string; key?: string; metadata?: Record<string, unknown>}[]}[]
    model: string | null | undefined
    connectionSlug?: string | null
}): string | null => {
    if (!model) return null

    const matches = groups
        .flatMap((group) => group.options)
        .filter((option) => offersModel(option, model))
    if (!matches.length) return null
    if (matches.length === 1) return matches[0].key ?? matches[0].value

    const scoped = matches.find(
        (option) => connectionSlugFromOption(option.metadata) === (connectionSlug ?? null),
    )
    // No option claims the stored slug (a renamed or deleted connection): fall back to the first
    // match, so the menu still shows one selected row rather than none.
    const picked = scoped ?? matches[0]
    return picked.key ?? picked.value
}

/**
 * Group identity for the merged-in stored model. Also its `iconKey`: a truthy one tells the picker
 * to print the group label verbatim, and it names no provider family, so no logo resolves.
 */
export const CURRENT_SELECTION_GROUP_KEY = "current-selection"
export const CURRENT_SELECTION_GROUP_LABEL = "Current selection"
/** Second line under the group name, saying why it sits apart from the connections above it. */
export const CURRENT_SELECTION_GROUP_CAPTION = "Not offered by a connected provider"
/** Second line under the model row, which is all the flat search view has room to say. */
export const CURRENT_SELECTION_OPTION_CAPTION = "Not connected"

/**
 * The picker groups plus the stored model, when no connection offers it.
 *
 * A connected-only menu would silently drop a model the project no longer holds a key for — the
 * trigger would read as unset while the config still ran that model, and the first stray click
 * would overwrite it. One extra row keeps the truth on screen: the stored id, labeled as its own
 * "Current selection" group, marked as coming from no connection. It stays runnable exactly as it
 * is today (family fallback resolves it), and picking anything else replaces it, at which point
 * nothing claims it and the row is gone on the next open.
 *
 * The stored slug rides along, so re-picking the row rewrites the pair it came from rather than
 * clearing a connection the resolver may still match.
 */
export const withCurrentSelectionGroup = <
    TGroup extends {options: {value: string; key?: string; metadata?: Record<string, unknown>}[]},
>({
    groups,
    model,
    connectionSlug,
}: {
    groups: TGroup[]
    model: string | null | undefined
    connectionSlug?: string | null
}): (TGroup | PromptModelGroup)[] => {
    if (!model) return groups
    // Anything the offered groups already claim — in either spelling, under either connection — is
    // the selection, so there is nothing to merge in.
    if (selectedOptionKey({groups, model, connectionSlug})) return groups

    return [
        ...groups,
        {
            key: CURRENT_SELECTION_GROUP_KEY,
            label: CURRENT_SELECTION_GROUP_LABEL,
            iconKey: CURRENT_SELECTION_GROUP_KEY,
            caption: CURRENT_SELECTION_GROUP_CAPTION,
            options: [
                {
                    label: model,
                    value: model,
                    key: `${CURRENT_SELECTION_GROUP_KEY}:${model}`,
                    caption: CURRENT_SELECTION_OPTION_CAPTION,
                    metadata: connectionSlug ? {connectionSlug} : {},
                },
            ],
        },
    ]
}

/**
 * What the picker CALLS the stored selection — the label of the row `selectedOptionKey` names.
 *
 * The closed trigger has to read the same as the open menu: a curated name where the catalog has
 * one, the id as typed for a hand-added model. Printing the stored id instead showed a litellm slug
 * (`openrouter/deepseek/deepseek-v4-flash:nitro`) under a menu that called the same model
 * "DeepSeek: DeepSeek V4 Flash".
 *
 * Null when nothing offers the model, which is the caller's cue to print the stored id — exactly
 * what the merged-in current-selection row would have labeled it anyway.
 */
export const selectedOptionLabel = ({
    groups,
    model,
    connectionSlug,
}: {
    groups: {
        options: {value: string; key?: string; label?: string; metadata?: Record<string, unknown>}[]
    }[]
    model: string | null | undefined
    connectionSlug?: string | null
}): string | null => {
    const key = selectedOptionKey({groups, model, connectionSlug})
    if (!key) return null

    for (const group of groups) {
        for (const option of group.options) {
            if ((option.key ?? option.value) === key) return option.label || null
        }
    }
    return null
}

/** The connection slug a picked option carries, or null when it came from the static catalog. */
export const connectionSlugFromOption = (
    metadata: Record<string, unknown> | undefined | null,
): string | null => {
    const slug = metadata?.connectionSlug
    return typeof slug === "string" && slug ? slug : null
}
