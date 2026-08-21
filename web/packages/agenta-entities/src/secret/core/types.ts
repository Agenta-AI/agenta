/**
 * Secret Entity — Domain Types
 *
 * All wire shapes come from the Fern-generated client
 * (`@agentaai/api-client`) so this package stays aligned with the backend
 * OpenAPI definition. The hand-rolled DTOs that used to live here have
 * been removed; consumers should import the Fern names directly.
 *
 * What stays:
 *   - `PROVIDER_LABELS` / `PROVIDER_KINDS` — app-level provider catalog
 *     (rendering, slug normalization). No wire equivalent.
 *   - `STANDARD_PROVIDER_KINDS` — the standard provider list minus the
 *     legacy `"mistralai"` alias (kept in Fern for backwards compat but
 *     not shown in OSS provider pickers).
 *   - `VaultMigrationStatus` — UI state for the one-time localStorage
 *     migration; not a wire shape.
 */

import type {LlmProvider} from "@agenta/shared/types"
import {AgentaApi} from "@agentaai/api-client"

// ---------------------------------------------------------------------------
// Fern type aliases
// ---------------------------------------------------------------------------

export type Header = AgentaApi.Header
export type LegacyLifecycleDto = AgentaApi.LegacyLifecycleDto

export type SecretDto = AgentaApi.SecretDto

/**
 * A stored record as the vault returns it, plus the write-only fields.
 *
 * A write-only row is created, replaced, and deleted like any other, but its value never comes
 * back: the response nulls the credential and answers `has_key` / `key_preview` instead.
 * `managed_by` names the platform component that provisioned the row, if any.
 *
 * Layered onto the Fern types until the client is regenerated from the OpenAPI spec; dropping the
 * intersection once Fern declares the fields is a no-op for callers.
 */
export type SecretResponseDto = AgentaApi.SecretResponseDto & {
    write_only?: boolean | null
    managed_by?: string | null
    has_key?: boolean | null
    key_preview?: string | null
}

export type CreateSecretDto = AgentaApi.CreateSecretDto
export type UpdateSecretDto = AgentaApi.UpdateSecretDto

export type StandardProviderSettingsDto = AgentaApi.StandardProviderSettingsDto
export type CustomProviderSettingsDto = AgentaApi.CustomProviderSettingsDto
export type CustomModelSettingsDto = AgentaApi.CustomModelSettingsDto

/**
 * The connection policy both stored record shapes carry: the models this connection offers
 * and the harnesses it may drive. A missing `models` means "use Agenta's defaults" and an
 * empty one means "no models from this connection"; a missing `harnesses` means "any harness
 * Agenta supports". The custom-provider record already declares `models`, so it only gains
 * `harnesses` here.
 *
 * Layered onto the Fern types until the client is regenerated from the OpenAPI spec; dropping
 * the intersections once Fern declares the fields is a no-op for callers.
 */
export type StandardProviderDto = Omit<AgentaApi.StandardProviderDto, "provider"> & {
    /**
     * `key` is optional in both directions: a write-only response nulls it, and an update omits it
     * to mean "keep the stored value". Fern still declares it required.
     */
    provider: {key?: string | null}
    models?: CustomModelSettingsDto[] | null
    harnesses?: string[] | null
}
export type CustomProviderDto = AgentaApi.CustomProviderDto & {
    harnesses?: string[] | null
}

export type CustomSecretDto = AgentaApi.CustomSecretDto
export type CustomSecretSettingsDto = AgentaApi.CustomSecretSettingsDto

export const CustomSecretFormat = AgentaApi.CustomSecretFormat
export type CustomSecretFormat = AgentaApi.CustomSecretFormat

/**
 * Flat json content for a `json`-format custom secret: a single-level map of
 * primitives. Mirrors the backend's flat-only validation (no nesting/arrays).
 */
export type CustomSecretContent = CustomSecretSettingsDto["content"]

/**
 * Table/form row for a user-named vault secret (`custom_secret`). Extends the
 * shared `LlmProvider` row (so it flows through the generic vault transforms)
 * with the two fields named secrets need: the `format` and a `content` that is
 * a text blob or a flat json object — wider than `LlmProvider.key` (string only).
 */
