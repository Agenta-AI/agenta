/**
 * Secret Entity — Transforms
 *
 * Pure transform helpers between the wire shape (StandardSecretDTO /
 * CustomSecretDTO) and the in-app `LlmProvider` shape that consumers and
 * UI components work with.
 *
 * These are vault-domain-specific. The generic `LlmProvider` type and the
 * canonical provider catalog (`llmAvailableProviders`,
 * `llmAvailableProvidersToken`) live in `@agenta/shared` so non-secret
 * consumers (e.g. `@agenta/ui/select-llm-provider`) can use them without
 * pulling in this entity package.
 */

import type {LlmProvider} from "@agenta/shared/types"

import {
    type CustomSecretDTO,
    PROVIDER_KINDS,
    type StandardSecretDTO,
    SecretDTOKind,
    SecretDTOProvider,
} from "./types"

/**
 * Transform raw `/vault/v1/secrets/` response items into the `LlmProvider`
 * shape used throughout the app. Standard provider secrets and custom
 * provider secrets have different wire shapes; both collapse into the
 * common `LlmProvider` representation here.
 */
export const transformSecret = (
    secrets: CustomSecretDTO[] | StandardSecretDTO[],
): LlmProvider[] => {
    return secrets.reduce((acc, curr) => {
        if (curr.kind == SecretDTOKind.PROVIDER_KEY) {
            const secret = curr as StandardSecretDTO

            const name = secret.data.kind
            const key = secret.data.provider.key
            const provider = secret.data.kind

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
                key: key,
                name: envNameMap[provider] || "",
                id: secret.id,
                type: secret.kind,
                created_at: secret.lifecycle.created_at,
            })
        } else if (curr.kind === SecretDTOKind.CUSTOM_PROVIDER_KEY) {
            const secret = curr as CustomSecretDTO
            acc.push({
                name: secret.header.name || "",
                id: secret.id,
                type: secret.kind,
                provider: secret.data?.kind,
                apiKey: secret.data.provider.extras?.api_key || "",
                apiBaseUrl: secret.data.provider.url || "",
                region: secret.data.provider.extras?.aws_region_name || "",
                vertexProject: secret.data.provider.extras?.vertex_ai_project || "",
                vertexLocation: secret.data.provider.extras?.vertex_ai_location || "",
                vertexCredentials: secret.data.provider.extras?.vertex_ai_credentials || "",
                accessKeyId: secret.data.provider.extras?.aws_access_key_id || "",
                accessKey: secret.data.provider.extras?.aws_secret_access_key || "",
                sessionToken: secret.data.provider.extras?.aws_session_token || "",
                models: secret?.data.models.map((model) => model.slug),
                modelKeys: secret?.data.model_keys,
                version: secret.data.provider?.version || "",
                created_at: secret.lifecycle?.created_at || "",
            })
        }
        return acc
    }, [] as LlmProvider[])
}

/**
 * Transform a form-shaped `LlmProvider` into a `CustomSecretDTO<"payload">`
 * suitable for POST/PUT against `/vault/v1/secrets/`.
 */
export const transformCustomProviderPayloadData = (
    values: LlmProvider,
): CustomSecretDTO<"payload"> => {
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
            kind: SecretDTOKind.CUSTOM_PROVIDER_KEY,
            data: {
                kind: providerKind,
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
                models: values.models?.map((slug) => ({slug})),
            },
        },
    } as CustomSecretDTO<"payload">
}

/**
 * Map the env-var name (e.g. `OPENAI_API_KEY`) used by `LlmProvider.name`
 * back to the canonical `SecretDTOProvider` enum value used when creating
 * a standard provider secret.
 *
 * Returns `undefined` for unknown env-var names; the caller is expected
 * to throw a domain error in that case.
 */
export const getEnvNameMap = (): Record<string, SecretDTOProvider> => ({
    OPENAI_API_KEY: SecretDTOProvider.OPENAI,
    COHERE_API_KEY: SecretDTOProvider.COHERE,
    ANYSCALE_API_KEY: SecretDTOProvider.ANYSCALE,
    DEEPINFRA_API_KEY: SecretDTOProvider.DEEPINFRA,
    ALEPHALPHA_API_KEY: SecretDTOProvider.ALEPHALPHA,
    GROQ_API_KEY: SecretDTOProvider.GROQ,
    MISTRAL_API_KEY: SecretDTOProvider.MISTRAL,
    // Backward-compatible mapping for legacy Mistral provider name
    MISTRALAI_API_KEY: SecretDTOProvider.MISTRAL,
    ANTHROPIC_API_KEY: SecretDTOProvider.ANTHROPIC,
    PERPLEXITYAI_API_KEY: SecretDTOProvider.PERPLEXITYAI,
    TOGETHERAI_API_KEY: SecretDTOProvider.TOGETHERAI,
    OPENROUTER_API_KEY: SecretDTOProvider.OPENROUTER,
    GEMINI_API_KEY: SecretDTOProvider.GEMINI,
    MINIMAX_API_KEY: SecretDTOProvider.MINIMAX,
})
