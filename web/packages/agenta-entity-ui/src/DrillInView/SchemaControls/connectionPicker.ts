/**
 * Presentation adapter for the connection-first agent model picker.
 *
 * Runnable candidates and their ordering live in `@agenta/entities/secret`, where both new-agent
 * creation and non-UI gates can consume the same rules. This module adds labels, groups candidates
 * into connection rows, and translates picker metadata back into a persisted selection.
 */
import {
    agentModelSelectionIsRunnable,
    bareModelId,
    connectionModelIds,
    effectiveHarnesses,
    firstAgentModelForConnection,
    isSubscriptionConnection,
    MOUNTED_SUBSCRIPTION_SOURCE,
    mountedSubscriptionDisplayName,
    resolveAgentModelSelection,
    SecretKind,
    SUBSCRIPTION_SIGN_IN_HINT,
    subscriptionAvailability,
    subscriptionPlanName,
    connectionNamespaceFrom,
    type AgentConnectionNamespace,
    type AgentModelCandidate,
    type AgentModelSelection,
    type ProviderConnection,
} from "@agenta/entities/secret"

import {modelDisplayName, type ConnectionMode, type HarnessCapabilitiesMap} from "./connectionUtils"
import {harnessMetaFor} from "./harnessMeta"

export {connectionModelIds, effectiveHarnesses}

export interface PickerModelRow {
    modelId: string
    label: string
    harness: string
    harnessLabel: string
    mode: ConnectionMode
    slug: string | null
    namespace: AgentConnectionNamespace | null
    provider: string | null
    connectionKey: string
    connectionName: string
}

export interface PickerConnectionRow {
    key: string
    name: string
    iconKey: string
    kind: "connection" | "subscription"
    managed?: boolean
    /** The row is shown but cannot be picked — a hosted subscription whose sign-in is not usable. */
    disabled?: boolean
    /** One short line under the name, saying why the row is disabled. */
    hint?: string
    /**
     * Where the row's login comes from, shown under a short `name`. Only a mounted subscription
     * sets it, and only when a hosted subscription to the same plan is in the same picker.
     */
    source?: string
    /** An organization connection: listed after the project's, and tagged as the organization's. */
    organization?: boolean
    models: PickerModelRow[]
}

export interface PickerSelection {
    modelId: string
    provider: string | null
    mode: ConnectionMode
    slug: string | null
    namespace: AgentConnectionNamespace | null
    /** Null is retained only for metadata from the legacy pre-connection picker. */
    harness: string | null
}

export interface BuildPickerRowsArgs {
    candidates: readonly AgentModelCandidate[]
    connections: readonly ProviderConnection[]
    capabilities: HarnessCapabilitiesMap | null | undefined
    /**
     * The harnesses this picker's agent can run, when the caller narrowed the candidates to them.
     * Only the sign-in-needed row reads it, so it stays quiet about a subscription this agent could
     * not drive even after a sign-in. Absent means no narrowing, and every subscription may speak.
     */
    harnessIds?: readonly string[]
}

/** A mounted subscription: no stored record and no built-in name, only the deployment's login. */
const isMountedSubscription = (
    candidate: AgentModelCandidate,
    connection: ProviderConnection | undefined,
): boolean => !connection && !candidate.connectionName

/**
 * What a candidate's row is called.
 *
 * A candidate backed by a stored record uses the record's own name; a built-in model carries its
 * own. Only a MOUNTED subscription has neither. It is called by its plan name, and says where it
 * comes from only when `hostedFamilies` holds its plan: a picker that also lists a hosted
 * subscription to the same plan would otherwise show two rows called "ChatGPT · Subscription".
 */
const candidateRowName = (
    candidate: AgentModelCandidate,
    connection: ProviderConnection | undefined,
    hostedFamilies: ReadonlySet<string>,
): string =>
    connection?.name ??
    candidate.connectionName ??
    mountedSubscriptionDisplayName(candidate.provider ?? "", hostedFamilies)

