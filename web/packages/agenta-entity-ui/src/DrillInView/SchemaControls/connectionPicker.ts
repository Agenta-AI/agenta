/**
 * connectionPicker — the agent playground's connection-first model menu.
 *
 * The old menu's first level was a provider FAMILY (one "OpenAI" row, whichever key happened to be
 * stored). A project may hold several connections per family, so the family cannot identify a
 * credential any more: the first level is now one row per stored connection, plus a row per
 * subscription, and the second level is one row per model AND harness pair.
 *
 * Everything here is pure — connections in, rows out — so the intersection rules (saved models vs
 * Agenta's defaults, saved harness policy vs technical reach, one model reachable twice) are
 * testable without a React harness. The rules themselves are shared with the settings surface:
 * `harnessSupportsProviderKind` and `providerModelCatalog` come from `@agenta/entities/secret`, so
 * the picker and the connection card cannot drift.
 *
 * Design: docs/design/provider-connections-models/experience.md ("Model picker in the playground").
 */

import {
    SecretKind,
    bareModelId,
    connectionSlugFor,
    harnessSupportsProviderKind,
    providerModelCatalog,
    type HarnessCapabilityMap,
    type ProviderConnection,
} from "@agenta/entities/secret"
import type {ProviderGroup} from "@agenta/ui/select-llm-provider"

import {
    modelLabel,
    vaultPickedProviderFamily,
    type ConnectionMode,
    type HarnessCapabilitiesMap,
} from "./connectionUtils"
import {harnessMetaFor} from "./harnessMeta"

/**
 * The harnesses whose `self_managed` on-ramp is a consumer SUBSCRIPTION, and the provider family
 * the subscription covers.
 *
 * Every harness declares `self_managed` (it means "the harness signs itself in", which also covers
 * machine credentials in the environment), so the capability map alone cannot say which of them a
 * user would recognise as a subscription. Only these two are offered as subscription ROWS; the
 * other harnesses keep reaching their own environment through the credentials section's
 * "Use subscription" toggle, unchanged.
 */
export const SUBSCRIPTION_HARNESSES: Record<
    string,
    {
        name: string
        family: string
        /** Where the deployment mounts the provider's login folder. */ mount: string
    }
> = {
    claude: {name: "Claude subscription", family: "anthropic", mount: "~/.claude"},
    codex: {name: "ChatGPT subscription", family: "openai", mount: "~/.codex"},
}

/** Cost hints, shown only when the same model is reachable more than once. */
export const COST_HINTS = {
    subscription: "Subscription access has no per-token cost",
    api: "API access is metered per token",
} as const

/** One selectable model, in one harness, through one connection. */
export interface PickerModelRow {
    /** The id to persist — the selected harness's own spelling of the model. */
    modelId: string
    label: string
    harness: string
    harnessLabel: string
    mode: ConnectionMode
    /** The connection slug to persist; null for a subscription (nothing to address). */
    slug: string | null
    /** The provider FAMILY to persist alongside the model. */
    provider: string | null
    connectionKey: string
    connectionName: string
    /** Set only when this model is reachable through more than one connection or harness. */
    costHint: string | null
}

/** One first-level row: a stored connection, or a subscription. */
export interface PickerConnectionRow {
    key: string
    name: string
    /** Provider family the row's logo is looked up by (`getProviderIcon`). */
    iconKey: string
    kind: "connection" | "subscription"
    models: PickerModelRow[]
}

/** What a picked option writes back into the agent config. */
export interface PickerSelection {
    modelId: string
    provider: string | null
    mode: ConnectionMode
    slug: string | null
    /** The harness the picked row belongs to; null when the option carried none. */
    harness: string | null
}

export interface BuildPickerRowsArgs {
    connections: ProviderConnection[]
    capabilities: HarnessCapabilitiesMap | null | undefined
    /** The harness ids a picker may offer (`selectableHarnesses` of the catalog). */
    harnessIds: string[]
    /**
     * Whether subscription rows belong in this menu. A subscription is a login mounted into the
     * deployment, which a cloud deployment has no way to hold — so the rows are offered only off
     * cloud. Defaults to true (an unknown deployment is treated as self-hosted, as elsewhere).
     */
    showSubscriptions?: boolean
}

/**
 * The harnesses a connection may actually drive: its saved harness policy (absent means "any"),
 * narrowed to the harnesses Agenta offers, narrowed again to the ones that can technically reach
 * this provider kind.
 */
