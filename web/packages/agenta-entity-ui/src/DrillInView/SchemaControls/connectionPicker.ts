/**
 * connectionPicker — the agent playground's connection-first model menus.
 *
 * The old menu's first level was a provider FAMILY (one "OpenAI" row, whichever key happened to be
 * stored). A project may hold several connections per family, so the family cannot identify a
 * credential any more: the first level is now one row per stored connection, plus a row per
 * subscription, and the second level is one row per model AND harness pair.
 *
 * Two surfaces are built from those rows, both keeping the model-and-harness pairs and both fed by
 * `buildPickerGroupsWithSections`: the config section's cascade (`ModelPickerControl`) and the chat's `/model`
 * palette. Picking a row is what sets the harness — there is no separate harness control any more.
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
    subscriptionPairModels,
    subscriptionPlanName,
    type SubscriptionPair,
    type HarnessCapabilityMap,
    type ProviderConnection,
} from "@agenta/entities/secret"

import {
    modelLabel,
    modelSelectionMode,
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
 *
 * Only harnesses that ARE a provider's own client can be listed here: the family is fixed by the
 * harness. A general harness (Pi) reads whichever login the deployment mounted, so its family is
 * not knowable from the catalog — only the runner's subscription-status answer can name it, which
 * is what the drawer's `subscriptionPairsFrom` consumes.
 */
export const SUBSCRIPTION_HARNESSES: Record<
    string,
    {
        family: string
        /** Where the deployment mounts the provider's login folder. */ mount: string
    }
> = {
    claude: {family: "anthropic", mount: "~/.claude"},
    codex: {family: "openai", mount: "~/.codex"},
}

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
    /**
     * The subscription × harness pairs the RUNNER reports as usable right now
     * (`subscriptionPairsFrom`). The authoritative source: it is the only thing that can attribute
     * a mounted login to a provider for a general harness like Pi, which reads whichever login is
     * there. Absent or empty (loading, an old runner, an unreachable service) falls back to the
     * static `SUBSCRIPTION_HARNESSES` mapping, so the menu never empties out mid-check.
     */
    subscriptionPairs?: SubscriptionPair[] | null
    /**
     * Which of a pair's models the user chose to see, keyed by pair (`${provider}:${harness}`).
     * The drawer stores this FOR this menu; `undefined` for a pair means untouched, and the plan's
     * recommended set applies.
     */
    pairModelSelection?: Record<string, string[] | undefined> | null
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
 * The models a connection offers, in the spelling the SDK resolves on: a credential-set
 * connection's own `model_keys`, else a standard connection's saved list when it has one
 * (including an empty one — the user chose to offer nothing), else the provider's default
 * models from the harness catalog.
 *
 * A backend that publishes no `default_models` yet falls back to the family's full catalog, which
 * is what the picker showed before connections existed.
 */
