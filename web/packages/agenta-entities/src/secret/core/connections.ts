/**
 * Provider connections — the derived shape the AI-providers settings surface works with, and the
 * pure rules behind the connection card.
 *
 * A connection is one stored vault record: a standard `provider_key` or a `custom_provider`. The
 * project may hold several per provider family, so identity is the record, never the family. The
 * functions here are deliberately free of React, atoms, and the harness-catalog query — they take
 * data and return data, which is what makes the card's gating and model-merge rules testable.
 *
 * Design: docs/design/provider-connections-models/experience.md ("Provider connection card").
 */

import type {LlmProvider} from "@agenta/shared/types"
import {extractApiErrorMessage} from "@agenta/shared/utils"

import {
    carriedCredentialKeys,
    credentialFieldsForKind,
    deploymentForProviderKind,
    providerTitleForKind,
    secretKindForProviderKind,
    toProviderCredentials,
    type CredentialValues,
} from "./providerCatalog"
import {PROVIDER_AUTH_REQUIREMENTS} from "./providerFields"
import {
    PROVIDER_KINDS,
    SECRET_VALUE_FIELDS,
    SecretKind,
    VAULT_PERSIST_REDACTED,
    type CreateSecretDto,
    type SecretManagementPolicy,
} from "./types"

// ---------------------------------------------------------------------------
// The connection model
// ---------------------------------------------------------------------------

export interface ProviderConnection {
    /** Vault record id — what update and delete address. */
    id: string
    /** Stable slug assigned on create. Absent on records that predate it. */
    slug?: string
    /** Display name. Falls back to the provider title for records created before names existed. */
    name: string
    /** Vault provider kind (`openai`, `azure`, …). */
    kind: string
    /** User-visible provider name. */
    title: string
    secretKind: SecretKind
    /** Saved active models. `undefined` means "use Agenta's defaults"; `[]` means "offer none". */
    models?: string[]
    /** Saved harness policy. `undefined` means "any harness Agenta supports". */
    harnesses?: string[]
    createdAt?: string
    /**
     * The vault holds a credential for this connection. On a write-only record this is the ONLY
     * presence signal there is — the value never comes back — so every "is it configured" check
     * reads this rather than the credential fields.
     */
    hasStoredCredential: boolean
    /** Masked credential (`sk-****9Qa`), when the record carries one. */
    keyPreview?: string
    /** Server-enforced management policy. Manager-only rows may not be edited or deleted by users. */
    managementPolicy?: SecretManagementPolicy
    /** The row this was derived from — the mutations round-trip it. */
    source: LlmProvider
}

/** Normalize a stored provider label (kind, env name, or title) to a canonical vault kind. */
const canonicalKind = (value: string | undefined): string => {
    if (!value) return ""
    const trimmed = value.trim()
    return PROVIDER_KINDS[trimmed] ?? PROVIDER_KINDS[trimmed.toLowerCase()] ?? trimmed.toLowerCase()
}

/**
 * Every connected provider, newest last, from the vault rows.
 *
 * Named secrets are not connections and drop out. A standard row identifies its provider through
 * `title` (the stored kind); a custom row through `provider`.
 */
export const toProviderConnections = (rows: LlmProvider[]): ProviderConnection[] =>
    rows.reduce<ProviderConnection[]>((acc, row) => {
        if (row.type !== SecretKind.ProviderKey && row.type !== SecretKind.CustomProvider) {
            return acc
        }
        if (!row.id) return acc

        const kind = canonicalKind(
            row.type === SecretKind.ProviderKey ? row.title : (row.provider ?? ""),
        )
        const title = providerTitleForKind(kind)

        acc.push({
            id: row.id,
            slug: row.slug,
            // A `provider_key` row created before named connections has no header name; the
            // provider title is what the user has always seen for it.
            name:
                row.displayName ||
                (row.type === SecretKind.CustomProvider ? row.name : "") ||
                title,
            kind,
            title,
            secretKind: row.type as SecretKind,
            models: row.models,
            harnesses: row.harnesses,
            createdAt: row.created_at,
            // A readable record proves it by carrying the value; a write-only one only says so.
            hasStoredCredential:
                row.hasKey ?? SECRET_VALUE_FIELDS.some((field) => !!(row[field] ?? "").trim()),
            keyPreview: row.keyPreview,
            managementPolicy: row.managementPolicy as SecretManagementPolicy | undefined,
            source: row,
        })
        return acc
    }, [])