export const effectiveHarnesses = (
    connection: ProviderConnection,
    capabilities: HarnessCapabilityMap | null | undefined,
    harnessIds: string[],
): string[] => {
    const allowed = connection.harnesses ?? harnessIds
    return harnessIds.filter(
        (harness) =>
            allowed.includes(harness) &&
            harnessSupportsProviderKind(capabilities, harness, connection.kind),
    )
}

/**
 * The models a connection offers, in Agenta's bare spelling: its saved list when it has one
 * (including an empty one — the user chose to offer nothing), otherwise the provider's default
 * models from the harness catalog.
 *
 * A backend that publishes no `default_models` yet falls back to the family's full catalog, which
 * is what the picker showed before connections existed.
 */
export const connectionModelIds = (
    connection: ProviderConnection,
    capabilities: HarnessCapabilityMap | null | undefined,
): string[] => {
    if (connection.models) return connection.models.filter(Boolean)

    // The RECORD's kind, not the provider kind's default: a `custom_provider` saved under a plain
    // family (a second, differently-configured OpenAI endpoint) serves its own model keys, not
    // Agenta's catalog for that family.
    if (connection.secretKind !== SecretKind.ProviderKey) {
        // A credential-set connection carries whatever its endpoint serves; there is no catalog
        // to default from.
        return (connection.source.modelKeys ?? []).filter(Boolean)
    }

    const {models, defaults} = providerModelCatalog(capabilities, connection.kind)
    return defaults.length ? defaults : models
}

/**
 * How one harness spells each model of a provider family, indexed by the bare spelling that gets
 * saved. Pi prefixes the family, Codex does not, Claude names a tier — a saved `claude-fable-5`
 * has to come back out as whatever the harness accepts, or the run fails on an id the harness
 * never published.
 */
const harnessSpellings = (
    capabilities: HarnessCapabilitiesMap | null | undefined,
    harness: string,
    family: string,
): Map<string, string> => {
    const caps = capabilities?.[harness]
    const index = new Map<string, string>()
    if (!caps) return index

    for (const id of caps.models?.[family] ?? []) {
        index.set(bareModelId(id, family).toLowerCase(), id)
    }
    for (const entry of caps.model_catalog ?? []) {
        if (entry.provider !== family || !entry.id) continue
        index.set(bareModelId(entry.id, family).toLowerCase(), entry.id)
    }
    return index
}

const modelRow = ({
    modelId,
    harness,
    capabilities,
    mode,
    slug,
    provider,
    connection,
}: {
    modelId: string
    harness: string
    capabilities: HarnessCapabilitiesMap | null | undefined
    mode: ConnectionMode
    slug: string | null
    provider: string | null
    connection: {key: string; name: string}
}): PickerModelRow => ({
    modelId,
    label: modelLabel(capabilities, harness, modelId) ?? modelId,
    harness,
    harnessLabel: harnessMetaFor(harness).label,
    mode,
    slug,
    provider,
    connectionKey: connection.key,
    connectionName: connection.name,
    costHint: null,
})

/** One row per stored connection, its models crossed with the harnesses it may drive. */
const connectionRows = ({
    connections,
    capabilities,
    harnessIds,
}: BuildPickerRowsArgs): PickerConnectionRow[] => {
    const rows: PickerConnectionRow[] = []

    for (const connection of connections) {
        const harnesses = effectiveHarnesses(connection, capabilities, harnessIds)
        if (!harnesses.length) continue

        const ids = connectionModelIds(connection, capabilities)
        if (!ids.length) continue

        const slug = connectionSlugFor(connection)
        const isStandard = connection.secretKind === SecretKind.ProviderKey
        const identity = {key: connection.id, name: connection.name}
        const models: PickerModelRow[] = []

        for (const harness of harnesses) {
            if (isStandard) {
                // A standard connection's models must exist in the harness's own catalog —
                // that intersection is what makes the pair runnable.
                const spellings = harnessSpellings(capabilities, harness, connection.kind)
                for (const id of ids) {
                    const spelled = spellings.get(bareModelId(id, connection.kind).toLowerCase())
                    if (!spelled) continue
                    models.push(
                        modelRow({
                            modelId: spelled,
                            harness,
                            capabilities,
                            mode: "agenta",
                            slug,
                            provider: connection.kind,
                            connection: identity,
                        }),
                    )
                }
                continue
            }

            // A credential-set connection's models come from the connection itself; the harness
            // catalog has never heard of them, so reachability is the deployment check above.
            for (const id of ids) {
                models.push(
                    modelRow({
                        modelId: id,
                        harness,
                        capabilities,
                        mode: "agenta",
                        slug,
                        provider: vaultPickedProviderFamily(id, connection.kind, capabilities),
                        connection: identity,
                    }),
                )
            }
        }

        if (!models.length) continue
        rows.push({
            key: connection.id,
            name: connection.name,
            iconKey: connection.kind,
            kind: "connection",
            models,
        })
    }

    return rows
}

