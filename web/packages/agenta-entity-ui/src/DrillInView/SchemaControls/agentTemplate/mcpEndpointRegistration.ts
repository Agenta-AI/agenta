/**
 * Registering the MCP server an agent config declares as a gateway MCP endpoint.
 *
 * A declared server is a D30 `custom` target, and the SDK resolver routes every one of them to
 * `gateways/mcps/custom/{server name}` as soon as a gateway is configured — it never dials the
 * author's URL. So the URL the drawer collects is only useful if an endpoint row exists under
 * that exact slug (D35: a gateway target is registered before an agent can use it). This module
 * registers it on save and rewrites the item's `name` to the registered slug, so the two cannot
 * drift.
 */
import {axios, getAgentaApiUrl, getHostQueryClient} from "@agenta/shared/api"

/** `auth_mode` values the backend `MCPEndpoint` accepts. */
export type McpEndpointAuthMode = "none" | "api_key" | "oauth"

export interface McpEndpointRegistration {
    slug: string
    name: string
    baseUrl: string
    authMode: McpEndpointAuthMode
    /** The header the server wants its key in, taken from the drawer's secret-header row. */
    credentialHeader?: string
    /** The project secret the drawer bound, named by slug because that is what the config stores. */
    secretSlug?: string
}

interface McpEndpointRow {
    id?: string | null
    slug?: string | null
    auth_mode?: McpEndpointAuthMode
    secret_id?: string | null
    data?: {
        route?: {
            base_url?: string | null
            headers?: Record<string, string> | null
            credential_header?: string | null
        }
        /** The tool allow/denylist and the endpoint's own settings: policy, carried over. */
        tools?: Record<string, unknown> | null
        settings?: Record<string, unknown> | null
    }
    /**
     * Whether the endpoint is active and valid. Set against the endpoint, never by this
     * drawer, and the `PUT` replaces them wholesale, so the row's own values are echoed
     * back rather than left to the backend default of active-and-valid.
     */
    flags?: Record<string, unknown> | null
}

/** One row of the project's named secrets, as the vault list returns it. */
export interface NamedSecretOption {
    id?: string | null
    slug?: string | null
}

const ENDPOINTS_URL = () => `${getAgentaApiUrl()}/gateways/mcps/endpoints/`

// The backend `Slug` mixin: first character alphanumeric / `_` / `-`, then dots allowed too.
const SLUG_LEAD = /^[^A-Za-z0-9_-]+/
const SLUG_UNSAFE = /[^A-Za-z0-9_.-]+/g

/**
 * The URL-safe slug an MCP server name registers under. Case is preserved, so a name that is
 * already slug-safe (the form's own character class) registers verbatim and the config item keeps
 * the name the author typed.
 */
export function deriveMcpEndpointSlug(name: string): string {
    return name.trim().replace(SLUG_UNSAFE, "-").replace(SLUG_LEAD, "").slice(0, 128)
}

/** The endpoint `auth_mode` for the drawer's authentication choice. */
export function mcpEndpointAuthMode(credentialType: unknown): McpEndpointAuthMode {
    if (credentialType === "oauth") return "oauth"
    return credentialType === "header_secret_refs" ? "api_key" : "none"
}

/** What a draft MCP server must register, or `null` when it declares no HTTP URL to register. */
export function mcpEndpointRegistrationFromDraft(
    draft: Record<string, unknown>,
): McpEndpointRegistration | null {
    const name = String(draft.name ?? "").trim()
    const slug = deriveMcpEndpointSlug(name)
    const connection =
        draft.connection && typeof draft.connection === "object"
            ? (draft.connection as Record<string, unknown>)
            : {}
    // A gateway connection already names a registered route; only an author-supplied HTTP URL
    // needs a row created for it.
    if (connection.type === "gateway") return null
    const baseUrl = String(connection.url ?? "").trim()
    if (!slug || !baseUrl) return null
    const credentials =
        connection.credentials && typeof connection.credentials === "object"
            ? (connection.credentials as Record<string, unknown>)
            : {}
    // `header_secret_refs` is a `{header name: secret slug}` map, and the drawer writes at most
    // one entry. Both halves are needed: the gateway resolves the secret and puts it in that
    // header, which is the same request the SDK sends when it dials the server without a gateway.
    const [header, secretSlug] = Object.entries(
        (credentials.headers && typeof credentials.headers === "object"
            ? (credentials.headers as Record<string, unknown>)
            : {}) as Record<string, unknown>,
    )[0] ?? [undefined, undefined]
    return {
        slug,
        name,
        baseUrl,
        authMode: mcpEndpointAuthMode(credentials.type),
        credentialHeader: typeof header === "string" && header ? header : undefined,
        secretSlug: typeof secretSlug === "string" && secretSlug ? secretSlug : undefined,
    }
}

/**
 * The id of the project secret the drawer bound, or null when it bound none.
 *
 * The agent config names a secret by slug, because that is the name an author writes and the
 * SDK resolves. The endpoint row names one by id. This is the single place the two meet, so a
 * slug the project no longer has resolves to null and the endpoint registers unauthenticated
 * rather than pointing at a secret that is not there.
 */
export function resolveMcpEndpointSecretId(
    slug: string | undefined,
    namedSecrets: NamedSecretOption[],
): string | null {
    if (!slug) return null
    const match = namedSecrets.find((row) => row.slug === slug && row.id)
    return match?.id ?? null
}

