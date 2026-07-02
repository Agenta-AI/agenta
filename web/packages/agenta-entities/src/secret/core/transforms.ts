/**
 * Secret Entity — Transforms
 *
 * Pure helpers between the Fern wire shapes (`SecretResponseDto` /
 * `CreateSecretDto`) and the in-app `LlmProvider` shape that consumers and
 * UI components work with.
 *
 * The generic `LlmProvider` type and the canonical provider catalog
 * (`llmAvailableProviders`, `llmAvailableProvidersToken`) live in
 * `@agenta/shared` so non-secret consumers (e.g.
 * `@agenta/ui/select-llm-provider`) can use them without pulling in this
 * entity package.
 */

import type {LlmProvider} from "@agenta/shared/types"

import {
    PROVIDER_KINDS,
    SecretKind,
    StandardProviderKind,
    type CreateSecretDto,
    type CustomProviderDto,
    type CustomSecretDto,
    type NamedSecretRow,
    type SecretResponseDto,
    type StandardProviderDto,
} from "./types"

// ---------------------------------------------------------------------------
// Provider ↔ env-var mapping (single source of truth)
//
// Standard provider secrets surface in the app under their env-var name
// (e.g. `OPENAI_API_KEY`). Keeping the kind → env mapping in one place
// avoids drift between `transformSecret` (kind → env) and `getEnvNameMap`
// (env → kind), and lets us surface unmapped providers explicitly.
// ---------------------------------------------------------------------------

const STANDARD_PROVIDER_ENV_BY_KIND: Partial<Record<StandardProviderKind, string>> = {
    [StandardProviderKind.Openai]: "OPENAI_API_KEY",
    [StandardProviderKind.Cohere]: "COHERE_API_KEY",
    [StandardProviderKind.Anyscale]: "ANYSCALE_API_KEY",
    [StandardProviderKind.Deepinfra]: "DEEPINFRA_API_KEY",
    [StandardProviderKind.Alephalpha]: "ALEPHALPHA_API_KEY",
    [StandardProviderKind.Groq]: "GROQ_API_KEY",
    [StandardProviderKind.Mistral]: "MISTRAL_API_KEY",
    [StandardProviderKind.Anthropic]: "ANTHROPIC_API_KEY",
    [StandardProviderKind.Perplexityai]: "PERPLEXITYAI_API_KEY",
    [StandardProviderKind.TogetherAi]: "TOGETHERAI_API_KEY",
    [StandardProviderKind.Openrouter]: "OPENROUTER_API_KEY",
    [StandardProviderKind.Gemini]: "GEMINI_API_KEY",
    [StandardProviderKind.Minimax]: "MINIMAX_API_KEY",
}

// Legacy aliases that map to the same canonical env var as their primary
// counterpart. Used only in the reverse direction (env → kind).
const STANDARD_PROVIDER_ENV_ALIASES: Record<string, StandardProviderKind> = {
    MISTRALAI_API_KEY: StandardProviderKind.Mistral,
}

/**
 * Transform raw `/secrets/` response items into the `LlmProvider` shape
 * used throughout the app. Standard provider secrets and custom provider
 * secrets have different wire shapes; both collapse into the common
 * `LlmProvider` representation here.
 *
 * Standard secrets whose `kind` isn't in `STANDARD_PROVIDER_ENV_BY_KIND`
 * are dropped (with a warning) — the app uses the env-var name as the
 * provider identity, so an unmapped kind would surface as a nameless row.
 */
