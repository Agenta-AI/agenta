/**
 * LLM provider configuration shape.
 *
 * Cross-cutting type used by the secret entity (`@agenta/entities/secret`),
 * provider-selection UI components (`@agenta/ui/select-llm-provider`),
 * and OSS feature pages (ModelRegistry, settings/Secrets, prompts, evaluations).
 *
 * The `type` field is typed as `string` rather than the secret-domain enum
 * (`SecretDTOKind`) to keep this package independent of `@agenta/entities/secret`
 * — preventing a circular dependency. Consumers that need the enum import it
 * directly from `@agenta/entities/secret`.
 */
export interface LlmProvider {
    title?: string
    key?: string
    provider?: string
    name?: string
    apiKey?: string
    apiBaseUrl?: string
    version?: string
    region?: string
    vertexProject?: string
    vertexLocation?: string
    vertexCredentials?: string
    accessKeyId?: string
    accessKey?: string
    sessionToken?: string
    models?: string[]
    modelKeys?: string[]
    id?: string
    type?: string
    created_at?: string
}
