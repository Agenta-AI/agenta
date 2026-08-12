/**
 * The AI-provider catalog — the one ordered list of providers a project can connect, plus the
 * per-kind knowledge that turns a catalog row into a credential form, a probe request, and a
 * vault payload.
 *
 * Two vault record shapes hide behind one catalog: the standard providers store a single API key
 * (`provider_key`), while AWS Bedrock, Azure OpenAI, Google Vertex AI, and OpenAI-compatible
 * endpoints store a field set (`custom_provider`). The catalog row carries which one it is so the
 * connection card never branches on a provider name.
 *
 * Design: docs/design/provider-connections-models/experience.md ("Provider drawer").
 */

import {llmAvailableProviders} from "@agenta/shared/utils"

import {PROVIDER_FIELDS, fieldNoteForKind, type ProviderFieldConfig} from "./providerFields"
import {getEnvNameMap} from "./transforms"
import {PROVIDER_LABELS, SecretKind} from "./types"

/** One row of the "Add a provider" catalog. */
export interface ProviderCatalogEntry {
    /** The vault provider kind (`openai`, `azure`, `custom`, …) — the identity everything keys on. */
    kind: string
    /** User-visible provider name. */
    title: string
    /** Which vault record shape this provider stores as. */
    secretKind: SecretKind
}

/**
 * Providers dropped from the catalog. Aleph Alpha's company is defunct; stored records keep
 * resolving and keep rendering in the connections table, they just cannot be added again.
 */
const REMOVED_FROM_CATALOG = new Set(["alephalpha"])

/**
 * The credential-set providers offered in the catalog, in the order experience.md fixes: the three
 * cloud deployments as first-class rows, then the OpenAI-compatible endpoint last.
 */
const CUSTOM_CATALOG_KINDS = ["bedrock", "azure", "vertex_ai", "custom"] as const

/**
 * Every kind stored as a `custom_provider`, offered or not. SageMaker is no longer offered (like
 * Aleph Alpha), but a saved record must still classify as a credential set — read as a
 * `provider_key` it would render one API-key box and save away its region and access keys.
 */
const CUSTOM_PROVIDER_KINDS: readonly string[] = [...CUSTOM_CATALOG_KINDS, "sagemaker"]

const standardCatalogEntries = (): ProviderCatalogEntry[] => {
    const envToKind = getEnvNameMap()

    return llmAvailableProviders.reduce<ProviderCatalogEntry[]>((acc, provider) => {
        const kind = provider.name ? envToKind[provider.name] : undefined
        if (!kind || REMOVED_FROM_CATALOG.has(kind)) return acc

        acc.push({
            kind,
            title: PROVIDER_LABELS[kind] ?? provider.title ?? kind,
            secretKind: SecretKind.ProviderKey,
        })
        return acc
    }, [])
}

/** Every provider the "Add a provider" drawer offers, in catalog order. Never truncated. */
export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
    ...standardCatalogEntries(),
    ...CUSTOM_CATALOG_KINDS.map((kind) => ({
        kind,
        title: PROVIDER_LABELS[kind] ?? kind,
        secretKind: SecretKind.CustomProvider,
    })),
]

const CATALOG_BY_KIND = new Map(PROVIDER_CATALOG.map((entry) => [entry.kind, entry]))

/** The catalog row for a kind, including kinds no longer offered (they still have to render). */
export const catalogEntryForKind = (kind: string): ProviderCatalogEntry | undefined =>
    CATALOG_BY_KIND.get(kind)

/** The user-visible provider name for a kind, whether or not it is still in the catalog. */
export const providerTitleForKind = (kind: string): string =>
    CATALOG_BY_KIND.get(kind)?.title ?? PROVIDER_LABELS[kind] ?? kind

/** Which vault record shape a kind stores as. Unknown kinds are treated as standard. */
export const secretKindForProviderKind = (kind: string): SecretKind =>
    CATALOG_BY_KIND.get(kind)?.secretKind ??
    (CUSTOM_PROVIDER_KINDS.includes(kind) ? SecretKind.CustomProvider : SecretKind.ProviderKey)

/**
 * The deployment surface a kind reaches, in the harness catalog's `deployments` vocabulary. A
 * standard API key is always `direct`; the credential-set kinds name their own surface.
 */
export const deploymentForProviderKind = (kind: string): string =>
    CUSTOM_PROVIDER_KINDS.includes(kind) ? kind : "direct"