/** One row per subscription the deployment could be signed in to. */
const subscriptionRows = ({
    capabilities,
    harnessIds,
    showSubscriptions = true,
}: Omit<BuildPickerRowsArgs, "connections">): PickerConnectionRow[] => {
    const rows: PickerConnectionRow[] = []
    if (!showSubscriptions) return rows

    for (const harness of harnessIds) {
        const meta = SUBSCRIPTION_HARNESSES[harness]
        const caps = capabilities?.[harness]
        if (!meta || !caps?.connection_modes?.includes("self_managed")) continue

        const identity = {key: `subscription:${harness}`, name: meta.name}
        const models = (caps.models?.[meta.family] ?? []).map((id) =>
            modelRow({
                modelId: id,
                harness,
                capabilities,
                mode: "self_managed",
                slug: null,
                provider: meta.family,
                connection: identity,
            }),
        )
        if (!models.length) continue

        rows.push({
            key: identity.key,
            name: meta.name,
            iconKey: meta.family,
            kind: "subscription",
            models,
        })
    }

    return rows
}

/**
 * The picker's first level: every stored connection, then every subscription.
 *
 * A model reachable more than once — two keys for the same provider, or one connection under two
 * harnesses — carries a cost hint on each of its rows, because that is the only thing that
 * distinguishes otherwise identical-looking rows.
 */
export const buildConnectionPickerRows = (args: BuildPickerRowsArgs): PickerConnectionRow[] => {
    const rows = [...connectionRows(args), ...subscriptionRows(args)]

    const reach = new Map<string, number>()
    for (const row of rows) {
        for (const model of row.models) {
            const key = bareModelId(model.modelId, model.provider ?? "").toLowerCase()
            reach.set(key, (reach.get(key) ?? 0) + 1)
        }
    }

    return rows.map((row) => ({
        ...row,
        models: row.models.map((model) => {
            const key = bareModelId(model.modelId, model.provider ?? "").toLowerCase()
            if ((reach.get(key) ?? 0) < 2) return model
            return {
                ...model,
                costHint: model.mode === "self_managed" ? COST_HINTS.subscription : COST_HINTS.api,
            }
        }),
    }))
}

/** The metadata a picked option carries back, so a selection never has to be guessed by model id. */
export interface PickerOptionMetadata extends Record<string, unknown> {
    connectionSlug?: string
    connectionMode: ConnectionMode
    harness: string
    provider?: string
}

/**
 * The picker menu, in the shape `SelectLLMProviderBase` renders: one group per connection, one
 * option per model and harness pair.
 *
 * Each option carries the harness as a neutral tag, the cost hint as its caption, and the
 * connection name as its search caption — the flat search view has no group column to say which
 * connection a result came from.
 */
export const buildPickerGroups = (rows: PickerConnectionRow[]): ProviderGroup[] =>
    rows.map((row) => ({
        key: row.key,
        label: row.name,
        iconKey: row.iconKey,
        options: row.models.map((model) => ({
            label: model.label,
            value: model.modelId,
            // One model can appear under several harnesses in the same group, so the value alone
            // is not a unique key.
            key: `${row.key}:${model.harness}:${model.modelId}`,
            tag: model.harnessLabel,
            caption: model.costHint ?? undefined,
            searchCaption: row.name,
            metadata: {
                ...(model.slug ? {connectionSlug: model.slug} : {}),
                connectionMode: model.mode,
                harness: model.harness,
                ...(model.provider ? {provider: model.provider} : {}),
            } satisfies PickerOptionMetadata,
        })),
    }))

/**
 * What to persist for a picked option: the model, its provider family, the connection mode and
 * slug, and the harness the row belonged to.
 *
 * An option with no metadata (the pre-connection catalog menu, or a stale caller) resolves to the
 * project-default connection with no slug, which is what the config held before slugs existed.
 */
export const pickerSelectionFrom = (
    modelId: string,
    metadata?: Record<string, unknown> | null,
): PickerSelection => {
    const read = (key: string): string | null => {
        const value = metadata?.[key]
        return typeof value === "string" && value ? value : null
    }
    const mode = read("connectionMode") === "self_managed" ? "self_managed" : "agenta"
    return {
        modelId,
        provider: read("provider"),
        mode,
        // A subscription addresses no stored record, so its slug must be cleared, not carried.
        slug: mode === "agenta" ? read("connectionSlug") : null,
        harness: read("harness"),
    }
}
