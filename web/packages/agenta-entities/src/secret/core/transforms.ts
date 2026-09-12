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

import {SUBSCRIPTION_PROVIDER_KIND, subscriptionProviderName} from "./subscriptionConnections"
import {
    PROVIDER_KINDS,
    SecretKind,
    McpStandardProviderKind,
    StandardProviderKind,
    type CreateSecretDto,
    type CustomProviderDto,
    type CustomSecretDto,
    type NamedSecretRow,
    type SecretResponseDto,
    type StandardProviderDto,
    type McpStandardProviderDto,
} from "./types"

// ---------------------------------------------------------------------------
// Provider-key ↔ env-var mapping (single source of truth)
//
// Standard provider secrets surface in the app under their env-var name
// (e.g. `OPENAI_API_KEY`). Keeping the kind → env mapping in one place
// avoids drift between `transformSecret` (kind → env) and `getEnvNameMap`
// (env → kind), and lets us surface unmapped providers explicitly. LLM and
// MCP standard-provider keys use separate catalogues for that mapping.
// ---------------------------------------------------------------------------

const LLM_STANDARD_PROVIDER_ENV_BY_KIND: Partial<Record<StandardProviderKind, string>> = {
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

const MCP_STANDARD_PROVIDER_ENV_BY_KIND: Record<McpStandardProviderKind, string> = {
    [McpStandardProviderKind.Mock]: "MOCK_API_KEY",
    [McpStandardProviderKind.Composio]: "COMPOSIO_API_KEY",
}

// Legacy aliases that map to the same canonical env var as their primary
// counterpart. Used only in the reverse direction (env → kind).
const LLM_STANDARD_PROVIDER_ENV_ALIASES: Record<string, StandardProviderKind> = {
    MISTRALAI_API_KEY: StandardProviderKind.Mistral,
}

/**
 * Whether the vault holds a key for this row — the ONE presence check.
 *
 * A readable row proves it by carrying the value. A write-only row never returns one, so it says
 * so with `hasKey` instead; reading `!!row.key` on it would report every connection as keyless.
 */
export const hasStoredKey = (provider: LlmProvider | null | undefined): boolean =>
    provider?.hasKey ?? !!provider?.key

/**
 * Transform raw `/secrets/` response items into the `LlmProvider` shape
 * used throughout the app. Standard provider secrets and custom provider
 * secrets have different wire shapes; both collapse into the common
 * `LlmProvider` representation here.
 *
 * Standard secrets whose `kind` isn't in `LLM_STANDARD_PROVIDER_ENV_BY_KIND`
 * or `MCP_STANDARD_PROVIDER_ENV_BY_KIND` are dropped (with a warning) — the
 * app uses the env-var name as the provider identity, so an unmapped kind
 * would surface as a nameless row.
 */
/**
 * The fields every row carries about its own value, whichever kind it is.
 *
 * The public API reports value presence and an optional safe preview through `value_status`.
 * The UI maps those general facts into its provider-specific connection model here.
 */
const storageFacts = (secret: SecretResponseDto) => ({
    writeOnly: secret.write_only ?? undefined,
    hasKey: secret.value_status.configured,
    keyPreview: secret.value_status.preview ?? undefined,
    managementPolicy: secret.management?.policy,
})

const modelNames = (models: {slug: string; extras?: Record<string, unknown> | null}[]) =>
    Object.fromEntries(
        models.flatMap((model) =>
            typeof model.extras?.name === "string" ? [[model.slug, model.extras.name]] : [],
        ),
    )

export const transformSecret = (secrets: SecretResponseDto[]): LlmProvider[] => {
    return secrets.reduce((acc, secret) => {
        if (secret.kind === SecretKind.ProviderKey) {
            const data = secret.data as StandardProviderDto | McpStandardProviderDto

            const provider = data.kind
            const envName =
                LLM_STANDARD_PROVIDER_ENV_BY_KIND[provider as StandardProviderKind] ??
                MCP_STANDARD_PROVIDER_ENV_BY_KIND[provider as McpStandardProviderKind]
            if (!envName) {
                console.warn(`[vault] Unmapped provider key kind "${provider}" — skipping.`)
                return acc
            }

            acc.push({
                ...storageFacts(secret),
                title: provider,
                key: data.provider.key ?? undefined,
                name: envName,
                id: secret.id ?? undefined,
                slug: secret.slug ?? undefined,
                // Several connections can share a provider family, so the record's own name is
                // what tells them apart. Absent on records created before named connections.
                displayName: secret.header?.name ?? undefined,
                type: secret.kind,
                // Absent stays absent: no saved list means "use the defaults", which an empty
                // array would misreport as "this connection offers no models".
                models: "models" in data ? data.models?.map((model) => model.slug) : undefined,
                modelNames: "models" in data && data.models ? modelNames(data.models) : undefined,
                harnesses: "harnesses" in data ? (data.harnesses ?? undefined) : undefined,
                created_at: secret.lifecycle?.created_at ?? undefined,
            })
        } else if (secret.kind === SecretKind.CustomProvider) {
            const data = secret.data as CustomProviderDto
            const extras = (data.provider.extras ?? {}) as Record<string, string | undefined>

            acc.push({
                ...storageFacts(secret),
                name: secret.header.name ?? "",
                displayName: secret.header.name ?? undefined,
                id: secret.id ?? undefined,
                slug: secret.slug ?? undefined,
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
                bearerToken: extras.aws_bearer_token_bedrock || "",
                models: data.models.map((model) => model.slug),
                modelNames: modelNames(data.models),
                modelKeys: data.model_keys ?? undefined,
                harnesses: data.harnesses ?? undefined,
                version: data.provider.version ?? "",
                created_at: secret.lifecycle?.created_at ?? "",
            })
        } else if ((secret.kind as string) === SUBSCRIPTION_PROVIDER_KIND) {
            // Not a Fern union member yet, so the payload is read field by field rather than cast.
            // Every field is optional on purpose: a browser on an older bundle must still render
            // the row, and an unreadable state falls back to "sign in needed".
            const data = (secret.data ?? {}) as unknown as Record<string, unknown>
            const provider = typeof data.provider === "string" ? data.provider : "chatgpt"
            const stringList = (value: unknown): string[] | undefined =>
                Array.isArray(value)
                    ? value.filter((id): id is string => typeof id === "string")
                    : undefined

            acc.push({
                ...storageFacts(secret),
                title: provider,
                name: secret.header?.name ?? subscriptionProviderName(provider),
                displayName: secret.header?.name ?? undefined,
                id: secret.id ?? undefined,
                slug: secret.slug ?? undefined,
                type: SUBSCRIPTION_PROVIDER_KIND,
                provider,
                models: stringList(data.models),
                modelKeys: stringList(data.model_keys),
                harnesses: stringList(data.harnesses),
                subscription: {
                    provider,
                    loginState:
                        typeof data.login_state === "string" ? data.login_state : "pending_login",
                    loginVersion:
                        typeof data.login_version === "number" ? data.login_version : undefined,
                    loginGeneration:
                        typeof data.login_generation === "number"
                            ? data.login_generation
                            : undefined,
                    loginError: typeof data.login_error === "string" ? data.login_error : null,
                },
                created_at: secret.lifecycle?.created_at ?? undefined,
            })
        } else if (secret.kind === SecretKind.CustomSecret) {
            // `secret.data` is the Fern union; kind already discriminates it, but
            // CustomSecretDto shares no fields with the provider members, so TS
            // needs the explicit unknown step.
            const data = secret.data as unknown as CustomSecretDto

            const row: NamedSecretRow = {
                ...storageFacts(secret),
                name: secret.header.name ?? "",
                slug: secret.slug ?? undefined,
                format: data.secret.format,
                defaultEnvVar: data.secret.default_env_var ?? undefined,
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
 * Transform a form-shaped `LlmProvider` into a `CreateSecretDto` for a standard provider
 * connection.
 *
 * `models` and `harnesses` ride along only when the caller has them: a connection that saved
 * no list keeps using Agenta's defaults, and sending an empty one instead would mean "offer
 * nothing".
 */
export const transformStandardProviderPayloadData = (
    values: LlmProvider,
    providerKind: StandardProviderKind,
): CreateSecretDto =>
    ({
        header: {
            name: values.title,
        },
        secret: {
            kind: SecretKind.ProviderKey,
            data: {
                kind: providerKind,
                // An omitted key means "keep the stored value"; `""` would blank it.
                provider: values.key ? {key: values.key} : {},
                ...(values.models
                    ? {
                          models: values.models.map((slug) => ({
                              slug,
                              ...(values.modelNames?.[slug]
                                  ? {extras: {name: values.modelNames[slug]}}
                                  : {}),
                          })),
                      }
                    : {}),
                ...(values.harnesses ? {harnesses: values.harnesses} : {}),
            } satisfies StandardProviderDto,
        },
    }) as CreateSecretDto

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
                        aws_bearer_token_bedrock: values.bearerToken,
                    },
                },
                models:
                    values.models?.map((slug) => ({
                        slug,
                        ...(values.modelNames?.[slug]
                            ? {extras: {name: values.modelNames[slug]}}
                            : {}),
                    })) ?? [],
                ...(values.harnesses ? {harnesses: values.harnesses} : {}),
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
                ...(values.defaultEnvVar !== undefined
                    ? {default_env_var: values.defaultEnvVar || null}
                    : {}),
                // An omitted content means "keep the stored value"; a write-only record is only
                // ever replaced, never read back, so an untouched edit must send nothing.
                ...(values.content === undefined ? {} : {content: values.content}),
            },
        } as CustomSecretDto,
    },
})

/**
 * Map the env-var name (e.g. `OPENAI_API_KEY`) used by `LlmProvider.name`
 * back to the canonical `StandardProviderKind` value used when creating
 * an LLM standard provider secret. Derived from `LLM_STANDARD_PROVIDER_ENV_BY_KIND`
 * so the two directions can't drift.
 *
 * Returns `undefined` for unknown env-var names; the caller is expected
 * to throw a domain error in that case.
 */
export const getEnvNameMap = (): Record<string, StandardProviderKind> => {
    const reverse = Object.entries(LLM_STANDARD_PROVIDER_ENV_BY_KIND).reduce(
        (acc, [kind, env]) => {
            if (env) acc[env] = kind as StandardProviderKind
            return acc
        },
        {} as Record<string, StandardProviderKind>,
    )
    return {...reverse, ...LLM_STANDARD_PROVIDER_ENV_ALIASES}
}