export const connectionModelIds = (
    connection: ProviderConnection,
    capabilities: HarnessCapabilityMap | null | undefined,
): string[] => {
    // The RECORD's kind, not the provider kind's default: a `custom_provider` saved under a plain
    // family (a second, differently-configured OpenAI endpoint) serves its own model keys, not
    // Agenta's catalog for that family. Ahead of the saved list because such a record carries
    // both, and only `model_keys` is the spelling the SDK resolves on.
    if (connection.secretKind !== SecretKind.ProviderKey) {
        return (connection.source.modelKeys ?? connection.models ?? []).filter(Boolean)
    }

    if (connection.models) return connection.models.filter(Boolean)

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

/**
 * How a harness would spell a saved model id the catalog has never heard of.
 *
 * The catalog supplies the spelling for every id it knows; this covers only the ones a user typed
 * in themselves — an OpenRouter variant suffix (`…:nitro`), a fine-tune, a model newer than the
 * catalog. The harness's own declared convention decides, not what the user happened to type: a
 * `provider/id` harness (Pi) will not route an unprefixed id, an `alias` harness (Claude) will not
 * route a prefixed one. Idempotent — an id that already carries its family prefix keeps exactly one.
 */
const uncatalogedSpelling = (
    capabilities: HarnessCapabilitiesMap | null | undefined,
    harness: string,
    family: string,
    id: string,
): string => {
    const bare = bareModelId(id, family)
    if (!family || modelSelectionMode(capabilities, harness) !== "provider/id") return bare
    return `${family}/${bare}`
}

const modelRow = ({
    modelId,
    label,
    harness,
    capabilities,
    mode,
    slug,
    provider,
    connection,
}: {
    modelId: string
    /**
     * What to CALL the model, when it differs from the id being persisted. Only the uncataloged
     * path passes it: the id has to carry the harness's prefix to route, but the user should read
     * back the string they typed. Label and value diverging is the norm here — a curated row shows
     * "Sol" and persists `gpt-5.6-sol`.
     */
    label?: string
    harness: string
    capabilities: HarnessCapabilitiesMap | null | undefined
    mode: ConnectionMode
    slug: string | null
    provider: string | null
    connection: {key: string; name: string}
}): PickerModelRow => ({
    modelId,
    label: modelLabel(capabilities, harness, modelId) ?? label ?? modelId,
    harness,
    harnessLabel: harnessMetaFor(harness).label,
    mode,
    slug,
    provider,
    connectionKey: connection.key,
    connectionName: connection.name,
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

        // Whether `ids` are the user's own list or Agenta's catalog defaults — the two get
        // different treatment when the harness catalog cannot spell one of them.
        const hasSavedModels = Boolean(connection.models)
        const slug = connectionSlugFor(connection)
        const isStandard = connection.secretKind === SecretKind.ProviderKey
        const identity = {key: connection.id, name: connection.name}
        const models: PickerModelRow[] = []

        for (const harness of harnesses) {
            if (isStandard) {
                // The catalog spells the ids it knows. An id the user SAVED but the catalog never
                // listed is still offered, spelled the harness's own way: the catalog enumerates
                // what a vendor advertises, not what it accepts (OpenRouter's `…:nitro` variants,
                // fine-tunes, anything newer than the catalog), so treating it as the whole truth
                // silently swallowed models the user had deliberately added. Catalog-derived
                // DEFAULTS keep the intersection — the catalog is their only source anyway.
                const spellings = harnessSpellings(capabilities, harness, connection.kind)
                for (const id of ids) {
                    const catalogued = spellings.get(bareModelId(id, connection.kind).toLowerCase())
                    if (!catalogued && !hasSavedModels) continue
                    const spelled =
                        catalogued ??
                        uncatalogedSpelling(capabilities, harness, connection.kind, id)
                    models.push(
                        modelRow({
                            modelId: spelled,
                            // An uncataloged id reads back as the user TYPED it, here and in the
                            // completion picker alike, even though the id that routes carries the
                            // harness's prefix. A catalogued one keeps the catalog's own naming.
                            label: catalogued ? undefined : id,
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
            // The row's own harness resolves the family a deployment kind cannot name (bedrock
            // hosts many vendors) — see `vaultPickedProviderFamily`.
            for (const id of ids) {
                models.push(
                    modelRow({
                        modelId: id,
                        harness,
                        capabilities,
                        mode: "agenta",
                        slug,
                        provider: vaultPickedProviderFamily(
                            id,
                            connection.kind,
                            capabilities,
                            harness,
                        ),
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

/**
 * One row per subscription PLAN the runner reports as usable, its harness pairs inside.
 *
 * The runner is the only source that can say a ChatGPT login is readable by Pi as well as by
 * Codex — Pi reads whichever login is mounted, so no static map can attribute it. Pairs arrive
 * pre-filtered to `ready`, so every pair here contributes models.
 */
const subscriptionRowsFromPairs = ({
    capabilities,
    pairs,
    pairModelSelection,
}: {
    capabilities: HarnessCapabilitiesMap | null | undefined
    pairs: SubscriptionPair[]
    pairModelSelection?: Record<string, string[] | undefined> | null
}): PickerConnectionRow[] => {
    const rows: PickerConnectionRow[] = []
    const byPlan = new Map<string, PickerConnectionRow>()

    for (const pair of pairs) {
        const {models: offered, defaults} = subscriptionPairModels(capabilities, pair)
        // The user's own list wins, then the plan's recommended set, then everything the pair runs.
        // An explicitly EMPTY saved list is a choice ("show me none of these"), not a missing one.
        const chosen = pairModelSelection?.[pair.key]
        const ids = chosen ?? (defaults.length ? defaults : offered)
        if (!ids.length) continue

        let row = byPlan.get(pair.provider)
        if (!row) {
            row = {
                key: `subscription:${pair.provider}`,
                name: pair.name,
                iconKey: pair.provider,
                kind: "subscription",
                models: [],
            }
            byPlan.set(pair.provider, row)
            rows.push(row)
        }

        const identity = {key: row.key, name: row.name}
        for (const id of ids) {
            row.models.push(
                modelRow({
                    modelId: id,
                    harness: pair.harness,
                    capabilities,
                    mode: "self_managed",
                    slug: null,
                    provider: pair.provider,
                    connection: identity,
                }),
            )
        }
    }

    return rows.filter((row) => row.models.length)
}

/** One row per subscription the deployment could be signed in to. */
const subscriptionRows = ({
    capabilities,
    harnessIds,
    showSubscriptions = true,
}: Omit<BuildPickerRowsArgs, "connections">): PickerConnectionRow[] => {
    const rows: PickerConnectionRow[] = []
    if (!showSubscriptions) return rows

    // Keyed by the PLAN, not the harness: one Claude plan driven by two harnesses is one row whose
    // flyout splits into two harness sections, never two rows offering the same subscription twice.
    const byPlan = new Map<string, PickerConnectionRow>()

    for (const harness of harnessIds) {
        const meta = SUBSCRIPTION_HARNESSES[harness]
        const caps = capabilities?.[harness]
        if (!meta || !caps?.connection_modes?.includes("self_managed")) continue

        const ids = caps.models?.[meta.family] ?? []
        if (!ids.length) continue

        let row = byPlan.get(meta.family)
        if (!row) {
            row = {
                key: `subscription:${meta.family}`,
                name: subscriptionPlanName(meta.family),
                iconKey: meta.family,
                kind: "subscription",
                models: [],
            }
            byPlan.set(meta.family, row)
            rows.push(row)
        }

        const identity = {key: row.key, name: row.name}
        for (const id of ids) {
            row.models.push(
                modelRow({
                    modelId: id,
                    harness,
                    capabilities,
                    mode: "self_managed",
                    slug: null,
                    // Always set: a self_managed pick with no family leaves the server to guess
                    // one, and the harness/provider pair check then rejects the run.
                    provider: meta.family,
                    connection: identity,
                }),
            )
        }
    }

    return rows
}

/**
 * The picker's first level: every stored connection, then every subscription.
 *
 * The runner's live pairs decide the subscription rows when it has answered; until then (and on an
 * old or unreachable runner) the static mapping stands in, so the menu holds its shape rather than
 * losing rows while a check is in flight.
 */
export const buildConnectionPickerRows = (args: BuildPickerRowsArgs): PickerConnectionRow[] => {
    const {capabilities, showSubscriptions = true, subscriptionPairs, pairModelSelection} = args
    const live =
        showSubscriptions && subscriptionPairs?.length
            ? subscriptionRowsFromPairs({
                  capabilities,
                  pairs: subscriptionPairs,
                  pairModelSelection,
              })
            : null

    return [...connectionRows(args), ...(live ?? subscriptionRows(args))]
}

/** The metadata a picked option carries back, so a selection never has to be guessed by model id. */
export interface PickerOptionMetadata extends Record<string, unknown> {
    connectionSlug?: string
    connectionMode: ConnectionMode
    harness: string
    provider?: string
}

/**
 * A model row's identity within the picker. One model can appear under several harnesses in the
 * same connection, so the model id alone is not unique.
 */
export const modelRowKey = (connectionKey: string, model: PickerModelRow): string =>
    `${connectionKey}:${model.harness}:${model.modelId}`

/**
 * The row the stored config points at: the exact model, harness and connection when one matches,
 * else the same model on the same harness, else the same model anywhere (a config saved before
 * slugs, or through a connection since renamed).
 */
export const selectedModelRowKey = (
    rows: PickerConnectionRow[],
    current: {
        modelId: string | null
        slug: string | null
        mode: ConnectionMode
        harness: string | null
    },
): string | undefined => {
    if (!current.modelId) return undefined
    const all = rows.flatMap((row) => row.models.map((model) => ({key: row.key, model})))
    const sameModel = all.filter((entry) => entry.model.modelId === current.modelId)
    const sameHarness = current.harness
        ? sameModel.filter((entry) => entry.model.harness === current.harness)
        : sameModel
    const pool = sameHarness.length ? sameHarness : sameModel
    const match =
        pool.find(
            (entry) =>
                entry.model.mode === current.mode &&
                (entry.model.slug ?? null) === (current.slug ?? null),
        ) ?? pool[0]
    return match ? modelRowKey(match.key, match.model) : undefined
}

/** What a picked row persists: the model AND the harness it belongs to, in one selection. */
export const selectionFromModelRow = (model: PickerModelRow): PickerSelection => ({
    modelId: model.modelId,
    provider: model.provider,
    mode: model.mode,
    slug: model.slug,
    harness: model.harness,
})

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