export const transformSecret = (secrets: SecretResponseDto[]): LlmProvider[] => {
    return secrets.reduce((acc, secret) => {
        if (secret.kind === SecretKind.ProviderKey) {
            const data = secret.data as StandardProviderDto

            const provider = data.kind
            const envName = STANDARD_PROVIDER_ENV_BY_KIND[provider as StandardProviderKind]
            if (!envName) {
                console.warn(`[vault] Unmapped standard provider kind "${provider}" — skipping.`)
                return acc
            }

            acc.push({
                title: provider,
                key: data.provider.key,
                name: envName,
                id: secret.id ?? undefined,
                type: secret.kind,
                created_at: secret.lifecycle?.created_at ?? undefined,
            })
        } else if (secret.kind === SecretKind.CustomProvider) {
            const data = secret.data as CustomProviderDto
            const extras = (data.provider.extras ?? {}) as Record<string, string | undefined>

            acc.push({
                name: secret.header.name ?? "",
                id: secret.id ?? undefined,
                type: secret.kind,
                provider: data.kind,
                apiKey: extras.api_key || "",
                apiBaseUrl: data.provider.url ?? "",
                region: extras.aws_region_name || "",
                vertexProject: extras.vertex_ai_project || "",
                vertexLocation: extras.vertex_ai_location || "",
                vertexCredentials: extras.vertex_ai_credentials || "",
                accessKeyId: extras.aws_access_key_id || "",
                accessKey: extras.aws_secret_access_key || "",
                sessionToken: extras.aws_session_token || "",
                models: data.models.map((model) => model.slug),
                modelKeys: data.model_keys ?? undefined,
                version: data.provider.version ?? "",
                created_at: secret.lifecycle?.created_at ?? "",
            })
        } else if (secret.kind === SecretKind.CustomSecret) {
            // `secret.data` is the Fern union; kind already discriminates it, but
            // CustomSecretDto shares no fields with the provider members, so TS
            // needs the explicit unknown step.
            const data = secret.data as unknown as CustomSecretDto

            const row: NamedSecretRow = {
                name: secret.header.name ?? "",
                slug: secret.slug ?? undefined,
                format: data.secret.format,
                content: data.secret.content,
                id: secret.id ?? undefined,
                type: secret.kind,
                created_at: secret.lifecycle?.created_at ?? undefined,
            }
            acc.push(row)
        }
        return acc
    }, [] as LlmProvider[])
}

/**
 * Transform a form-shaped `LlmProvider` into a `CreateSecretDto` suitable
 * for POST/PUT against `/secrets/`.
 */
export const transformCustomProviderPayloadData = (values: LlmProvider): CreateSecretDto => {
    const providerInput = values.provider?.trim() ?? ""
    const providerKind = providerInput
        ? (PROVIDER_KINDS[providerInput] ??
          PROVIDER_KINDS[providerInput.toLowerCase()] ??
          providerInput.toLowerCase())
        : ""

    return {
        header: {
            name: values.name,
        },
        secret: {
            kind: SecretKind.CustomProvider,
            data: {
                kind: providerKind as CustomProviderDto["kind"],
                provider: {
                    url: values.apiBaseUrl,
                    version: values.version,
                    extras: {
                        api_key: values.apiKey,
                        vertex_ai_location: values.vertexLocation,
                        vertex_ai_project: values.vertexProject,
                        vertex_ai_credentials: values.vertexCredentials,
                        aws_region_name: values.region,
                        aws_access_key_id: values.accessKeyId,
                        aws_secret_access_key: values.accessKey,
                        aws_session_token: values.sessionToken,
                    },
                },
                models: values.models?.map((slug) => ({slug})) ?? [],
            } as CustomProviderDto,
        },
    }
}

/**
 * Transform a `NamedSecretRow` (Name + Format + Content from the Vault modal)
 * into a `CreateSecretDto`. The backend validator (`custom_secret` branch) is
 * the source of truth for shape — text must be a string, json must be a flat
 * object of primitives — so this only forwards `{format, content}` as-is.
 */
export const transformCustomSecretPayloadData = (values: NamedSecretRow): CreateSecretDto => ({
    // Slug is set on create only; the backend derives it from the name when
    // omitted, and ignores it on update (slugs are immutable).
    ...(values.slug ? {slug: values.slug} : {}),
    header: {
        name: values.name,
    },
    secret: {
        kind: SecretKind.CustomSecret,
        data: {
            secret: {
                format: values.format,
                content: values.content,
            },
        } as CustomSecretDto,
    },
})

/**
 * Map the env-var name (e.g. `OPENAI_API_KEY`) used by `LlmProvider.name`
 * back to the canonical `StandardProviderKind` value used when creating
 * a standard provider secret. Derived from `STANDARD_PROVIDER_ENV_BY_KIND`
 * so the two directions can't drift.
 *
 * Returns `undefined` for unknown env-var names; the caller is expected
 * to throw a domain error in that case.
 */
export const getEnvNameMap = (): Record<string, StandardProviderKind> => {
    const reverse = Object.entries(STANDARD_PROVIDER_ENV_BY_KIND).reduce(
        (acc, [kind, env]) => {
            if (env) acc[env] = kind as StandardProviderKind
            return acc
        },
        {} as Record<string, StandardProviderKind>,
    )
    return {...reverse, ...STANDARD_PROVIDER_ENV_ALIASES}
}
