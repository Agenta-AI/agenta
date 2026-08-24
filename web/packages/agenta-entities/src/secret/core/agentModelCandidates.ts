import {
    bareModelId,
    harnessSupportsProviderKind,
    providerModelCatalog,
    type HarnessCapabilityMap,
    type ProviderConnection,
} from "./connections"
import {connectionSlugFor} from "./promptModelGroups"
import {subscriptionPairModels, type SubscriptionPair} from "./subscriptionPairs"
import {SecretKind, SecretManagementPolicy} from "./types"

export type AgentConnectionMode = "agenta" | "self_managed"

export interface AgentModelSelection {
    modelId: string
    provider: string | null
    mode: AgentConnectionMode
    slug: string | null
    harness: string
}

export interface AgentModelCandidate extends AgentModelSelection {
    source: "connection" | "subscription"
    connectionKey: string
    managed: boolean
}

export interface BuildAgentModelCandidatesArgs {
    connections: ProviderConnection[]
    capabilities: HarnessCapabilityMap | null | undefined
    harnessIds: string[]
    showSubscriptions?: boolean
    subscriptionPairs?: SubscriptionPair[]
    pairModelSelection?: Record<string, string[] | undefined> | null
}

export const selectableAgentHarnesses = (harnessIds: string[]): string[] =>
    harnessIds.filter((id) => id !== "pi_agenta")

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

export const connectionModelIds = (
    connection: ProviderConnection,
    capabilities: HarnessCapabilityMap | null | undefined,
): string[] => {
    if (connection.secretKind !== SecretKind.ProviderKey) {
        return (connection.source.modelKeys ?? connection.models ?? []).filter(Boolean)
    }
    if (connection.models) return connection.models.filter(Boolean)
    const {models, defaults} = providerModelCatalog(capabilities, connection.kind)
    return defaults.length ? defaults : models
}

export const agentModelSelectionMode = (
    capabilities: HarnessCapabilityMap | null | undefined,
    harness: string,
): string => capabilities?.[harness]?.model_selection ?? "provider/id"

const harnessSpellings = (
    capabilities: HarnessCapabilityMap | null | undefined,
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
        if (entry.provider === family && entry.id) {
            index.set(bareModelId(entry.id, family).toLowerCase(), entry.id)
        }
    }
    return index
}

const uncatalogedSpelling = (
    capabilities: HarnessCapabilityMap | null | undefined,
    harness: string,
    family: string,
    id: string,
): string => {
    const bare = bareModelId(id, family)
    if (!family || agentModelSelectionMode(capabilities, harness) !== "provider/id") return bare
    return `${family}/${bare}`
}

const DEPLOYMENT_KINDS = new Set(["direct", "custom", "azure", "bedrock", "vertex_ai", "sagemaker"])

export const isAgentDeploymentProviderKind = (kind: string | null | undefined): boolean =>
    !!kind && DEPLOYMENT_KINDS.has(kind.toLowerCase())

export const agentFamilyFromModelId = (
    modelId: string | null | undefined,
    capabilities: HarnessCapabilityMap | null | undefined,
): string | null => {
    if (!modelId) return null
    const families = new Set<string>()
    for (const caps of Object.values(capabilities ?? {})) {
        for (const provider of caps.providers ?? []) families.add(provider.toLowerCase())
    }
    for (const token of modelId.toLowerCase().split(/[./]/)) {
        if (families.has(token)) return token
    }
    return null
}

export const soleAgentHarnessProviderFamily = (
    capabilities: HarnessCapabilityMap | null | undefined,
    harness: string | null | undefined,
): string | null => {
    const providers = harness ? (capabilities?.[harness]?.providers ?? []) : []
    return providers.length === 1 ? providers[0] : null
}

export const agentVaultProviderFamily = (
    modelId: string | null | undefined,
    connectionKind: string | null | undefined,
    capabilities: HarnessCapabilityMap | null | undefined,
    harness?: string | null,
): string | null => {
    if (connectionKind?.toLowerCase() === "custom") return null
    const family = agentFamilyFromModelId(modelId, capabilities)
    if (family) return family
    if (connectionKind && !isAgentDeploymentProviderKind(connectionKind)) return connectionKind
    return soleAgentHarnessProviderFamily(capabilities, harness)
}

