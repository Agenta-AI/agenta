/**
 * connectionUtils
 *
 * Pure helpers and a static capability map for the agent config's model + credential
 * connection (the `ModelRef` shape from the provider-model-auth project). The backend
 * accepts `config.model` either as a plain string (legacy, the default connection) or as a
 * structured object `{provider?, model, params?, connection?: {mode, slug?}}` that the SDK
 * coerces into a `ModelRef`. These helpers translate between the form fields the
 * AgentConfigControl renders and that on-the-wire value, keeping the default case
 * byte-identical to today (a plain string) so existing agents do not change shape.
 *
 * They live in their own module (not inline in AgentConfigControl) so the package unit
 * tests can import and exercise them without a React harness.
 *
 * Design: docs/design/agent-workflows/projects/provider-model-auth/design.md (Concern 1:
 * ModelRef; Concern 3b: per-harness provider/mode gating).
 */

/**
 * A connection mode: where the credential comes from. Two modes only — `agenta` (a vault
 * connection; project-default when no slug, named when a slug is set) and `self_managed`
 * (Agenta injects nothing). There is no separate `default` mode.
 */
export type ConnectionMode = "agenta" | "self_managed"

/** The connection fields the form edits, read back from `config.model`. */
export interface ConnectionFields {
    /** Logical provider family (e.g. "openai", "anthropic"); null when inferred. */
    provider: string | null
    /** Credential mode. Defaults to "agenta" (the project default) for a bare-string model. */
    mode: ConnectionMode
    /** Named connection slug; only meaningful when mode === "agenta". */
    slug: string | null
}

/** The structured `ModelRef` object shape (a subset; extra keys round-trip untouched). */
interface ModelRefObject {
    provider?: string | null
    model?: string | null
    params?: Record<string, unknown>
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
 * The picked model id, whatever the stored shape: a plain string is itself; an object
 * yields its `.model`. Returns null when neither is present.
 */
export function modelIdFromConfig(model: unknown): string | null {
    if (typeof model === "string") return model
    if (isModelRefObject(model)) {
        return typeof model.model === "string" ? model.model : null
    }
    return null
}

/**
 * The connection fields behind `config.model`: a plain string is the implicit default
 * connection (no provider override); an object exposes its provider and connection.
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
     * The prior `config.model` value. When it is a structured object, its extra keys
     * (notably `params`, set via the raw-JSON hatch) are carried through so a form edit
     * never silently drops them. The form-managed keys (model/provider/connection) are then
     * overwritten from the args.
     */
    existing?: unknown
}

const FORM_MANAGED_KEYS = new Set(["model", "provider", "connection"])

/**
 * Compose the `config.model` value the backend expects from the form fields.
 *
 * Keeps the plain string for the default `agenta` connection (no slug) with no provider
 * override AND no extra keys to preserve (so existing agents stay byte-identical). Otherwise
 * returns the structured object, emitting the `connection` only when it carries non-default
 * info (a `self_managed` mode, or an `agenta` slug) and the `slug` only for an agenta
 * connection. Extra keys on the prior object (e.g. `params`) ride through.
 */
export function composeModelValue({
    modelId,
    provider,
    mode,
    slug,
    existing,
}: ComposeModelValueArgs): string | Record<string, unknown> {
    const id = modelId ?? ""
    const hasProvider = Boolean(provider)

    // Extra keys (params, deployment, ...) the form does not edit but must not drop.
    const extras: Record<string, unknown> = {}
    if (isModelRefObject(existing)) {
        for (const [key, val] of Object.entries(existing)) {
            if (!FORM_MANAGED_KEYS.has(key)) extras[key] = val
        }
    }
    const hasExtras = Object.keys(extras).length > 0

    // The default agenta connection (agenta + no slug) carries no info beyond the model id, so
    // with no provider override and no extras it stays a plain string (byte-identical to today).
    const isDefaultConnection = mode === "agenta" && !slug
    if (isDefaultConnection && !hasProvider && !hasExtras) {
        return id
    }

    const result: Record<string, unknown> = {...extras, model: id}
    if (hasProvider) result.provider = provider

    if (!isDefaultConnection) {
        const connection: Record<string, unknown> = {mode}
        if (mode === "agenta" && slug) connection.slug = slug
        result.connection = connection
    }

    return result
}

// ---------------------------------------------------------------------------
// Static per-harness capability map.
//
// A frontend copy of `sdks/python/agenta/sdk/agents/capabilities.py`, mirroring its REAL
// entries: pi/agenta reach the eight vault-mapped providers; claude is anthropic-only; both
// modes (`agenta`/`self_managed`) on every harness. A harness with no entry is permissive.
//
// TODO(harness-capabilities): the sibling harness-capabilities project replaces this static
// map with one fed from `/inspect` `meta.harness_capabilities`. Keep it in agreement with the
// SDK table until then.
// ---------------------------------------------------------------------------

interface HarnessConnectionCapabilities {
    providers: string[]
    connectionModes: ConnectionMode[]
}

const ALL_MODES: ConnectionMode[] = ["agenta", "self_managed"]

// The eight Agenta-vault-mapped providers Pi reaches directly (mirrors PI_VAULT_PROVIDERS in
// the SDK capabilities table).
const PI_VAULT_PROVIDERS = [
    "openai",
    "anthropic",
    "gemini",
    "mistral",
    "groq",
    "minimax",
    "together_ai",
    "openrouter",
]

const HARNESS_CONNECTION_CAPABILITIES: Record<string, HarnessConnectionCapabilities> = {
    pi: {providers: [...PI_VAULT_PROVIDERS], connectionModes: ALL_MODES},
    agenta: {providers: [...PI_VAULT_PROVIDERS], connectionModes: ALL_MODES},
    claude: {providers: ["anthropic"], connectionModes: ALL_MODES},
}

/**
 * The provider families the harness can reach. A missing harness is permissive (returns `["*"]`,
 * so the form shows a free-text provider field).
 */
export function allowedProviders(harness: string | null | undefined): string[] {
    if (!harness) return ["*"]
    const entry = HARNESS_CONNECTION_CAPABILITIES[harness]
    return entry ? entry.providers : ["*"]
}

/**
 * The connection modes the harness supports. A missing harness is permissive (returns all
 * modes).
 */
export function allowedConnectionModes(harness: string | null | undefined): ConnectionMode[] {
    if (!harness) return ALL_MODES
    const entry = HARNESS_CONNECTION_CAPABILITIES[harness]
    return entry ? entry.connectionModes : ALL_MODES
}

/**
 * Whether the harness can reach the provider. A `"*"` entry matches any provider; otherwise
 * the match is case-insensitive on the provider family. A missing harness is permissive.
 */
export function harnessAllowsProvider(
    harness: string | null | undefined,
    provider: string,
): boolean {
    const providers = allowedProviders(harness)
    if (providers.includes("*")) return true
    return providers.some((p) => p.toLowerCase() === provider.toLowerCase())
}
