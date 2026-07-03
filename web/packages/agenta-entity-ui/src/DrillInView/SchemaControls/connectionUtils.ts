/**
 * connectionUtils
 *
 * Pure helpers for the agent template's model + credential connection (the `agent.llm` object,
 * the `ModelRef` shape from the provider-model-auth project). In this POC the llm value is ALWAYS a
 * structured object — `{provider, model, extras?, connection?: {mode, slug?}}` — never a free-text
 * string. The harness-filtered unified picker (provider + model + authentication + connection) is
 * the only way to set it, and it always produces this object. These helpers translate between the
 * form fields the AgentTemplateControl renders and that on-the-wire object.
 *
 * The per-harness capability surface (which providers/models/connection-modes a harness can reach)
 * is published on the `/inspect` response `meta.harness_capabilities`; the frontend renders from it
 * via the passed-in `HarnessCapabilitiesMap` rather than a static FE copy. When the map is absent
 * (older agents, a standalone control) the helpers fall back permissively.
 *
 * They live in their own module (not inline in AgentTemplateControl) so the package unit tests can
 * import and exercise them without a React harness.
 *
 * Design: docs/design/agent-workflows/projects/agent-model-picker/ (the picker UX + inspect model
 * list) and provider-model-auth/design.md (Concern 1: ModelRef; Concern 3b: per-harness gating).
 */

import type {HarnessCapabilities, HarnessCapabilitiesMap} from "@agenta/entities/workflow"

export type {HarnessCapabilities, HarnessCapabilitiesMap}

/**
 * A connection mode: where the credential comes from. Two modes only — `agenta` (a vault
 * connection; project-default when no slug, named when a slug is set) and `self_managed`
 * (Agenta injects nothing). There is no separate `default` mode.
 */
export type ConnectionMode = "agenta" | "self_managed"

/** The connection fields the form edits, read back from `config.model`. */
export interface ConnectionFields {
    /** Logical provider family (e.g. "openai", "anthropic"); null when not yet picked. */
    provider: string | null
    /** Credential mode. Defaults to "agenta" (the project default). */
    mode: ConnectionMode
    /** Named connection slug; only meaningful when mode === "agenta". */
    slug: string | null
}

/** The structured `agent.llm` object shape (a subset; extra keys round-trip untouched). */
interface ModelRefObject {
    provider?: string | null
    model?: string | null
    extras?: Record<string, unknown>
    connection?: {mode?: string | null; slug?: string | null} | null
    [key: string]: unknown
}

