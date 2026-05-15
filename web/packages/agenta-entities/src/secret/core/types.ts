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

import {AgentaApi} from "@agentaai/api-client"

// ---------------------------------------------------------------------------
// Fern type aliases
// ---------------------------------------------------------------------------

export type Header = AgentaApi.Header
export type LegacyLifecycleDto = AgentaApi.LegacyLifecycleDto

export type SecretDto = AgentaApi.SecretDto
export type SecretResponseDto = AgentaApi.SecretResponseDto
export type CreateSecretDto = AgentaApi.CreateSecretDto
export type UpdateSecretDto = AgentaApi.UpdateSecretDto

export type StandardProviderDto = AgentaApi.StandardProviderDto
export type StandardProviderSettingsDto = AgentaApi.StandardProviderSettingsDto
export type CustomProviderDto = AgentaApi.CustomProviderDto
export type CustomProviderSettingsDto = AgentaApi.CustomProviderSettingsDto
export type CustomModelSettingsDto = AgentaApi.CustomModelSettingsDto

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
    azure: "Azure OpenAI",
    minimax: "MiniMax",
    custom: "Custom Provider",
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