/**
 * The credential form values a saved connection seeds its card with.
 *
 * A standard record keeps its key in `LlmProvider.key`; every other kind already stores its fields
 * under their own names. Both arrive as `apiKey` here so the card has one form shape.
 *
 * A row restored from IndexedDB carries `[redacted]` where its secret values were, and the live
 * refetch that replaces them has not landed yet. Seeding that sentinel would let Done save the
 * literal string over a real key, so it reads as "nothing typed yet" instead.
 */
export const credentialValuesFor = (connection: ProviderConnection): CredentialValues => {
    const row = connection.source as unknown as Record<string, unknown>
    const values: CredentialValues = {}
    const read = (key: string): string => {
        const stored =
            key === "apiKey" && connection.secretKind === SecretKind.ProviderKey
                ? connection.source.key
                : row[key]
        if (typeof stored !== "string" || stored === VAULT_PERSIST_REDACTED) return ""
        return stored
    }

    for (const field of credentialFieldsForKind(connection.kind)) {
        values[field.key] = read(field.key)
    }
    // Stored but never rendered (an AWS session token) — carried so a save does not drop it.
    for (const key of carriedCredentialKeys(connection.kind)) {
        values[key] = read(key)
    }

    return values
}

/**
 * The credential fields a saved connection already satisfies without the user retyping them.
 *
 * A write-only record returns no values, so its secret fields arrive empty on every edit. Treating
 * them as unfilled would lock the card: changing only the model list would demand the key again.
 * Non-secret fields (endpoint, region) still come back and need no exemption.
 */
export const storedCredentialFields = (
    connection: ProviderConnection | null | undefined,
): string[] => {
    if (!connection?.hasStoredCredential) return []
    const keys = [
        ...credentialFieldsForKind(connection.kind).map((field) => field.key),
        ...carriedCredentialKeys(connection.kind),
    ]
    return keys.filter((key) => (SECRET_VALUE_FIELDS as readonly string[]).includes(key))
}

/** The probe request body: a credential to spend, or the vault row to spend one from. */
export interface ProbeRequestBody {
    /** Omitted alongside `secret_id`: the stored row names its own kind. */
    kind?: string
    provider: ReturnType<typeof toProviderCredentials>
    /** Vault row whose stored credentials the server resolves for this probe. */
    secret_id?: string
}

/** Drop every blank value, and any `extras` left empty by dropping them. */
const withoutBlanks = (
    provider: ReturnType<typeof toProviderCredentials>,
): ReturnType<typeof toProviderCredentials> => {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(provider)) {
        if (key === "extras") {
            const extras = Object.fromEntries(
                Object.entries((value ?? {}) as Record<string, string>).filter(([, entry]) =>
                    (entry ?? "").trim(),
                ),
            )
            if (Object.keys(extras).length) out.extras = extras
            continue
        }
        if (typeof value === "string" && !value.trim()) continue
        out[key] = value
    }
    return out
}

/**
 * The probe request for a Test press.
 *
 * A write-only connection hands its secret back to nobody, so a card sitting on one has nothing to
 * put in the credential — testing it used to mean retyping the key. When the user typed no secret
 * material and the vault holds some, the request names the row (`secret_id`) and the server
 * resolves the credential itself.
 *
 * Typed fields still ride along, and the server overrides the resolved value field by field, so an
 * edited base URL can be tested against the saved key. Blank fields are dropped rather than sent
 * empty: an empty `key` alongside a `secret_id` would read as "test with no credential", which is
 * a different question and, for an OpenAI-compatible endpoint, a legitimate one.
 *
 * `kind` is omitted whenever the row is named. The stored kind is authoritative, and the server
 * rejects (422) a `kind` that disagrees with it unless a key rides along — which is exactly the
 * request this builds. Sending the card's own kind would put the FE's canonical spelling in a
 * position to contradict the vault's over nothing.
 */
export const probeRequestFor = (
    kind: string,
    credential: CredentialValues,
    connection?: ProviderConnection | null,
): ProbeRequestBody => {
    const provider = toProviderCredentials(kind, credential)
    const typedSecret = SECRET_VALUE_FIELDS.some((field) => (credential[field] ?? "").trim())
    if (typedSecret || !connection?.hasStoredCredential || !connection.id) {
        return {kind, provider}
    }
    return {provider: withoutBlanks(provider), secret_id: connection.id}
}

