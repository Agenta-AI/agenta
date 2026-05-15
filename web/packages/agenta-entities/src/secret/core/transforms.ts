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
    type SecretResponseDto,
    type StandardProviderDto,
} from "./types"

/**
 * Transform raw `/secrets/` response items into the `LlmProvider` shape
 * used throughout the app. Standard provider secrets and custom provider
 * secrets have different wire shapes; both collapse into the common
 * `LlmProvider` representation here.
 */
export const transformSecret = (secrets: SecretResponseDto[]): LlmProvider[] => {
    return secrets.reduce((acc, secret) => {
        if (secret.kind === SecretKind.ProviderKey) {
            const data = secret.data as StandardProviderDto

            const provider = data.kind
            const name = provider
            const key = data.provider.key

            const envNameMap: Record<string, string> = {
                openai: "OPENAI_API_KEY",
                cohere: "COHERE_API_KEY",
                anyscale: "ANYSCALE_API_KEY",
                deepinfra: "DEEPINFRA_API_KEY",
                alephalpha: "ALEPHALPHA_API_KEY",
                groq: "GROQ_API_KEY",
                mistral: "MISTRAL_API_KEY",
                mistralai: "MISTRAL_API_KEY",
                anthropic: "ANTHROPIC_API_KEY",
                perplexityai: "PERPLEXITYAI_API_KEY",
                together_ai: "TOGETHERAI_API_KEY",
                openrouter: "OPENROUTER_API_KEY",
                gemini: "GEMINI_API_KEY",
                minimax: "MINIMAX_API_KEY",
            }

            acc.push({
                title: name || "",
                key,
                name: envNameMap[provider] || "",
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
            description: values.name,
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
 * Map the env-var name (e.g. `OPENAI_API_KEY`) used by `LlmProvider.name`
 * back to the canonical `StandardProviderKind` value used when creating
 * a standard provider secret.
 *
 * Returns `undefined` for unknown env-var names; the caller is expected
 * to throw a domain error in that case.
 */
export const getEnvNameMap = (): Record<string, StandardProviderKind> => ({
    OPENAI_API_KEY: StandardProviderKind.Openai,
    COHERE_API_KEY: StandardProviderKind.Cohere,
    ANYSCALE_API_KEY: StandardProviderKind.Anyscale,
    DEEPINFRA_API_KEY: StandardProviderKind.Deepinfra,
    ALEPHALPHA_API_KEY: StandardProviderKind.Alephalpha,
    GROQ_API_KEY: StandardProviderKind.Groq,
    MISTRAL_API_KEY: StandardProviderKind.Mistral,
    // Backward-compatible mapping for legacy Mistral provider name
    MISTRALAI_API_KEY: StandardProviderKind.Mistral,
    ANTHROPIC_API_KEY: StandardProviderKind.Anthropic,
    PERPLEXITYAI_API_KEY: StandardProviderKind.Perplexityai,
    TOGETHERAI_API_KEY: StandardProviderKind.TogetherAi,
    OPENROUTER_API_KEY: StandardProviderKind.Openrouter,
    GEMINI_API_KEY: StandardProviderKind.Gemini,
    MINIMAX_API_KEY: StandardProviderKind.Minimax,
})
