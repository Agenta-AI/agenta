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

// "pi_agenta" is a removed experiment; filter it defensively in case an older API still lists it.
export const selectableAgentHarnesses = (harnessIds: string[]): string[] =>
    harnessIds.filter((id) => id !== "pi_agenta")

/**
 * The OpenAI-compatible deployment surface, and the family a route through it falls back to.
 *
 * A `custom` record is an endpoint address, not a protocol declaration. Agenta's form calls it the
 * OpenAI-compatible endpoint and the SDK resolver defaults a custom route it cannot otherwise place
 * to `openai`. The very same record is an Anthropic gateway when the model names that family, so
 * the fallback is a default and never a fact.
 */
const CUSTOM_KIND = "custom"
const CUSTOM_FALLBACK_FAMILY = "openai"

/**
 * A model key with its storage namespace removed.
 *
 * The API stores a custom connection's models as `<provider-slug>/<kind>/<model-slug>`, so the
 * first token names the CONNECTION and says nothing about the model. A connection called "openai"
 * holding `anthropic/claude-fable-5` would otherwise read as an openai model, and one called
 * "anthropic" holding `openai/gpt-4o-mini` as an anthropic one. Both are realistic names.
 *
 * Matched on the shape rather than on an identity, because the stored namespace is the header name
 * and the record's stable slug is a different, suffixed string. The second segment is the kind, so
 * that is what says a prefix is the namespace and not part of the model id.
 */
const withoutConnectionNamespace = (id: string, connection: ProviderConnection): string => {
    // The saved model slugs are the authority, the same way `selected_model_id` reads a key in the
    // SDK. A header name is free text and may itself contain "/", so counting segments is not
    // enough. Longest match wins, so a shorter slug never truncates a longer one.
    const matched = (connection.models ?? []).filter(
        (slug) => slug && (id === slug || id.endsWith(`/${slug}`)),
    )
    if (matched.length) return matched.reduce((a, b) => (b.length > a.length ? b : a))

    // A legacy record keeps only the keys. Fall back to the storage shape, whose second segment is
    // the kind: `<provider-slug>/<kind>/<model-slug>`.
    const parts = id.split("/")
    const kind = (connection.kind ?? "").toLowerCase()
    if (parts.length < 3 || !kind || parts[1].toLowerCase() !== kind) return id
    return parts.slice(2).join("/")
}

/**
 * The provider family a harness accepts through the `custom` surface, or null when it accepts none.
 *
 * Mirrors `HARNESS_CUSTOM_DEPLOYMENT_PROVIDERS` in the SDK, which the catalog does not publish, and
 * derives it from what the catalog does publish: a harness that reaches `openai` speaks the
 * OpenAI-compatible dialect, and one that reaches a single other family speaks that. On the shipped
 * catalog this is pi_core and codex to `openai`, claude to `anthropic`, which is the SDK map.
 */
const customRouteFamily = (
    capabilities: HarnessCapabilityMap | null | undefined,
    harness: string,
): string | null => {
    const providers = capabilities?.[harness]?.providers ?? []
    if (providers.some((provider) => provider.toLowerCase() === CUSTOM_FALLBACK_FAMILY)) {
        return CUSTOM_FALLBACK_FAMILY
    }
    return soleAgentHarnessProviderFamily(capabilities, harness)
}

/**
 * Whether one model on a custom connection is a route this harness is offered by default.
 *
 * Asymmetric, because the two kinds of route are not the same claim. An OpenAI-compatible route
 * takes every model: that IS what the surface means, and a gateway serving Mistral or DeepSeek over
 * the OpenAI wire format is ordinary. Any other route is a claim about the endpoint's protocol, and
 * the model naming that vendor is the only evidence a vault record carries.
 *
 * A default, not a verdict. A model's upstream vendor does not establish the endpoint's protocol: a
 * LiteLLM gateway serves OpenAI-named models over the Anthropic Messages endpoint for exactly this
 * harness. So a saved harness policy is taken at its word and skips this check entirely; only a
 * connection with no policy is decided here.
 *
 * Per model, not per connection: on a mixed gateway with no policy, one Anthropic id must not hand
 * Claude Code the OpenAI ids beside it (issue #6692).
 */
const customRouteAdmitsModel = (
    capabilities: HarnessCapabilityMap | null | undefined,
    harness: string,
    family: string | null,
): boolean => {
    const route = customRouteFamily(capabilities, harness)
    if (!route) return false
    if (route === CUSTOM_FALLBACK_FAMILY) return true
    return family === route
}

/**
 * The provider to persist for a custom pick, so the SDK resolves the route the picker offered.
 *
 * Null where the resolver's own default already answers, which keeps every existing OpenAI-compatible
 * pick byte-identical. A Claude Code route needs `anthropic` written, or the resolver defaults the
 * pair to `openai` and the harness refuses it.
 */
const customRouteProvider = (
    capabilities: HarnessCapabilityMap | null | undefined,
    harness: string,
): string | null => {
    const route = customRouteFamily(capabilities, harness)
    return route && route !== CUSTOM_FALLBACK_FAMILY ? route : null
}

/**
 * The harnesses a connection may be used from: the user's saved policy, if any, intersected with
 * what the harness can technically drive. Which of a custom connection's MODELS each harness is
 * then offered is `connectionCandidates` below.
 */
export const effectiveHarnesses = (
    connection: ProviderConnection,
    capabilities: HarnessCapabilityMap | null | undefined,
    harnessIds: string[],
): string[] => {
    const allowed = Array.isArray(connection.harnesses) ? connection.harnesses : harnessIds
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
        const customKind = (connection.kind ?? "").toLowerCase() === CUSTOM_KIND
        const savedPolicy = Array.isArray(connection.harnesses)
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
                // A custom connection's endpoint dialect is unknown, so with no saved policy each
                // model is admitted on the family its own id names (#6692). A policy is the user's
                // own statement about the endpoint and skips the check: the vendor a model comes
                // from says nothing about the protocol a translating gateway speaks.
                if (customKind && !savedPolicy) {
                    const family = agentFamilyFromModelId(
                        withoutConnectionNamespace(id, connection),
                        capabilities,
                    )
                    if (!customRouteAdmitsModel(capabilities, harness, family)) continue
                }
                candidates.push({
                    modelId: id,
                    provider: customKind
                        ? customRouteProvider(capabilities, harness)
                        : agentVaultProviderFamily(id, connection.kind, capabilities, harness),
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