/** The HTTP status of a failed request, when it carried one. */
const statusOf = (error: unknown): number | null => {
    const statusCode = (error as {statusCode?: unknown})?.statusCode
    if (typeof statusCode === "number") return statusCode

    const response = (error as {response?: {status?: unknown}})?.response
    return typeof response?.status === "number" ? response.status : null
}

/** The structured error body from Fern or Axios, when either supplied one. */
const bodyOf = (error: unknown): unknown => {
    const body = (error as {body?: unknown})?.body
    if (body !== undefined) return body
    return (error as {response?: {data?: unknown}})?.response?.data
}

/**
 * Why a Test never produced a verdict.
 *
 * A probe OUTCOME is an HTTP 200 with a status inside, so anything that throws here is the request
 * itself failing. The default reads as "we could not reach the provider", which is true of a
 * transport failure and false of everything the API rejects on its own — a 404 means the stored
 * connection is gone, not that the provider is down. So a 4xx speaks with the server's own words
 * where it gave any, and only a 5xx or a dead connection falls back to the reach-the-provider line.
 */
// TODO(copy: owner)
export const probeFailureMessage = (error: unknown, title: string): string => {
    const status = statusOf(error)
    if (status === 404) return "This connection no longer exists. Reload and try again."
    if (status && status >= 400 && status < 500) {
        const message = extractApiErrorMessage(bodyOf(error) ?? error)
        if (message && message !== String(error)) return message
    }
    return `Agenta could not reach ${title} to test this credential.`
}

/**
 * Whether this kind has enough credential to be worth testing or saving.
 *
 * Two rules, because providers state their requirement two ways: every field marked required must
 * be filled, and a provider with alternative auth sets (Bedrock: a bearer token OR an access-key
 * pair) must satisfy one of them. A kind that declares neither still needs something typed —
 * otherwise Done would happily store an empty connection.
 *
 * `stored` names the fields the vault already holds (see `storedCredentialFields`); they count as
 * filled even though the card shows them empty.
 */
export const hasRequiredCredential = (
    kind: string,
    values: CredentialValues,
    stored: readonly string[] = [],
): boolean => {
    const filled = (key: string) => !!(values[key] ?? "").trim() || stored.includes(key)
    const fields = credentialFieldsForKind(kind)

    if (!fields.every((field) => !field.required || filled(field.key))) return false

    const auth = PROVIDER_AUTH_REQUIREMENTS[kind]
    if (auth) return auth.alternatives.some((set) => set.every((key) => filled(key)))

    if (fields.some((field) => field.required)) return true
    return fields.some((field) => filled(field.key))
}

/** A key rendered as `sk-••••9Qa`: enough to tell two keys apart, never enough to use one. */
export const maskSecret = (value: string): string =>
    value.length <= 8
        ? "•".repeat(Math.max(value.length, 4))
        : `${value.slice(0, 3)}••••${value.slice(-3)}`

/**
 * The Credential column: the masked key when the connection has one, otherwise the field that
 * identifies it (endpoint host, AWS region, Vertex project).
 */
export const credentialSummary = (connection: ProviderConnection): string => {
    const {source} = connection
    // A write-only record masks its own key server-side; only a readable one is masked here.
    if (connection.keyPreview) return connection.keyPreview
    const key = source.key || source.apiKey || source.bearerToken || source.accessKeyId
    if (key) return maskSecret(key)
    // TODO(copy: owner)
    if (connection.hasStoredCredential) return "Key configured"

    if (source.apiBaseUrl) {
        try {
            return new URL(source.apiBaseUrl).host
        } catch {
            return source.apiBaseUrl
        }
    }
    if (source.region) return source.region
    if (source.vertexProject) return source.vertexProject
    return "—"
}

// ---------------------------------------------------------------------------
// Default connection name
// ---------------------------------------------------------------------------

/**
 * The first free display name for a new connection of this provider — `OpenAI`, then `OpenAI 2`.
 *
 * A mirror of the API's `next_provider_key_name`, used only to PREVIEW the name in the card's
 * placeholder. The API assigns the real one, because two clients can create at the same time.
 */
export const nextConnectionName = (title: string, takenNames: Iterable<string>): string => {
    const taken = new Set(takenNames)
    if (!taken.has(title)) return title

    let index = 2
    while (taken.has(`${title} ${index}`)) index += 1
    return `${title} ${index}`
}

