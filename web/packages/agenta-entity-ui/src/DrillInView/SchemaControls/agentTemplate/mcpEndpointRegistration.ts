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
}

interface McpEndpointRow {
    id?: string | null
    slug?: string | null
    auth_mode?: McpEndpointAuthMode
    secret_id?: string | null
    data?: {route?: {base_url?: string | null; headers?: Record<string, string> | null}}
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
    return {slug, name, baseUrl, authMode: mcpEndpointAuthMode(credentials.type)}
}

/** The `POST /gateways/mcps/endpoints/` body for a server the project has never registered. */
export function buildMcpEndpointCreate(registration: McpEndpointRegistration) {
    return {
        slug: registration.slug,
        name: registration.name || registration.slug,
        auth_mode: registration.authMode,
        data: {route: {base_url: registration.baseUrl}},
    }
}

/**
 * The `PUT` body for a slug the project already registered: the URL and name follow the drawer,
 * the rest of the stored route is carried over. An OAuth-connected row keeps `auth_mode: oauth` —
 * the drawer cannot express OAuth, so its choice must not disconnect an endpoint.
 */
export function buildMcpEndpointEdit(
    registration: McpEndpointRegistration,
    existing: McpEndpointRow,
) {
    return {
        id: existing.id as string,
        name: registration.name || registration.slug,
        auth_mode: existing.auth_mode === "oauth" ? "oauth" : registration.authMode,
        secret_id: existing.secret_id ?? null,
        data: {
            ...existing.data,
            route: {...existing.data?.route, base_url: registration.baseUrl},
        },
    }
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
): Promise<Record<string, unknown>> {
    const registration = mcpEndpointRegistrationFromDraft(draft)
    if (!registration) return draft

    const params = projectId ? {project_id: projectId} : undefined
    try {
        const listed = await axios.get(ENDPOINTS_URL(), {params})
        const rows: McpEndpointRow[] = listed.data?.endpoints ?? []
        const existing = rows.find((row) => row.slug === registration.slug && row.id)

        if (existing) {
            await axios.put(
                `${ENDPOINTS_URL()}${existing.id}`,
                {endpoint: buildMcpEndpointEdit(registration, existing)},
                {params},
            )
        } else {
            await axios.post(
                ENDPOINTS_URL(),
                {endpoint: buildMcpEndpointCreate(registration)},
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

    return {...draft, name: registration.slug}
}