const connectionCandidates = ({
    connections,
    capabilities,
    harnessIds,
}: BuildAgentModelCandidatesArgs): AgentModelCandidate[] => {
    const candidates: AgentModelCandidate[] = []
    for (const connection of connections) {
        if (!connection.hasStoredCredential) continue
        const harnesses = effectiveHarnesses(connection, capabilities, harnessIds)
        const ids = connectionModelIds(connection, capabilities)
        if (!harnesses.length || !ids.length) continue

        const slug = connectionSlugFor(connection)
        const standard = connection.secretKind === SecretKind.ProviderKey
        const savedModels = Boolean(connection.models)
        const managed = connection.managementPolicy === SecretManagementPolicy.ManagerOnly

        for (const harness of harnesses) {
            if (standard) {
                const spellings = harnessSpellings(capabilities, harness, connection.kind)
                for (const id of ids) {
                    const catalogued = spellings.get(bareModelId(id, connection.kind).toLowerCase())
                    if (!catalogued && !savedModels) continue
                    const modelId =
                        catalogued ??
                        uncatalogedSpelling(capabilities, harness, connection.kind, id)
                    candidates.push({
                        modelId,
                        provider: connection.kind,
                        mode: "agenta",
                        slug,
                        harness,
                        source: "connection",
                        connectionKey: connection.id,
                        managed,
                    })
                }
                continue
            }

            for (const id of ids) {
                candidates.push({
                    modelId: id,
                    provider: agentVaultProviderFamily(id, connection.kind, capabilities, harness),
                    mode: "agenta",
                    slug,
                    harness,
                    source: "connection",
                    connectionKey: connection.id,
                    managed,
                })
            }
        }
    }
    return candidates
}

const liveSubscriptionCandidates = ({
    capabilities,
    harnessIds,
    subscriptionPairs,
    pairModelSelection,
}: BuildAgentModelCandidatesArgs): AgentModelCandidate[] => {
    const candidates: AgentModelCandidate[] = []
    for (const pair of subscriptionPairs ?? []) {
        if (
            !harnessIds.includes(pair.harness) ||
            !capabilities?.[pair.harness]?.connection_modes?.includes("self_managed")
        )
            continue
        const {models, defaults} = subscriptionPairModels(capabilities, pair)
        const chosen = pairModelSelection?.[pair.key]
        const ids = chosen ?? (defaults.length ? defaults : models)
        for (const modelId of ids) {
            candidates.push({
                modelId,
                provider: pair.provider,
                mode: "self_managed",
                slug: null,
                harness: pair.harness,
                source: "subscription",
                connectionKey: `subscription:${pair.provider}`,
                managed: false,
            })
        }
    }
    return candidates
}

export const buildAgentModelCandidates = (
    args: BuildAgentModelCandidatesArgs,
): AgentModelCandidate[] => {
    const connections = connectionCandidates(args)
    if (args.showSubscriptions === false) return connections
    return [...connections, ...liveSubscriptionCandidates(args)]
}

const findRunnableAgentModel = <T extends AgentModelSelection>(
    candidates: readonly T[],
    selection: AgentModelSelection | null | undefined,
): T | null =>
    selection
        ? (candidates.find(
              (candidate) =>
                  candidate.modelId === selection.modelId &&
                  candidate.provider === selection.provider &&
                  candidate.mode === selection.mode &&
                  candidate.slug === selection.slug &&
                  candidate.harness === selection.harness,
          ) ?? null)
        : null

export const agentModelSelectionIsRunnable = (
    candidates: readonly AgentModelSelection[],
    selection: AgentModelSelection | null | undefined,
): boolean => !!findRunnableAgentModel(candidates, selection)

export const resolveAgentModelSelection = ({
    candidates,
    explicit,
    last,
}: {
    candidates: readonly AgentModelCandidate[]
    explicit?: AgentModelSelection | null
    last?: AgentModelSelection | null
}): AgentModelCandidate | null => {
    for (const selection of [explicit, last]) {
        const match = findRunnableAgentModel(candidates, selection)
        if (match) return match
    }
    return candidates.find((candidate) => candidate.managed) ?? candidates[0] ?? null
}

export const firstAgentModelForConnection = (
    candidates: readonly AgentModelCandidate[],
    connectionId: string | null | undefined,
): AgentModelCandidate | null =>
    connectionId
        ? (candidates.find(
              (candidate) =>
                  candidate.source === "connection" && candidate.connectionKey === connectionId,
          ) ?? null)
        : null