/** The placeholder a new connection's name field shows, given what the project already has. */
export const defaultNamePreview = (kind: string, connections: ProviderConnection[]): string =>
    nextConnectionName(
        providerTitleForKind(kind),
        connections.map((connection) => connection.name),
    )

// ---------------------------------------------------------------------------
// Model list
// ---------------------------------------------------------------------------

/** One row of the card's Active models list. */
export interface ModelOption {
    id: string
    checked: boolean
    /** Part of Agenta's default set for this provider — tagged in the list. */
    isDefault: boolean
    /** Saved and still checked, but absent from what the provider just returned. */
    unavailable: boolean
}

/** Structural view of one curated catalog record — only the identity and the display names. */
export interface HarnessModelCatalogEntry {
    id: string
    provider: string
    label?: string | null
    name?: string | null
}

/** Structural view of the harness catalog — only the fields the model list and harness rules read. */
export interface HarnessModelCapabilities {
    providers?: string[]
    deployments?: string[]
    models?: Record<string, string[]>
    default_models?: Record<string, string[]>
    /** Curated per-model records; a picker reads `label`/`name` for the model's display name. */
    model_catalog?: HarnessModelCatalogEntry[]
}

export type HarnessCapabilityMap = Record<string, HarnessModelCapabilities>

/**
 * A model id without its provider prefix (`openai/gpt-5.5` -> `gpt-5.5`).
 *
 * Harnesses spell the same model differently — Pi prefixes the family, Codex does not, Claude
 * names a tier — and the API resolves a saved id by full spelling OR provider-less tail. Storing
 * the tail therefore resolves everywhere, and collapsing on it stops one model appearing twice.
 */
export const bareModelId = (id: string, family: string): string =>
    id.startsWith(`${family}/`) ? id.slice(family.length + 1) : id

/**
 * The models a provider family offers according to the harness catalog, with Agenta's defaults.
 *
 * The union across every harness that can reach the family, because a connection is not bound to
 * one harness. Ids collapse onto their bare spelling, which is what gets saved: it resolves in
 * every harness, where a prefixed one only resolves in the harness that prefixes.
 */
export const providerModelCatalog = (
    capabilities: HarnessCapabilityMap | null | undefined,
    family: string,
): {models: string[]; defaults: string[]} => {
    if (!capabilities || !family) return {models: [], defaults: []}

    const models: string[] = []
    const seen = new Set<string>()
    const defaultIds = new Set<string>()

    const collect = (ids: string[] | undefined, isDefault: boolean) => {
        for (const id of ids ?? []) {
            const bare = bareModelId(id, family)
            if (!seen.has(bare)) {
                seen.add(bare)
                models.push(bare)
            }
            if (isDefault) defaultIds.add(bare)
        }
    }

    for (const harness of Object.values(capabilities)) {
        if (!harness.providers?.includes(family)) continue
        collect(harness.models?.[family], false)
        collect(harness.default_models?.[family], true)
    }

    return {models, defaults: models.filter((id) => defaultIds.has(id))}
}

/**
 * The models a connection offers when it saved no list of its own — the ONE fallback rule.
 *
 * Every surface that answers "what does this connection offer" goes through here: the table's
 * "Defaults", the drawer's "N models", and the prompt picker's rows. They used to spell it
 * separately and drift — the picker once offered a family's full 40-model catalog while the table
 * called the same record "Defaults" and the drawer counted 3.
 *
 * A connection with no saved list offers the provider's DEFAULT models. Anything beyond them is
 * something the user activates in Settings.
 */
export const defaultModelsFor = (
    connection: ProviderConnection,
    capabilities: HarnessCapabilityMap | null | undefined,
): string[] => {
    // The RECORD's kind, not the family's: a credential-set connection saved under a plain family
    // serves its own endpoint's keys, not Agenta's catalog for that family.
    if (connection.secretKind !== SecretKind.ProviderKey) {
        return (connection.source.modelKeys ?? []).filter(Boolean)
    }

    const {models, defaults} = providerModelCatalog(capabilities, connection.kind)
    return defaults.length ? defaults : models
}

/**
 * The order the card lists models in: hand-added ids first, then the saved selection and Agenta's
 * defaults, then the rest in the order the provider returned them.
 *
 * A hand-added model leads because it arrives CHECKED and the user typed it a moment ago — landing
 * it below every unticked catalog row (where it sorted before) read as the add having failed.
 *
 * Otherwise computed from fetch-stable inputs only — never from the LIVE checked set. Sorting by
 * what is currently ticked would move a row out from under the cursor on every click, so ticking
 * and unticking still reorder nothing; only adding does.
 */