const rowFromCandidate = (
    candidate: AgentModelCandidate,
    connection: ProviderConnection | undefined,
    hostedFamilies: ReadonlySet<string>,
): PickerConnectionRow => ({
    key: candidate.connectionKey,
    // A duplicate splits the long name in two, so the plan name fits beside the narrow column's tag.
    ...(isMountedSubscription(candidate, connection)
        ? {
              name: subscriptionPlanName(candidate.provider ?? ""),
              ...(hostedFamilies.has(candidate.provider ?? "")
                  ? {source: MOUNTED_SUBSCRIPTION_SOURCE}
                  : {}),
          }
        : {name: candidateRowName(candidate, connection, hostedFamilies)}),
    // A built-in model has no stored connection; it runs on Agenta's account.
    iconKey:
        candidate.managed || (!connection && candidate.connectionName)
            ? "agenta"
            : (connection?.kind ?? candidate.provider ?? ""),
    kind: candidate.source,
    managed: candidate.managed || undefined,
    ...(connection?.scope === "organization" ? {organization: true} : {}),
    models: [],
})

const modelFromCandidate = (
    candidate: AgentModelCandidate,
    capabilities: HarnessCapabilitiesMap | null | undefined,
    connection: ProviderConnection | undefined,
    hostedFamilies: ReadonlySet<string>,
): PickerModelRow => {
    const catalogLabel = modelDisplayName(capabilities, candidate.harness, candidate.modelId)
    const label =
        connection?.secretKind === SecretKind.ProviderKey && catalogLabel === candidate.modelId
            ? bareModelId(candidate.modelId, connection.kind)
            : catalogLabel

    return {
        modelId: candidate.modelId,
        label,
        harness: candidate.harness,
        harnessLabel: harnessMetaFor(candidate.harness).label,
        mode: candidate.mode,
        slug: candidate.slug,
        namespace: candidate.namespace ?? null,
        provider: candidate.provider,
        connectionKey: candidate.connectionKey,
        connectionName: candidateRowName(candidate, connection, hostedFamilies),
    }
}

/**
 * The row a hosted subscription shows while its sign-in cannot run anything.
 *
 * It contributes no candidates, so without this it would vanish from the picker exactly when the
 * user needs to be told why. The row is disabled and says "Sign in needed"; the AI providers page
 * is where the sign-in is done.
 */
const disabledSubscriptionRow = (connection: ProviderConnection): PickerConnectionRow => ({
    key: connection.id,
    name: connection.name,
    iconKey: connection.kind,
    kind: "subscription",
    disabled: true,
    hint: SUBSCRIPTION_SIGN_IN_HINT,
    ...(connection.scope === "organization" ? {organization: true} : {}),
    models: [],
})

/** Every connection in source order, with its model/harness candidates in deterministic order. */
export const buildConnectionPickerRows = (args: BuildPickerRowsArgs): PickerConnectionRow[] => {
    const rows: PickerConnectionRow[] = []
    const byKey = new Map<string, PickerConnectionRow>()
    const connections = new Map(args.connections.map((connection) => [connection.id, connection]))
    const candidateKeys = new Set(args.candidates.map((candidate) => candidate.connectionKey))

    // Only a sign-in the user can act on earns a row without candidates. A READY subscription with
    // no candidates was dropped for another reason, and a row this agent cannot drive has nothing
    // to say.
    const disabledSubscriptions = args.connections.filter(
        (connection) =>
            isSubscriptionConnection(connection) &&
            !candidateKeys.has(connection.id) &&
            subscriptionAvailability(connection, args.harnessIds) === "sign_in_needed",
    )

    // The plans a hosted subscription row in THIS picker carries, enabled or not. A mounted row of
    // one of them is the duplicate that has to say where it comes from.
    const hostedFamilies = new Set(
        [
            ...args.connections.filter(
                (connection) =>
                    isSubscriptionConnection(connection) && candidateKeys.has(connection.id),
            ),
            ...disabledSubscriptions,
        ].map((connection) => connection.kind),
    )

    for (const candidate of args.candidates) {
        const connection = connections.get(candidate.connectionKey)
        let row = byKey.get(candidate.connectionKey)
        if (!row) {
            row = rowFromCandidate(candidate, connection, hostedFamilies)
            byKey.set(candidate.connectionKey, row)
            rows.push(row)
        }
        row.models.push(
            modelFromCandidate(candidate, args.capabilities, connection, hostedFamilies),
        )
    }

    for (const connection of disabledSubscriptions) {
        rows.push(disabledSubscriptionRow(connection))
    }

    // The organization connections this project may use come after the project's own rows, in
    // their own order (a stable partition).
    return [...rows.filter((row) => !row.organization), ...rows.filter((row) => row.organization)]
}

