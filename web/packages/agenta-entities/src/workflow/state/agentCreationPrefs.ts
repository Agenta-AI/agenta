/**
 * Agent creation preferences — the user's last-used harness/model/connection, persisted so a NEW
 * agent defaults to it instead of only the backend template. Captured when the Model & harness
 * section is saved (AgentTemplateControl.saveSection); applied when a new agent ephemeral is
 * minted (createEphemeralAppFromTemplate, appUtils.ts). Versioned for future shape migrations.
 */
import {atomWithStorage} from "jotai/utils"

import {
    SecretKind,
    SecretManagementPolicy,
    connectionSlugFor,
    type ProviderConnection,
} from "../../secret/core"

export interface AgentCreationPrefs {
    version: 1
    harness?: string
    model?: string
    provider?: string
    connectionMode?: string
}

const DEFAULT_PREFS: AgentCreationPrefs = {version: 1}

export const agentCreationPrefsAtom = atomWithStorage<AgentCreationPrefs>(
    "agenta:agent-creation-prefs",
    DEFAULT_PREFS,
    undefined,
    {getOnInit: true},
)

/**
 * Overlay saved prefs onto a fresh agent template's config (`parameters.agent`). Only sets fields
 * the prefs actually carry — the template stays the base for everything else. No harness-catalog
 * validation here: the capability map isn't at hand at ephemeral-mint time without a fresh fetch,
 * so a stale/unknown harness pref is written through as-is rather than silently dropped.
 */
export function applyAgentCreationPrefs(
    agentConfig: Record<string, unknown>,
    prefs: AgentCreationPrefs,
): Record<string, unknown> {
    const next = {...agentConfig}

    if (prefs.harness) {
        const harness =
            next.harness && typeof next.harness === "object" && !Array.isArray(next.harness)
                ? (next.harness as Record<string, unknown>)
                : {}
        next.harness = {...harness, kind: prefs.harness}
    }

    if (prefs.model || prefs.provider || prefs.connectionMode) {
        const llm =
            next.llm && typeof next.llm === "object" && !Array.isArray(next.llm)
                ? (next.llm as Record<string, unknown>)
                : {}
        const nextLlm: Record<string, unknown> = {...llm}
        if (prefs.model) nextLlm.model = prefs.model
        if (prefs.provider) nextLlm.provider = prefs.provider
        if (prefs.connectionMode) {
            const connection =
                llm.connection &&
                typeof llm.connection === "object" &&
                !Array.isArray(llm.connection)
                    ? (llm.connection as Record<string, unknown>)
                    : {}
            nextLlm.connection = {...connection, mode: prefs.connectionMode}
        }
        next.llm = nextLlm
    }

    return next
}

/** The object at `key`, or `{}` when the config carries nothing usable there. */
const objectAt = (config: Record<string, unknown>, key: string): Record<string, unknown> => {
    const value = config[key]
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {}
}

/**
 * A connection's own model ids. A credential-set (custom) connection publishes `model_keys`, whose
 * spelling names the connection and which the resolver rewrites itself; everything else publishes
 * plain saved models.
 */
const connectionModelIds = (connection: ProviderConnection): string[] =>
    (connection.secretKind === SecretKind.CustomProvider
        ? (connection.source.modelKeys ?? connection.models)
        : connection.models) ?? []

/**
 * Default a new agent onto an Agenta-managed connection when its template provider has no key.
 *
 * The backend template hard-codes a provider/model pair, so a project whose only credentials are
 * ones protected by the manager-only policy mints an agent pointing at a provider the user has
 * never connected — it paints a "Connect key" warning and cannot run until they configure one.
 * Repoint it at the managed connection's first model, addressed by slug.
 *
 * Only the untouched default is rewritten: a config already naming a connection slug, or running
 * on self-managed credentials, is the user's own choice (or their saved prefs) and is left alone.
 * Likewise when the template's provider IS connected with the user's own key.
 *
 * No `provider` is written. The slug is the whole routing identity of a managed connection, and a
 * provider on a named custom connection becomes a model-id prefix the resolver cannot match — the
 * same reason `vaultPickedProviderFamily` omits it for a picked custom model.
 */
export function applyManagedConnectionDefault(
    agentConfig: Record<string, unknown>,
    connections: ProviderConnection[],
): Record<string, unknown> {
    const llm = objectAt(agentConfig, "llm")
    const connection = objectAt(llm, "connection")
    const mode = typeof connection.mode === "string" ? connection.mode : "agenta"
    const slug = typeof connection.slug === "string" ? connection.slug.trim() : ""
    if (mode !== "agenta" || slug) return agentConfig

    const provider = typeof llm.provider === "string" ? llm.provider.trim().toLowerCase() : ""
    const userConnected = connections.some(
        (candidate) =>
            candidate.managementPolicy !== SecretManagementPolicy.ManagerOnly &&
            candidate.hasStoredCredential &&
            !!provider &&
            candidate.kind.toLowerCase() === provider,
    )
    if (userConnected) return agentConfig

    const managed = connections.find(
        (candidate) =>
            candidate.managementPolicy === SecretManagementPolicy.ManagerOnly &&
            !!connectionSlugFor(candidate) &&
            connectionModelIds(candidate).length > 0,
    )
    if (!managed) return agentConfig

    const nextLlm: Record<string, unknown> = {
        ...llm,
        model: connectionModelIds(managed)[0],
        connection: {...connection, mode: "agenta", slug: connectionSlugFor(managed)},
    }
    delete nextLlm.provider
    return {...agentConfig, llm: nextLlm}
}

/**
 * Ensure a new agent's `sandbox.kind` is one the deployment actually enables. The template default
 * is `local` (SDK `AgentTemplate.sandbox`), which is also the runtime default when no kind is set.
 * A deployment that doesn't enable `local` (e.g. daytona-only) would otherwise COMMIT an unrunnable
 * `local` config, and the playground's Advanced section then auto-rewrites it to an enabled provider
 * on open — diverging from the just-committed value and surfacing a phantom "Unsaved advanced-setting
 * changes" draft on a freshly created agent. Coercing at mint time keeps the committed config valid,
 * so there is nothing for the panel to rewrite.
 *
 * `enabledProviders` is the deployment's enabled set (`getEnabledSandboxProviders()`), injected so
 * this stays a pure, testable transform. Only touches the config when the effective kind isn't
 * enabled; leaves it byte-for-byte otherwise (no spurious `sandbox` section on the common path).
 */
export function ensureEnabledSandbox(
    agentConfig: Record<string, unknown>,
    enabledProviders: string[],
): Record<string, unknown> {
    if (enabledProviders.length === 0) return agentConfig
    const sandbox =
        agentConfig.sandbox &&
        typeof agentConfig.sandbox === "object" &&
        !Array.isArray(agentConfig.sandbox)
            ? (agentConfig.sandbox as Record<string, unknown>)
            : {}
    // Unset kind runs as `local` (SDK/runtime default), so treat that as the effective selection.
    const effectiveKind = typeof sandbox.kind === "string" ? sandbox.kind : "local"
    if (enabledProviders.includes(effectiveKind)) return agentConfig
    return {...agentConfig, sandbox: {...sandbox, kind: enabledProviders[0]}}
}