export const modelDisplayOrder = ({
    available,
    prioritized = [],
    manual = [],
}: {
    available: string[]
    /** The ids that lead the list — the saved model list plus the provider's defaults. */
    prioritized?: string[]
    manual?: string[]
}): string[] => {
    const ids = [...new Set([...available, ...prioritized, ...manual])]
    const added = new Set(manual)
    const first = new Set(prioritized)
    return [
        ...ids.filter((id) => added.has(id)),
        ...ids.filter((id) => !added.has(id) && first.has(id)),
        ...ids.filter((id) => !added.has(id) && !first.has(id)),
    ]
}

/**
 * The card's model list: what the provider offers, plus anything checked or hand-entered that it
 * did not offer.
 *
 * `discovered` says whether `available` came from a live fetch. Only then can a checked model be
 * called unavailable — when the list is Agenta's shipped catalog, its absence proves nothing.
 *
 * `order` (from `modelDisplayOrder`) fixes the row order; ids it does not name keep their natural
 * position at the end. Without it the list stays in provider order.
 */
export const buildModelOptions = ({
    available,
    checked,
    manual = [],
    defaults = [],
    discovered = false,
    order,
}: {
    available: string[]
    checked: string[]
    manual?: string[]
    defaults?: string[]
    discovered?: boolean
    order?: string[]
}): ModelOption[] => {
    const availableSet = new Set(available)
    const checkedSet = new Set(checked)
    const defaultSet = new Set(defaults)
    const manualSet = new Set(manual)

    const ids = [...new Set([...available, ...checked, ...manual])]
    if (order?.length) {
        const rank = new Map(order.map((id, index) => [id, index]))
        ids.sort((a, b) => (rank.get(a) ?? order.length) - (rank.get(b) ?? order.length))
    }

    return ids.map((id) => ({
        id,
        checked: checkedSet.has(id),
        isDefault: defaultSet.has(id),
        unavailable: discovered && !availableSet.has(id) && !manualSet.has(id),
    }))
}

// ---------------------------------------------------------------------------
// Harness policy
// ---------------------------------------------------------------------------

/**
 * Whether a harness can technically drive this provider kind.
 *
 * A standard API key is reachable when the harness lists the family; the credential-set kinds are
 * reachable when the harness consumes that deployment surface. The saved harness list is user
 * policy layered on top — this is the technical limit underneath it.
 */
export const harnessSupportsProviderKind = (
    capabilities: HarnessCapabilityMap | null | undefined,
    harness: string,
    kind: string,
): boolean => {
    const entry = capabilities?.[harness]
    if (!entry) return false

    const deployment = deploymentForProviderKind(kind)
    if (deployment !== "direct") return !!entry.deployments?.includes(deployment)
    return !!entry.providers?.includes(kind)
}

// ---------------------------------------------------------------------------
// Done gating
// ---------------------------------------------------------------------------

/** What the probe concluded about the credential, mirroring the API's three answers. */
export type CredentialStatus = "valid" | "invalid" | "unknown"

export interface DoneState {
    enabled: boolean
    /** One line under the footer explaining the state; empty when there is nothing to say. */
    note: string
}

/**
 * Whether Done may save, given the credential and the last probe.
 *
 * `unknown` is not a failure: it means Agenta found no free, read-only way to check this provider,
 * so a filled credential saves with that stated plainly. `invalid` is the one state that blocks —
 * the provider itself rejected the credential, and saving it would only fail later.
 *
 * A credential that has not been tested at all only saves when it is the one already stored
 * (`storedCredentialUnchanged`) — reopening a saved connection to change its models must not
 * demand a fresh test, while a newly typed credential must be tested before it is stored.
 *
 * `transportFailed` says the test itself never reached the provider. The card already shows that
 * failure in its own line, so the footer stays quiet rather than asking for a test twice over.
 */
