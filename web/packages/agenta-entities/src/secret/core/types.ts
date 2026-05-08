/**
 * Secret Entity — Domain Types
 *
 * The vault stores LLM provider keys (and, in the future, other secrets) for
 * each project. These types describe the wire shape of the `/vault/v1/secrets/`
 * API and the in-app representation used by `useVaultSecret`.
 *
 * The canonical home for these types is here. They are re-exported from
 * `@/oss/lib/Types` so existing OSS consumers (e.g. `ConfigureProviderDrawer`)
 * keep working without an import sweep.
 */

export interface HeaderDTO {
    name?: string | null
    description?: string | null
}

export interface StandardSecret {
    kind: SecretDTOProvider
    provider: {
        key: string
    }
}

export type StandardSecretDTO<T extends "payload" | "response" = "response"> = {
    header: HeaderDTO
} & (T extends "payload"
    ? {secret: {data: StandardSecret; kind: SecretDTOKind.PROVIDER_KEY}}
    : {
          kind: SecretDTOKind.PROVIDER_KEY
          data: StandardSecret
          id: string
          lifecycle: {created_at: string}
      })

export enum SecretDTOKind {
    PROVIDER_KEY = "provider_key",
    CUSTOM_PROVIDER_KEY = "custom_provider",
}

export enum SecretDTOProvider {
    OPENAI = "openai",
    COHERE = "cohere",
    ANYSCALE = "anyscale",
    DEEPINFRA = "deepinfra",
    ALEPHALPHA = "alephalpha",
    GROQ = "groq",
    MISTRAL = "mistral",
    ANTHROPIC = "anthropic",
    PERPLEXITYAI = "perplexityai",
    TOGETHERAI = "together_ai",
    OPENROUTER = "openrouter",
    GEMINI = "gemini",
    MINIMAX = "minimax",
}

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

export interface VaultModels {
    slug: string
}

export interface VaultProvider {
    url: string
    version: string
    extras: {
        aws_access_key_id?: string
        aws_secret_access_key?: string
        aws_session_token?: string
        aws_region_name?: string
        vertex_ai_project?: string
        vertex_ai_location?: string
        vertex_ai_credentials?: string
        api_key?: string
    }
}

export interface VaultData {
    kind: string
    provider: VaultProvider
    models: VaultModels[]
    model_keys: string[]
    provider_slug: string
}

export type CustomSecretDTO<T extends "payload" | "response" = "response"> = {
    header: HeaderDTO
} & (T extends "payload"
    ? {secret: {kind: SecretDTOKind.CUSTOM_PROVIDER_KEY; data: VaultData}}
    : {
          kind: SecretDTOKind.CUSTOM_PROVIDER_KEY
          data: VaultData
          id: string
          lifecycle: {created_at: string}
      })

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