function isModelRefObject(value: unknown): value is ModelRefObject {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function coerceMode(mode: unknown): ConnectionMode {
    // Two modes only; anything else (including the removed "default") maps to "agenta", the
    // project default.
    return mode === "self_managed" ? "self_managed" : "agenta"
}

/**
 * The picked model id from a stored ModelRef. A legacy bare-string `model` is still read (so an
 * older stored config still populates the picker), but the form only ever writes a ModelRef.
 */
export function modelIdFromConfig(model: unknown): string | null {
    if (typeof model === "string") return model || null
    if (isModelRefObject(model)) {
        return typeof model.model === "string" ? model.model : null
    }
    return null
}

/**
 * The connection fields behind a stored ModelRef. A legacy bare string is read as the default
 * (agenta, no slug) connection with no provider; an object exposes its provider and connection.
 */
export function connectionFromConfig(model: unknown): ConnectionFields {
    if (isModelRefObject(model)) {
        const connection = isModelRefObject(model.connection) ? model.connection : {}
        return {
            provider: typeof model.provider === "string" ? model.provider : null,
            mode: coerceMode(connection.mode),
            slug: typeof connection.slug === "string" ? connection.slug : null,
        }
    }
    return {provider: null, mode: "agenta", slug: null}
}

export interface ComposeModelValueArgs {
    modelId: string | null
    provider: string | null
    mode: ConnectionMode
    slug: string | null
    /**
     * The prior `agent.llm` value. When it is a structured object, its extra keys (notably
     * `extras`, set via the raw-JSON hatch) are carried through so a form edit never silently
     * drops them. The form-managed keys (model/provider/connection) are then overwritten.
     */
    existing?: unknown
}

const FORM_MANAGED_KEYS = new Set(["model", "provider", "connection"])

/**
 * Compose the `config.model` ModelRef the backend expects from the form fields.
 *
 * Always returns the structured object (never a bare string): the picker always produces a
 * ModelRef. The `connection` is emitted only when it carries non-default info (a `self_managed`
 * mode, or an `agenta` slug); the `slug` is emitted only for an agenta connection. Extra keys on
 * the prior object (e.g. `extras`) ride through.
 */
export function composeModelValue({
    modelId,
    provider,
    mode,
    slug,
    existing,
}: ComposeModelValueArgs): Record<string, unknown> {
    const id = modelId ?? ""
    const hasProvider = Boolean(provider)

    // Extra keys (extras, deployment, ...) the form does not edit but must not drop.
    const extras: Record<string, unknown> = {}
    if (isModelRefObject(existing)) {
        for (const [key, val] of Object.entries(existing)) {
            if (!FORM_MANAGED_KEYS.has(key)) extras[key] = val
        }
    }

    const result: Record<string, unknown> = {...extras, model: id}
    if (hasProvider) result.provider = provider

    const isDefaultConnection = mode === "agenta" && !slug
    if (!isDefaultConnection) {
        const connection: Record<string, unknown> = {mode}
        if (mode === "agenta" && slug) connection.slug = slug
        result.connection = connection
    }

    return result
}

// ---------------------------------------------------------------------------
// Harness capability gating (fed from `/inspect` meta.harness_capabilities).
//
// The helpers read the passed-in capability map (keyed by harness type) instead of a static FE
// copy. A harness with no entry — or a missing map (older agents / standalone) — is permissive.
// ---------------------------------------------------------------------------

const ALL_MODES: ConnectionMode[] = ["agenta", "self_managed"]

function capsFor(
    capabilities: HarnessCapabilitiesMap | null | undefined,
    harness: string | null | undefined,
): HarnessCapabilities | null {
    if (!capabilities || !harness) return null
    return capabilities[harness] ?? null
}

/**
 * The provider families the harness can reach. A missing harness/capability is permissive
 * (returns `["*"]`, so the form shows a free-text provider field).
 */
export function allowedProviders(
    capabilities: HarnessCapabilitiesMap | null | undefined,
    harness: string | null | undefined,
): string[] {
    const entry = capsFor(capabilities, harness)
    return entry?.providers?.length ? entry.providers : ["*"]
}

/**
 * The deployment surfaces the harness can consume (`direct` / `custom` / `bedrock` / `vertex_ai` /
 * ...). A custom_provider connection's kind is a DEPLOYMENT, not a provider family, so it is gated
 * against this list — not `allowedProviders`. A missing harness/capability is permissive (`["*"]`).
 */
export function allowedDeployments(
    capabilities: HarnessCapabilitiesMap | null | undefined,
    harness: string | null | undefined,
): string[] {
    const entry = capsFor(capabilities, harness)
    return entry?.deployments?.length ? entry.deployments : ["*"]
}

/**
 * The connection modes the harness supports. A missing harness/capability is permissive (returns
 * both modes).
 */
export function allowedConnectionModes(
    capabilities: HarnessCapabilitiesMap | null | undefined,
    harness: string | null | undefined,
): ConnectionMode[] {
    const entry = capsFor(capabilities, harness)
    if (!entry?.connection_modes?.length) return ALL_MODES
    return entry.connection_modes.filter(
        (m): m is ConnectionMode => m === "agenta" || m === "self_managed",
    )
}

/**
 * Whether the harness can reach the provider. A `"*"` entry matches any provider; otherwise the
 * match is case-insensitive on the provider family. A missing harness/capability is permissive.
 */
export function harnessAllowsProvider(
    capabilities: HarnessCapabilitiesMap | null | undefined,
    harness: string | null | undefined,
    provider: string,
): boolean {
    const providers = allowedProviders(capabilities, harness)
    if (providers.includes("*")) return true
    return providers.some((p) => p.toLowerCase() === provider.toLowerCase())
}

/**
 * How the selected harness names a model: `"provider/id"` (Pi — value is the catalog id, provider
 * is derived from the group) or `"alias"` (Claude — value is the bare alias, provider is the
 * group). Defaults to `"provider/id"` when unknown.
 */
export function modelSelectionMode(
    capabilities: HarnessCapabilitiesMap | null | undefined,
    harness: string | null | undefined,
): string {
    return capsFor(capabilities, harness)?.model_selection ?? "provider/id"
}

// ---------------------------------------------------------------------------
// Harness-filtered, unified model picker (provider + model in one control).
// ---------------------------------------------------------------------------

/** A grouped model option group, the shape SelectLLMProviderBase / GroupedChoiceControl expect. */
export interface ModelOptionGroup {
    label: string
    options: {label: string; value: string; metadata?: Record<string, unknown>}[]
}

/** Optional per-model pricing metadata keyed `{provider: {modelId: {input, output}}}`. */
export type ModelMetadataMap = Record<string, Record<string, Record<string, unknown>>>

function titleizeProvider(provider: string): string {
    return provider.charAt(0).toUpperCase() + provider.slice(1).replace(/_/g, " ")
}

/**
 * Build the grouped model options for the harness from `capabilities[harness].models`
 * (provider -> ids/aliases). Each option's `value` is the model id/alias and its group label is
 * the provider — so selecting an option yields both the model and the provider it belongs to.
 * Pricing rides along from `metadata` when present. Returns `[]` when the harness publishes no
 * models (the caller then falls back to the schema's full catalog).
 */
export function buildModelOptionGroups(
    capabilities: HarnessCapabilitiesMap | null | undefined,
    harness: string | null | undefined,
    metadata?: ModelMetadataMap | null,
): ModelOptionGroup[] {
    const models = capsFor(capabilities, harness)?.models
    if (!models) return []
    return Object.entries(models)
        .filter(([, ids]) => Array.isArray(ids) && ids.length > 0)
        .map(([provider, ids]) => ({
            label: titleizeProvider(provider),
            options: ids.map((id) => ({
                label: id,
                value: id,
                metadata: metadata?.[provider]?.[id],
            })),
        }))
}

/**
 * The provider family that owns a picked model id, derived from the harness's published models
 * (the group the id sits in). Returns null when the id is not in any group (e.g. a stale id under
 * a switched harness). Use this so picking a model sets BOTH provider and model.
 */
export function providerForModel(
    capabilities: HarnessCapabilitiesMap | null | undefined,
    harness: string | null | undefined,
    modelId: string | null | undefined,
): string | null {
    if (!modelId) return null
    const models = capsFor(capabilities, harness)?.models
    if (!models) return null
    for (const [provider, ids] of Object.entries(models)) {
        if (Array.isArray(ids) && ids.includes(modelId)) return provider
    }
    return null
}

/**
 * Whether a model id is reachable under the harness (present in any of its published model
 * groups). A harness with no published models is permissive (returns true) so the schema-catalog
 * fallback path is not over-cleared. Use to clear an unreachable model on harness switch.
 */
export function harnessAllowsModel(
    capabilities: HarnessCapabilitiesMap | null | undefined,
    harness: string | null | undefined,
    modelId: string | null | undefined,
): boolean {
    if (!modelId) return true
    const models = capsFor(capabilities, harness)?.models
    if (!models || Object.keys(models).length === 0) return true
    return Object.values(models).some((ids) => Array.isArray(ids) && ids.includes(modelId))
}

// ---------------------------------------------------------------------------
// Connection picker (Agenta-managed): named connections from the vault list.
//
// Fed by the existing `GET /secrets/` via vaultSecretsQueryAtom (read-only). The backend resolver
// matches a named connection by the secret's `header.name` (the slug); the transformed vault list
// surfaces custom-provider connections as `{type: "custom_provider", name, provider}`. We list
// those, filtered to the selected provider and the harness's reachable providers.
// ---------------------------------------------------------------------------

/** A vault entry as surfaced by transformSecret (the in-app `LlmProvider` shape, loosely typed). */
export interface VaultConnectionEntry {
    /** The secret kind: "provider_key" (standard, no custom name) or "custom_provider". */
    type?: string
    /** For custom_provider: the connection name (== header.name == the slug to send). */
    name?: string
    /** For custom_provider: the provider family (data.kind). */
    provider?: string
    /** For standard provider_key: the provider title (the provider family). */
    title?: string
}

/** A named-connection option for the picker: `{label: header.name, value: slug}`. */
export interface ConnectionOption {
    label: string
    value: string
}

/** A vault custom_provider entry rich enough to contribute model options (its own models). */
export interface VaultModelSource {
    /** The connection name == the slug the resolver matches on. */
    name?: string
    /** The provider family (data.kind), e.g. "bedrock". */
    provider?: string
    /** The connection's own model ids (bare slugs). */
    models?: string[]
}

/**
 * The model FAMILY a hosted model id encodes, matched against the provider families the capability
 * map knows (union across harnesses — data-driven, no hardcoded vendor list). Deployment-hosted ids
 * carry the vendor structurally: bedrock `[region.]vendor.model` ("eu.anthropic.claude-haiku-4-5"),
 * gateway ids `vendor/model`. Returns null when the id encodes no known family.
 */
export function familyFromModelId(
    modelId: string | null | undefined,
    capabilities: HarnessCapabilitiesMap | null | undefined,
): string | null {
    if (!modelId) return null
    const families = new Set<string>()
    for (const caps of Object.values(capabilities ?? {})) {
        for (const provider of caps?.providers ?? []) families.add(provider.toLowerCase())
    }
    if (!families.size) return null
    for (const token of modelId.toLowerCase().split(/[./]/)) {
        if (families.has(token)) return token
    }
    return null
}

/**
 * Grouped model options contributed by the vault's custom_provider connections, so a connection's
 * own models (e.g. a Bedrock connection's `eu.anthropic.claude-haiku-4-5`) are selectable in the
 * model picker — not just the harness's static catalog. Filtered to connections whose provider the
 * harness can consume; each group carries its connection slug in option metadata so picking a model
 * can reunite it with its agenta-managed credential. Skips connections with no models.
 */
export function vaultModelGroups(
    secrets: VaultModelSource[] | null | undefined,
    capabilities: HarnessCapabilitiesMap | null | undefined,
    harness: string | null | undefined,
): ModelOptionGroup[] {
    if (!secrets?.length) return []
    // A custom_provider's `provider` field is its deployment kind (bedrock/vertex_ai/azure/custom),
    // gated against the harness's consumable deployments — NOT its provider families.
    const consumable = allowedDeployments(capabilities, harness)
    const anyDeployment = consumable.includes("*")

    const groups: ModelOptionGroup[] = []
    for (const secret of secrets) {
        const slug = secret.name?.trim()
        const deployment = secret.provider?.toLowerCase() || null
        const models = (secret.models ?? []).filter(Boolean)
        if (!slug || !models.length) continue
        if (
            !anyDeployment &&
            deployment &&
            !consumable.some((d) => d.toLowerCase() === deployment)
        ) {
            continue
        }
        groups.push({
            label: secret.name ?? slug,
            options: models.map((id) => ({
                label: id,
                value: id,
                metadata: {connectionSlug: slug, provider: secret.provider},
            })),
        })
    }
    return groups
}

/**
 * Named connections selectable for a provider under a harness, from the vault list. Only
 * custom-provider secrets carry a connection name (the slug the resolver matches on); standard
 * provider keys are the implicit project default and are not listed here. Filtered to the chosen
 * provider (case-insensitive) and, when no provider is chosen, to the harness's reachable
 * providers.
 */
export function namedConnectionOptions(
    secrets: VaultConnectionEntry[] | null | undefined,
    capabilities: HarnessCapabilitiesMap | null | undefined,
    harness: string | null | undefined,
    provider: string | null | undefined,
): ConnectionOption[] {
    if (!secrets?.length) return []
    const reachable = allowedProviders(capabilities, harness)
    const anyProvider = reachable.includes("*")
    const target = provider?.toLowerCase() || null

    const out: ConnectionOption[] = []
    const seen = new Set<string>()
    for (const secret of secrets) {
        if (secret.type !== "custom_provider") continue
        const slug = secret.name?.trim()
        if (!slug || seen.has(slug)) continue
        const secretProvider = secret.provider?.toLowerCase() || null
        if (target) {
            if (secretProvider !== target) continue
        } else if (!anyProvider && secretProvider) {
            // No provider chosen yet: keep only connections the harness can reach.
            if (!reachable.some((p) => p.toLowerCase() === secretProvider)) continue
        }
        seen.add(slug)
        out.push({label: slug, value: slug})
    }
    return out
}