/**
 * The `POST /gateways/mcps/endpoints/` body for a server the project has never registered.
 *
 * `secret_id` is always present, `null` included: an `api_key` endpoint without one is refused
 * by the service on every call, so leaving the field off the payload is what made an API-key
 * registration produce an endpoint that could never run.
 */
export function buildMcpEndpointCreate(
    registration: McpEndpointRegistration,
    secretId: string | null = null,
) {
    return {
        slug: registration.slug,
        name: registration.name || registration.slug,
        auth_mode: registration.authMode,
        secret_id: secretId,
        data: {
            route: {
                base_url: registration.baseUrl,
                credential_header: registration.credentialHeader ?? null,
            },
        },
    }
}

/**
 * The `PUT` body for a slug the project already registered: the URL, name and credential binding
 * follow the drawer, the rest of the stored route is carried over. An OAuth-connected row keeps
 * `auth_mode: oauth` — the drawer cannot express OAuth, so its choice must not disconnect an
 * endpoint, and it keeps the row's own `secret_id`, which holds the grant.
 *
 * The row's `flags` are carried over for the same reason (OR51). The request is a full PUT over
 * the editable surface, and a body that omits `flags` is not read as "leave them alone": the
 * backend fills in its default of active-and-valid, so saving a drawer that knows nothing about
 * them re-enabled an endpoint an administrator had disabled.
 */
export function buildMcpEndpointEdit(
    registration: McpEndpointRegistration,
    existing: McpEndpointRow,
    secretId: string | null = null,
) {
    const keepsOAuth = existing.auth_mode === "oauth"
    // The drawer owns the binding only when it names a secret. An OAuth row's `secret_id` holds
    // the grant, and a row the drawer left unauthenticated keeps whatever it already had, so
    // neither is overwritten by a registration that says nothing about a secret.
    const boundSecretId = registration.secretSlug ? secretId : (existing.secret_id ?? null)
    return {
        id: existing.id as string,
        name: registration.name || registration.slug,
        auth_mode: keepsOAuth ? "oauth" : registration.authMode,
        secret_id: keepsOAuth ? (existing.secret_id ?? null) : boundSecretId,
        data: {
            ...existing.data,
            route: {
                ...existing.data?.route,
                base_url: registration.baseUrl,
                credential_header: registration.credentialHeader ?? null,
            },
        },
        ...(existing.flags ? {flags: existing.flags} : {}),
    }
}

/**
 * Strip the drawer's `oauth` credential marker out of the item that gets saved.
 *
 * OAuth is a property of the gateway endpoint, not of the agent config: the gateway holds the
 * grant and the SDK dials `gateways/mcps/custom/{name}` with the platform's own credentials. The
 * SDK's `MCPCredentials` union accepts only `none` and `header_secret_refs` under
 * `extra="forbid"`, so a config that carried `{"type": "oauth"}` would fail MCP parsing and take
 * the whole agent run down. The endpoint row's `auth_mode` is what remembers the choice, and the
 * drawer reads it back from there.
 */
export function normalizeMcpDraftCredentials(
    draft: Record<string, unknown>,
): Record<string, unknown> {
    const connection =
        draft.connection && typeof draft.connection === "object"
            ? (draft.connection as Record<string, unknown>)
            : undefined
    if (!connection) return draft
    const credentials =
        connection.credentials && typeof connection.credentials === "object"
            ? (connection.credentials as Record<string, unknown>)
            : undefined
    if (credentials?.type !== "oauth") return draft
    return {...draft, connection: {...connection, credentials: {type: "none"}}}
}

/** The backend's own message when it sent one, so the drawer never shows a bare status code. */
export function registrationErrorDetail(error: unknown): string {
    const response = (error as {response?: {data?: {detail?: unknown}}})?.response
    const detail = response?.data?.detail
    if (typeof detail === "string" && detail.trim()) return detail
    return (error as Error)?.message || "the request failed"
}

/**
 * Register the drafted server, then return the item with `name` set to the registered slug — the
 * value the SDK resolver puts in the gateway route. Throws when registration fails, so a config
 * item that cannot run is never saved.
 */
export async function registerMcpServerDraft(
    draft: Record<string, unknown>,
    projectId: string | null | undefined,
    namedSecrets: NamedSecretOption[] = [],
): Promise<Record<string, unknown>> {
    const registration = mcpEndpointRegistrationFromDraft(draft)
    if (!registration) return draft

    const boundSecretId = resolveMcpEndpointSecretId(registration.secretSlug, namedSecrets)
    const params = projectId ? {project_id: projectId} : undefined
    try {
        const listed = await axios.get(ENDPOINTS_URL(), {params})
        const rows: McpEndpointRow[] = listed.data?.endpoints ?? []
        const existing = rows.find((row) => row.slug === registration.slug && row.id)

        if (existing) {
            await axios.put(
                `${ENDPOINTS_URL()}${existing.id}`,
                {endpoint: buildMcpEndpointEdit(registration, existing, boundSecretId)},
                {params},
            )
        } else {
            await axios.post(
                ENDPOINTS_URL(),
                {endpoint: buildMcpEndpointCreate(registration, boundSecretId)},
                {params},
            )
        }
    } catch (error) {
        throw new Error(
            `Could not register the MCP server "${registration.slug}" with the gateway: ${registrationErrorDetail(error)}`,
        )
    }

    // Same key the settings table's query uses, so the new row shows there immediately.
    await getHostQueryClient().invalidateQueries({queryKey: ["mcp-endpoints"]})

    return normalizeMcpDraftCredentials({...draft, name: registration.slug})
}
