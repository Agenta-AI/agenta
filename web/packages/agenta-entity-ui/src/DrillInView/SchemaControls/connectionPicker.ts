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
    mountedSubscriptionName,
    resolveAgentModelSelection,
    SecretKind,
    SUBSCRIPTION_SIGN_IN_HINT,
    subscriptionAvailability,
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
    models: PickerModelRow[]
}

export interface PickerSelection {
    modelId: string
    provider: string | null
    mode: ConnectionMode
    slug: string | null
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

/**
 * What a candidate's row is called.
 *
 * A candidate backed by a stored record uses the record's own name. Only a MOUNTED subscription
 * has no record, and that fallback has to say so: a project that also holds a hosted subscription
 * to the same plan would otherwise show two rows called "ChatGPT · Subscription".
 */
const candidateRowName = (
    candidate: AgentModelCandidate,
    connection: ProviderConnection | undefined,
): string => connection?.name ?? mountedSubscriptionName(candidate.provider ?? "")

const rowFromCandidate = (
    candidate: AgentModelCandidate,
    connection: ProviderConnection | undefined,
): PickerConnectionRow => ({
    key: candidate.connectionKey,
    name: candidateRowName(candidate, connection),
    iconKey: candidate.managed ? "agenta" : (connection?.kind ?? candidate.provider ?? ""),
    kind: candidate.source,
    managed: candidate.managed || undefined,
    models: [],
})

const modelFromCandidate = (
    candidate: AgentModelCandidate,
    capabilities: HarnessCapabilitiesMap | null | undefined,
    connection: ProviderConnection | undefined,
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
        provider: candidate.provider,
        connectionKey: candidate.connectionKey,
        connectionName: candidateRowName(candidate, connection),
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
    models: [],
})

/** Every connection in source order, with its model/harness candidates in deterministic order. */
export const buildConnectionPickerRows = (args: BuildPickerRowsArgs): PickerConnectionRow[] => {
    const rows: PickerConnectionRow[] = []
    const byKey = new Map<string, PickerConnectionRow>()
    const connections = new Map(args.connections.map((connection) => [connection.id, connection]))
    for (const candidate of args.candidates) {
        const connection = connections.get(candidate.connectionKey)
        let row = byKey.get(candidate.connectionKey)
        if (!row) {
            row = rowFromCandidate(candidate, connection)
            byKey.set(candidate.connectionKey, row)
            rows.push(row)
        }
        row.models.push(modelFromCandidate(candidate, args.capabilities, connection))
    }

    for (const connection of args.connections) {
        if (!isSubscriptionConnection(connection)) continue
        if (byKey.has(connection.id)) continue
        // Only a sign-in the user can act on earns the row. A READY subscription with no candidates
        // was dropped for another reason, and a row this agent cannot drive has nothing to say.
        if (subscriptionAvailability(connection, args.harnessIds) !== "sign_in_needed") continue
        rows.push(disabledSubscriptionRow(connection))
    }

    return rows
}

export interface PickerOptionMetadata extends Record<string, unknown> {
    connectionSlug?: string
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

export const selectionFromModelRow = (model: PickerModelRow): PickerSelection => ({
    modelId: model.modelId,
    provider: model.provider,
    mode: model.mode,
    slug: model.slug,
    harness: model.harness,
})

const selectionFromCandidate = (candidate: AgentModelCandidate): PickerSelection => ({
    modelId: candidate.modelId,
    provider: candidate.provider,
    mode: candidate.mode,
    slug: candidate.slug,
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
        harness: read("harness"),
    }
}