export const doneState = ({
    credentialFilled,
    status,
    storedCredentialUnchanged = false,
    transportFailed = false,
}: {
    credentialFilled: boolean
    status: CredentialStatus | null
    storedCredentialUnchanged?: boolean
    transportFailed?: boolean
}): DoneState => {
    if (!credentialFilled) return {enabled: false, note: ""}
    if (status === "invalid") return {enabled: false, note: ""}
    if (status === "valid") return {enabled: true, note: ""}
    if (status === "unknown") {
        return {
            enabled: true,
            note: "This provider offers no free credential check, so the key is saved untested.",
        }
    }
    if (storedCredentialUnchanged) return {enabled: true, note: ""}
    return {
        enabled: false,
        note: transportFailed ? "" : "Test this credential before saving it.",
    }
}

// ---------------------------------------------------------------------------
// Save payload
// ---------------------------------------------------------------------------

/** What the card sends when Done is pressed. */
export interface ConnectionDraft {
    kind: string
    /** Empty for a `provider_key`: the API assigns `OpenAI`, `OpenAI 2`, and so on. */
    name: string
    credential: CredentialValues
    /** The explicit list of checked models; `undefined` leaves the connection on Agenta's defaults. */
    models?: string[]
    /** The explicit harness policy; `undefined` leaves it open to any harness Agenta supports. */
    harnesses?: string[]
}

/**
 * The policy a save sends, given what the card knows.
 *
 * Both fields distinguish "the user chose this" from "nobody has chosen yet", because the vault
 * reads an omitted list and an empty one differently: omitted means Agenta's defaults apply, `[]`
 * means the connection offers none. So an untouched model list goes out omitted rather than
 * pinning today's defaults into the record, and a harness set that came out empty only because no
 * harness declares this deployment goes out omitted rather than saying "no harness may use this".
 */
export const connectionPolicyForSave = ({
    checkedModels,
    modelIds,
    harnesses,
    defaultHarness,
}: {
    /** The chosen models, or `null` while the list is still whatever the defaults imply. */
    checkedModels: string[] | null
    /** The ids currently checked in the card, used when the list has been chosen. */
    modelIds: string[]
    /** The chosen harnesses, or `null` while nobody has touched the section. */
    harnesses: string[] | null
    /** The harness the card would check by default, or `null` when it cannot reach this provider. */
    defaultHarness: string | null
}): {models?: string[]; harnesses?: string[]} => ({
    ...(checkedModels ? {models: modelIds} : {}),
    ...(harnesses ? {harnesses} : defaultHarness ? {harnesses: [defaultHarness]} : {}),
})

/**
 * The vault payload for a connection draft.
 *
 * A `provider_key` may go out header-less; the API names it after its provider. A
 * `custom_provider` is addressed by name, so an empty one is filled with the same preview the
 * card showed — the caller passes `fallbackName` for that.
 *
 * `models` and `harnesses` are written only when the draft carries them: an omitted field means
 * "Agenta's defaults", which is not the same record as an explicit empty list.
 */
export const buildConnectionPayload = (
    draft: ConnectionDraft,
    fallbackName: string,
): CreateSecretDto => {
    const name = draft.name.trim()
    const key = (draft.credential.apiKey ?? "").trim()
    const policy = {
        ...(draft.models ? {models: draft.models.map((slug) => ({slug}))} : {}),
        ...(draft.harnesses ? {harnesses: draft.harnesses} : {}),
    }

    if (secretKindForProviderKind(draft.kind) === SecretKind.ProviderKey) {
        return {
            header: name ? {name} : {},
            secret: {
                kind: SecretKind.ProviderKey,
                data: {
                    kind: draft.kind,
                    // An omitted key means "keep the stored value"; `""` would blank it.
                    provider: key ? {key} : {},
                    ...policy,
                },
            },
        } as CreateSecretDto
    }

    const provider = toProviderCredentials(draft.kind, draft.credential)

    return {
        header: {name: name || fallbackName},
        secret: {
            kind: SecretKind.CustomProvider,
            data: {
                kind: draft.kind,
                provider: {
                    ...(provider.url ? {url: provider.url} : {}),
                    ...(provider.version ? {version: provider.version} : {}),
                    // The vault's own vocabulary: the key lives in `extras`, unlike the probe
                    // request, where each adapter reads it where its provider expects it.
                    extras: {
                        ...(provider.extras ?? {}),
                        ...(key ? {api_key: key} : {}),
                    },
                },
                // A `custom_provider` record always declares `models`; an untouched card sends the
                // empty list the API already stores for it.
                models: policy.models ?? [],
                ...(policy.harnesses ? {harnesses: policy.harnesses} : {}),
            },
        },
    } as CreateSecretDto
}