/**
 * What each credential-set kind cannot be reached without.
 *
 * `PROVIDER_FIELDS` marks nearly everything optional, which the legacy form compensated for with
 * its own branching. Declaring it here instead keeps the card's Test button honest: it only
 * offers to spend a credential once the provider has enough to answer with. Bedrock is absent
 * because its requirement is an either/or set — see `PROVIDER_AUTH_REQUIREMENTS`.
 */
const REQUIRED_FIELDS_BY_KIND: Record<string, string[]> = {
    azure: ["apiKey", "apiBaseUrl", "version"],
    // An OpenAI-compatible endpoint may legitimately be open; its URL is the credential's address.
    custom: ["apiBaseUrl"],
    vertex_ai: ["vertexCredentials"],
}

/**
 * The credential fields a kind's card renders, in order.
 *
 * Standard providers take one API key. The credential-set kinds reuse `PROVIDER_FIELDS` — the
 * same declarations the existing custom-provider form renders — minus the `name` field, because
 * the card gives the connection name its own section.
 *
 * Every kind's key lands on `LlmProvider.apiKey` in form state, including standard providers
 * (whose vault record stores it as `provider.key`). One form shape, one mapping, done in
 * `toProviderCredentials` / `buildConnectionPayload` rather than at each call site.
 */
export const credentialFieldsForKind = (kind: string): ProviderFieldConfig[] => {
    if (secretKindForProviderKind(kind) === SecretKind.ProviderKey) {
        const apiKey = PROVIDER_FIELDS.find((field) => field.key === "apiKey")
        return apiKey ? [{...apiKey, required: true}] : []
    }

    const required = new Set(REQUIRED_FIELDS_BY_KIND[kind] ?? [])

    return PROVIDER_FIELDS.filter(
        (field) => field.key !== "name" && !!field.model?.includes(kind),
    ).map((field) => ({
        ...field,
        // A field whose hint only holds for some kinds resolves it here, so every renderer reads
        // one `note`.
        note: fieldNoteForKind(field, kind),
        ...(required.has(field.key) ? {required: true} : {}),
    }))
}

/**
 * Fields a kind stores but does not render, and which a save must therefore carry back out.
 *
 * AWS session tokens belong to a temporary STS credential: nothing in the card asks for one, but
 * dropping a stored one on the next save would break the connection.
 */
const CARRIED_FIELDS_BY_KIND: Record<string, string[]> = {
    bedrock: ["sessionToken"],
    sagemaker: ["sessionToken"],
}

/** The stored fields a kind round-trips without rendering them. */
export const carriedCredentialKeys = (kind: string): string[] => CARRIED_FIELDS_BY_KIND[kind] ?? []

/** Form state for the credential section: the `LlmProvider` fields a card's kind declares. */
export type CredentialValues = Record<string, string>

/**
 * The `provider` block of a probe request for this kind.
 *
 * The probe adapters read a credential where the provider's own API expects it, which is not
 * always where the vault stores it: Azure and OpenAI-compatible endpoints authenticate with the
 * top-level `key`, while Bedrock and Vertex carry everything in `extras` under the vault's own
 * field names.
 */
export const toProviderCredentials = (
    kind: string,
    values: CredentialValues,
): {key?: string; url?: string; version?: string; extras?: Record<string, string>} => {
    const read = (field: string) => (values[field] ?? "").trim()
    const withoutEmpty = (extras: Record<string, string>) =>
        Object.fromEntries(Object.entries(extras).filter(([, value]) => !!value))

    switch (kind) {
        case "azure":
            return {key: read("apiKey"), url: read("apiBaseUrl"), version: read("version")}
        case "custom":
            return {key: read("apiKey"), url: read("apiBaseUrl")}
        // SageMaker rides with Bedrock: same AWS extras, and it renders the subset it declares.
        case "bedrock":
        case "sagemaker":
            return {
                extras: withoutEmpty({
                    aws_region_name: read("region"),
                    aws_bearer_token_bedrock: read("bearerToken"),
                    aws_access_key_id: read("accessKeyId"),
                    aws_secret_access_key: read("accessKey"),
                    aws_session_token: read("sessionToken"),
                }),
            }
        case "vertex_ai":
            return {
                url: read("apiBaseUrl"),
                extras: withoutEmpty({
                    vertex_ai_project: read("vertexProject"),
                    vertex_ai_location: read("vertexLocation"),
                    vertex_ai_credentials: read("vertexCredentials"),
                }),
            }
        default:
            return {key: read("apiKey")}
    }
}
