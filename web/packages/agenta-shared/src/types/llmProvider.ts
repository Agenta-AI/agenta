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
    bearerToken?: string
    models?: string[]
    modelKeys?: string[]
    /**
     * The stored record's stable slug — the connection's identity, which the credential
     * resolvers match on. Absent on records created before named connections; those stay
     * addressable by their provider family (standard) or their name (custom).
     */
    slug?: string
    /** The connection's user-visible name (e.g. "OpenAI 2"), independent of its identity. */
    displayName?: string
    /** Harnesses this connection may drive; absent means any harness Agenta supports. */
    harnesses?: string[]
    /** The row is write-only: the vault stores its value but never returns it. */
    writeOnly?: boolean
    /** Whether the vault holds a credential for this row. The only presence check a write-only row has. */
    hasKey?: boolean
    /** Masked credential (`sk-****9Qa`) a write-only row carries in place of its value. */
    keyPreview?: string
    /** The platform component that provisioned this row; user edits and deletes are refused for it. */
    managedBy?: string
    id?: string
    type?: string
    created_at?: string
}
