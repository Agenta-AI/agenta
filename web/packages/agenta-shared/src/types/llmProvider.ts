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
/**
 * The sign-in facts a hosted subscription row carries.
 *
 * The login itself never leaves the vault, so the row reports only how usable it is. `loginState`
 * stays a plain string: an API that grows a fourth state must not make the row unreadable, and the
 * readers here treat anything but `ready` as "sign in needed".
 */
export interface SubscriptionLoginFacts {
    /** The product family behind the connection (`chatgpt`). */
    provider: string
    /** `pending_login`, `ready`, or `needs_login`. */
    loginState: string
    /** Bumps on every stored login change, a pushed refresh included. */
    loginVersion?: number
    /** Bumps only on a new device login. */
    loginGeneration?: number
    /** Why the last run found the login unusable; shown next to Sign in again. */
    loginError?: string | null
}

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
    /** Provider-supplied display names keyed by model id. */
    modelNames?: Record<string, string>
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
    /** Public management policy for the row; internal manager identity is never exposed. */
    managementPolicy?: string
    /** Present only on a `subscription_provider` row: how usable its stored sign-in is. */
    subscription?: SubscriptionLoginFacts
    id?: string
    type?: string
    created_at?: string
}
