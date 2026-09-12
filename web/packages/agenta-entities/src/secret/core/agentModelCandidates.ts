import {
    bareModelId,
    customRouteFamily,
    CUSTOM_KIND,
    harnessSupportsProviderKind,
    providerModelCatalog,
    soleAgentHarnessProviderFamily,
    type HarnessCapabilityMap,
    type ProviderConnection,
} from "./connections"
import {connectionSlugFor} from "./promptModelGroups"
import {
    subscriptionHarnesses,
    subscriptionIsReady,
    subscriptionRunProvider,
} from "./subscriptionConnections"
import {subscriptionPairModels, type SubscriptionPair} from "./subscriptionPairs"
import {LlmEndpointProtocol, SecretKind, SecretManagementPolicy} from "./types"

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
 * Whether one model on a custom connection is a route this harness is offered by default.
 *
 * The endpoint's DECLARED protocol answers this outright where the record carries one: it is the
 * operator's own statement about the wire format, which is exactly the fact a model id cannot
 * establish. A LiteLLM gateway serves OpenAI-named models over the Anthropic Messages endpoint.
 *
 * Only a record written before the protocol field existed falls back to the guess below, which is
 * asymmetric because the two kinds of route are not the same claim. An OpenAI-compatible route
 * takes every model: that IS what the surface means, and a gateway serving Mistral or DeepSeek over
 * the OpenAI wire format is ordinary. Any other route is a claim about the endpoint's protocol, and
 * the model naming that vendor is the only evidence such a record carries.
 *
 * Per model, not per connection: on a mixed legacy gateway with no policy, one Anthropic id must
 * not hand Claude Code the OpenAI ids beside it (issue #6692).
 */
const customRouteAdmitsModel = (
    capabilities: HarnessCapabilityMap | null | undefined,
    harness: string,
    family: string | null,
    declared?: LlmEndpointProtocol | null,
): boolean => {
    const route = customRouteFamily(capabilities, harness)
    if (!route) return false
    if (declared) return route === declared
    if (route === LlmEndpointProtocol.Openai) return true
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
    return route && route !== LlmEndpointProtocol.Openai ? route : null
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
            harnessSupportsProviderKind(
                capabilities,
                harness,
                connection.kind,
                connection.protocol,
            ),
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

/**
 * The routes one hosted subscription connection offers.
 *
 * A subscription is `self_managed` with a SLUG: the run carries no key, and the slug is what names
 * the stored sign-in the runner materializes. That is the whole difference from the mounted
 * subscription rows, which are `self_managed` with no slug because nothing is stored.
 *
 * The models come off the record — the plan fixes them and the API writes them — and the provider
 * is whatever the driving harness calls the family (`openai-codex` for Pi).
 */
export const subscriptionConnectionCandidates = ({
    connection,
    capabilities,
    harnessIds,
}: {
    connection: ProviderConnection
    capabilities: HarnessCapabilityMap | null | undefined
    harnessIds: string[]
}): AgentModelCandidate[] => {
    const subscription = connection.subscription
    if (!subscription || !subscriptionIsReady(subscription)) return []

    // The stored slug and nothing else: the resolver selects the sign-in by it, so a name-derived
    // stand-in would name no record and fail the run.
    const slug = connection.slug?.trim()
    if (!slug) return []

    const allowed = subscriptionHarnesses(connection)
    const ids = (connection.models ?? []).filter(Boolean)

    const candidates: AgentModelCandidate[] = []
    for (const harness of harnessIds) {
        if (!allowed.includes(harness)) continue
        if (!capabilities?.[harness]?.connection_modes?.includes("self_managed")) continue
        // A harness with no run-provider name cannot consume this login at all, so it gets no
        // row: the SDK refuses the same pair, and an offered row would only fail the run.
        const runProvider = subscriptionRunProvider(harness, subscription.provider)
        if (!runProvider) continue
        for (const modelId of ids) {
            candidates.push({
                modelId,
                provider: runProvider,
                mode: "self_managed",
                slug,
                harness,
                source: "subscription",
                // The record id, so the row is distinct from the mounted plan's
                // `subscription:<family>` key even when both are present.
                connectionKey: connection.id,
                managed: false,
            })
        }
    }
    return candidates
}

const connectionCandidates = ({
    connections,
    capabilities,
    harnessIds,
}: BuildAgentModelCandidatesArgs): AgentModelCandidate[] => {
    const candidates: AgentModelCandidate[] = []
    for (const connection of connections) {
        if (connection.subscription) {
            candidates.push(
                ...subscriptionConnectionCandidates({connection, capabilities, harnessIds}),
            )
            continue
        }
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
                // With no saved policy, the declared protocol decides; an undeclared (legacy)
                // record falls back to admitting each model on the family its own id names
                // (#6692). A policy is the user's own statement and skips the check: the vendor a
                // model comes from says nothing about the protocol a translating gateway speaks.
                if (customKind && !savedPolicy) {
                    const family = agentFamilyFromModelId(
                        withoutConnectionNamespace(id, connection),
                        capabilities,
                    )
                    if (
                        !customRouteAdmitsModel(capabilities, harness, family, connection.protocol)
                    ) {
                        continue
                    }
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