export interface PickerOptionMetadata extends Record<string, unknown> {
    connectionSlug?: string
    connectionNamespace?: AgentConnectionNamespace
    connectionMode: ConnectionMode
    harness: string
    provider?: string
}

export const modelRowKey = (connectionKey: string, model: PickerModelRow): string =>
    `${connectionKey}:${model.harness}:${model.modelId}`

/**
 * Resolve the stored row for display. The exact route wins; legacy configurations without a slug
 * fall back to the same model/harness and then the same model anywhere.
 */
export const selectedModelRowKey = (
    rows: PickerConnectionRow[],
    current: {
        modelId: string | null
        slug: string | null
        namespace?: AgentConnectionNamespace | null
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
    const exact = pool.find(
        (entry) =>
            entry.model.mode === current.mode &&
            (entry.model.slug ?? null) === (current.slug ?? null) &&
            entry.model.namespace === (current.namespace ?? null),
    )
    // An organization connection the agent can no longer use is not stood in for by another
    // connection that offers the same model: the agent uses exactly the one it named.
    const match = exact ?? (current.namespace === "organization" ? undefined : pool[0])
    return match ? modelRowKey(match.key, match.model) : undefined
}

/**
 * The built-in model a retired starter-credits model runs on. The transfer job deletes the seeded
 * "Agenta" connection (slug `starter-credits`) and the gateway resolves a saved agent's model to
 * `builtin/agenta` at run time (`RETIRED_STARTER_CREDITS_MODEL_ALIASES` in the API), so the picker shows
 * that row instead of a raw id no row matches. Display only: the saved config is not rewritten.
 */
const RETIRED_STARTER_CREDITS_SLUG = "starter-credits"
const RETIRED_STARTER_CREDITS_MODEL_ALIASES: Readonly<Record<string, string>> = {
    "Agenta/custom/vertex_ai/gemini-3.7-flash": "google/gemini-3.7-flash",
    "vertex_ai/gemini-3.7-flash": "google/gemini-3.7-flash",
}

/**
 * The row to show for the stored selection, and the model id that row stands for. Only the shape
 * the gateway aliases (an `agenta`-mode pick on the custom `starter-credits` slug) maps, only when
 * the vault holds no connection under that slug (the gateway checks the same), and only to the
 * exact built-in row: never to another connection that happens to offer the same model.
 */
export const displayedModelRow = (
    rows: PickerConnectionRow[],
    current: Parameters<typeof selectedModelRowKey>[1],
    vaultSlugs: readonly (string | undefined)[],
): {key: string | undefined; modelId: string | null} => {
    const key = selectedModelRowKey(rows, current)
    const builtinModelId =
        current.slug === RETIRED_STARTER_CREDITS_SLUG &&
        current.mode === "agenta" &&
        (current.namespace ?? "custom") === "custom" &&
        !vaultSlugs.includes(RETIRED_STARTER_CREDITS_SLUG) &&
        current.modelId
            ? RETIRED_STARTER_CREDITS_MODEL_ALIASES[current.modelId]
            : undefined
    if (!builtinModelId) return {key, modelId: current.modelId}
    // The vault holds no `starter-credits` connection, so any `key` above is another connection's
    // row that offers the same model id, not the route the gateway runs.
    const builtin = rows
        .flatMap((row) => row.models.map((model) => ({key: row.key, model})))
        .find(
            ({model}) =>
                model.namespace === "builtin" &&
                model.slug === "agenta" &&
                model.modelId === builtinModelId &&
                (!current.harness || model.harness === current.harness),
        )
    return builtin
        ? {key: modelRowKey(builtin.key, builtin.model), modelId: builtinModelId}
        : {key, modelId: current.modelId}
}

export const selectionFromModelRow = (model: PickerModelRow): PickerSelection => ({
    modelId: model.modelId,
    provider: model.provider,
    mode: model.mode,
    slug: model.slug,
    namespace: model.namespace,
    harness: model.harness,
})

const selectionFromCandidate = (candidate: AgentModelCandidate): PickerSelection => ({
    modelId: candidate.modelId,
    provider: candidate.provider,
    mode: candidate.mode,
    slug: candidate.slug,
    namespace: candidate.namespace ?? null,
    harness: candidate.harness,
})

const completeSelection = (
    selection: PickerSelection | null | undefined,
): AgentModelSelection | null =>
    selection?.harness
        ? {
              modelId: selection.modelId,
              provider: selection.provider,
              mode: selection.mode,
              slug: selection.slug,
              namespace: selection.namespace,
              harness: selection.harness,
          }
        : null

const candidatesFromRows = (rows: readonly PickerConnectionRow[]): AgentModelCandidate[] =>
    rows.flatMap((row) =>
        row.models.map((model) => ({
            ...completeSelection(selectionFromModelRow(model))!,
            source: row.kind,
            connectionKey: row.key,
            managed: !!row.managed,
        })),
    )

export const pickerSelectionIsRunnable = (
    rows: readonly PickerConnectionRow[],
    selection: PickerSelection | null | undefined,
): boolean =>
    agentModelSelectionIsRunnable(
        rows
            .flatMap((row) => row.models.map(selectionFromModelRow))
            .flatMap((item) => {
                const complete = completeSelection(item)
                return complete ? [complete] : []
            }),
        completeSelection(selection),
    )

export const firstPickerSelectionForConnection = (
    rows: readonly PickerConnectionRow[],
    connectionId: string | null | undefined,
): PickerSelection | null => {
    const candidate = firstAgentModelForConnection(candidatesFromRows(rows), connectionId)
    return candidate ? selectionFromCandidate(candidate) : null
}

/** Resolve the effect of saving a provider without mistaking the newly usable placeholder for a choice. */
export const pickerSelectionAfterProviderSave = ({
    rows,
    replaceable,
    savedConnectionId,
    previousConnectionKeys,
    current,
    currentWasRunnable,
}: {
    rows: readonly PickerConnectionRow[]
    replaceable: boolean
    savedConnectionId?: string | null
    previousConnectionKeys: readonly string[]
    current?: PickerSelection | null
    currentWasRunnable: boolean
}): PickerSelection | null => {
    if (!replaceable || (currentWasRunnable && pickerSelectionIsRunnable(rows, current))) {
        return null
    }
    const known = new Set(previousConnectionKeys)
    const connectionId =
        savedConnectionId ??
        rows.find((row) => row.kind === "connection" && !known.has(row.key))?.key
    return firstPickerSelectionForConnection(rows, connectionId)
}

/** Explicit valid choice, then valid last choice, then first managed route, then first. */
export const resolvePickerSelection = ({
    rows,
    explicit,
    last,
}: {
    rows: readonly PickerConnectionRow[]
    explicit?: PickerSelection | null
    last?: PickerSelection | null
}): PickerSelection | null => {
    const candidate = resolveAgentModelSelection({
        candidates: candidatesFromRows(rows),
        explicit: completeSelection(explicit),
        last: completeSelection(last),
    })
    return candidate ? selectionFromCandidate(candidate) : null
}

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
        // A slug survives in either mode. Under `self_managed` it names a hosted subscription's
        // stored sign-in; dropping it there sent the run to whatever login the deployment mounted.
        slug: read("connectionSlug"),
        // An organization connection keeps its namespace in either mode: it is what names the
        // organization's connection rather than the project's.
        namespace:
            mode === "agenta" || read("connectionNamespace") === "organization"
                ? connectionNamespaceFrom(read("connectionNamespace"))
                : null,
        harness: read("harness"),
    }
}