export interface NamedSecretRow extends LlmProvider {
    slug?: string
    format: CustomSecretFormat
    /** Absent on a write-only record (the value never comes back) and on an update that keeps it. */
    content?: CustomSecretContent
}

// `SecretKind` / `StandardProviderKind` / `CustomProviderKind` are Fern
// const-asserted objects. Re-export both the value and the derived type
// so callers can use them like an enum (`SecretKind.ProviderKey`).
export const SecretKind = AgentaApi.SecretKind
export type SecretKind = AgentaApi.SecretKind

export const StandardProviderKind = AgentaApi.StandardProviderKind
export type StandardProviderKind = AgentaApi.StandardProviderKind

export const CustomProviderKind = AgentaApi.CustomProviderKind
export type CustomProviderKind = AgentaApi.CustomProviderKind

// ---------------------------------------------------------------------------
// App-level catalog (no wire equivalent)
// ---------------------------------------------------------------------------

export const PROVIDER_LABELS: Record<string, string> = {
    openai: "OpenAI",
    cohere: "Cohere",
    anyscale: "Anyscale",
    deepinfra: "DeepInfra",
    alephalpha: "Aleph Alpha",
    groq: "Groq",
    mistral: "Mistral AI",
    mistralai: "Mistral AI",
    anthropic: "Anthropic",
    perplexityai: "Perplexity AI",
    together_ai: "Together AI",
    openrouter: "OpenRouter",
    gemini: "Google Gemini",
    vertex_ai: "Google Vertex AI",
    bedrock: "AWS Bedrock",
    sagemaker: "AWS SageMaker",
    azure: "Azure OpenAI",
    minimax: "MiniMax",
    // Stored value stays "custom"; only the user-visible label changes. The v1 custom deployment
    // speaks the OpenAI Chat Completions dialect, so name it for what it connects to.
    custom: "OpenAI-compatible endpoint",
}

export const PROVIDER_KINDS: Record<string, string> = {
    ...Object.entries(PROVIDER_LABELS).reduce(
        (acc, [kind, label]) => {
            acc[kind] = kind
            acc[label.toLowerCase()] = kind
            return acc
        },
        {} as Record<string, string>,
    ),
    // Normalize legacy "mistralai" slug to canonical "mistral"
    mistralai: "mistral",
}

/**
 * Standard provider kinds shown in the OSS provider picker.
 *
 * Fern includes both `"mistral"` and `"mistralai"` in `StandardProviderKind`
 * for backwards compatibility, but the OSS UI only shows the canonical
 * `"mistral"` entry — filter the alias out here.
 */
export const STANDARD_PROVIDER_KINDS: StandardProviderKind[] = (
    Object.values(StandardProviderKind) as StandardProviderKind[]
).filter((kind) => kind !== StandardProviderKind.Mistralai)

/**
 * Truthy, obviously-not-a-key sentinel the vault persister writes to disk in place of secret
 * values. It lives here rather than beside the persister because readers of a restored row — the
 * connection card seeds its credential fields from one — must recognise it as "no value yet".
 */
export const VAULT_PERSIST_REDACTED = "[redacted]"

/**
 * Every `LlmProvider` field that can carry actual secret material — the fields the vault strips
 * from a write-only response, and the fields the IndexedDB persister replaces with a sentinel.
 * One list so the two can never disagree about what counts as a secret.
 */
export const SECRET_VALUE_FIELDS = [
    "key",
    "apiKey",
    "accessKeyId",
    "accessKey",
    "sessionToken",
    "bearerToken",
    "vertexCredentials",
] as const

// ---------------------------------------------------------------------------
// Migration status (UI state, not wire)
// ---------------------------------------------------------------------------

/**
 * Migration status for the legacy localStorage → vault migration.
 *
 * `migrating: true` while migration is in flight; `migrated: true` after success.
 * On logout the hook resets both to `false` so that the next sign-in re-arms
 * the migration if needed.
 */
export interface VaultMigrationStatus {
    migrating: boolean
    migrated: boolean
}
