/**
 * Shared OpenAPI Schema Fetcher
 *
 * Network-dependent schema fetching for service schemas.
 * Re-exports pure schema utilities from schemaUtils.ts.
 */

import {axios, getAgentaApiUrl} from "@agenta/shared/api"
import {dereferenceSchema} from "@agenta/shared/utils"

import {buildRevisionSchemaState, type OpenAPISpec} from "./schemaUtils"
import {SERVICE_ROUTE_PATHS, type RevisionSchemaState, type AppServiceType} from "./types"

// Re-export all pure schema utilities (safe for web workers)
export {
    type OpenAPISpec,
    type SchemaFetchResult,
    constructEndpointPath,
    extractEndpointSchema,
    extractAllEndpointSchemas,
    createEmptyRevisionSchemaState,
    buildRevisionSchemaState,
    getSchemaPropertyAtPath,
    convertOpenApiSchemaToJsonSchema,
    jsonSchemaToEntitySchema,
} from "./schemaUtils"

// ============================================================================
// SERVICE SCHEMA PREFETCH (network-dependent)
// ============================================================================

/**
 * Fetch OpenAPI schema for a known service type (completion or chat).
 *
 * For non-custom apps, the OpenAPI schema is identical across all revisions
 * of the same service type. This function fetches the schema from the known
 * service endpoint and builds a RevisionSchemaState without revision-specific
 * runtime context (runtimePrefix/routePath).
 *
 * @param serviceType - The service type ("completion" or "chat")
 * @returns The structural schema state (no runtimePrefix/routePath)
 */
// ============================================================================
// URI PROBING (network-dependent)
// ============================================================================

/**
 * Normalize a URI for probing: resolve relative paths, trim trailing slashes,
 * and strip trailing /openapi.json.
 */
function normalizeUriForProbing(uri: string): string | null {
    let normalized = uri

    // Resolve relative URIs using window origin when available
    if (typeof normalized === "string" && normalized.startsWith("/")) {
        const origin = (globalThis as unknown as {location?: {origin?: string}})?.location?.origin
        if (origin) {
            normalized = `${origin}${normalized}`
        }
    }

    // Trim trailing slashes
    while (normalized.endsWith("/")) {
        normalized = normalized.slice(0, -1)
    }

    // Strip trailing /openapi.json if present
    if (normalized.endsWith("/openapi.json")) {
        normalized = normalized.replace(/\/openapi\.json$/, "")
    }

    if (!normalized || typeof normalized !== "string") return null

    // Guard: avoid fetching protocol-only strings like "http:" which produce invalid URLs
    if (!normalized.includes("//")) return null

    return normalized
}

/**
 * Recursively probe a URI by stripping path segments until a given
 * endpoint responds successfully. Used for custom workflows where
 * the URI contains embedded route-path segments.
 *
 * Example: Given "https://host/my-app/v1" and endpoint "/openapi.json",
 * tries: https://host/my-app/v1/openapi.json → 404
 *        https://host/my-app/openapi.json → 404
 *        https://host/openapi.json → 200 → returns {runtimePrefix: "https://host", routePath: "my-app/v1"}
 *
 * @param uri - The base URI to probe
 * @param options - Optional endpoint, signal and projectId
 * @returns Probe result with routePath and runtimePrefix, or null if not found
 */
export async function probeEndpointPath(
    uri: string,
    options?: {
        endpoint?: string
        signal?: AbortSignal
        projectId?: string | null
    },
): Promise<{routePath: string; runtimePrefix: string; status?: boolean} | null> {
    const endpoint = options?.endpoint ?? "/openapi.json"
    const projectId = options?.projectId ?? undefined

    const normalized = normalizeUriForProbing(uri)
    if (!normalized) return null

    const recurse = async (
        current: string,
        removedPaths: string,
    ): Promise<{routePath: string; runtimePrefix: string; status?: boolean} | null> => {
        try {
            const url = `${current}${endpoint}`
            const response = await axios.get(url, {
                params: projectId ? {project_id: projectId} : undefined,
                signal: options?.signal,
                validateStatus: () => true, // Don't throw on non-2xx
            })

            if (response.status >= 200 && response.status < 300 && response.data) {
                return {
                    routePath: removedPaths,
                    runtimePrefix: current,
                    status: true,
                }
            }
        } catch {
            // Network error or abort — fall through to retry with shorter path
        }

        // Strip one path segment and retry
        const parts = current.split("/")
        const popped = parts.pop()

        const newPath = parts.join("/")
        // Guard against pathological recursion (protocol-only like "http:" or empty)
        if (!newPath || newPath.endsWith(":") || newPath === "http:" || newPath === "https:") {
            return null
        }

        return recurse(
            newPath,
            popped ? (removedPaths ? `${popped}/${removedPaths}` : popped) : removedPaths,
        )
    }

    return recurse(normalized, "")
}

/**
 * Fetch revision schema with recursive URI probing.
 *
 * Like fetchRevisionSchema, but when the initial URI doesn't respond,
 * recursively strips path segments to discover the correct runtimePrefix
 * and routePath. The schema is fetched and dereferenced from the
 * discovered endpoint.
 *
 * @param uri - The base URI to probe and fetch schema from
 * @param projectId - Optional project ID for auth
 * @returns Schema result with runtimePrefix and routePath, or null
 */
export async function fetchRevisionSchemaWithProbe(
    uri: string,
    projectId?: string | null,
): Promise<{schema: OpenAPISpec | null; runtimePrefix: string; routePath?: string} | null> {
    const normalized = normalizeUriForProbing(uri)
    if (!normalized) return null

    const recurse = async (
        current: string,
        removed: string,
    ): Promise<{schema: OpenAPISpec | null; runtimePrefix: string; routePath?: string} | null> => {
        try {
            const url = `${current}/openapi.json`
            const response = await axios.get<OpenAPISpec>(url, {
                params: projectId ? {project_id: projectId} : undefined,
                validateStatus: () => true, // Don't throw on non-2xx
            })

            if (response.status >= 200 && response.status < 300 && response.data) {
                const {schema: dereferencedSchema, errors} = await dereferenceSchema(response.data)

                if (errors && errors.length > 0) {
                    console.warn(
                        "[fetchRevisionSchemaWithProbe] Schema dereference warnings:",
                        errors,
                    )
                }

                return {
                    schema: dereferencedSchema,
                    runtimePrefix: current,
                    routePath: removed || undefined,
                }
            }
        } catch {
            // Network error — fall through to retry with shorter path
        }

        // Strip one path segment and retry
        const parts = current.split("/")
        const popped = parts.pop()

        const newPath = parts.join("/")
        if (!newPath || newPath.endsWith(":") || newPath === "http:" || newPath === "https:") {
            return null
        }

        return recurse(newPath, popped ? (removed ? `${popped}/${removed}` : popped) : removed)
    }

    return recurse(normalized, "")
}

// ============================================================================
// SERVICE SCHEMA PREFETCH (network-dependent)
// ============================================================================

export async function fetchServiceSchema(
    serviceType: AppServiceType,
    projectId?: string | null,
): Promise<RevisionSchemaState | null> {
    const routePath = SERVICE_ROUTE_PATHS[serviceType]
    if (!routePath) return null

    // getAgentaApiUrl() returns the API base (e.g. "http://localhost/api").
    // Service schemas live at /services/*, not /api/services/*.
    // Strip the /api suffix to get the origin, then build the full URL.
    const apiUrl = getAgentaApiUrl()
    if (!apiUrl) return null

    const origin = apiUrl.replace(/\/api\/?$/, "")
    const openApiUrl = `${origin}/services/${serviceType}/openapi.json`

    try {
        // Pass full absolute URL with baseURL:"" to bypass axios's preconfigured baseURL
        const response = await axios.get<Record<string, unknown>>(openApiUrl, {
            baseURL: "",
            params: projectId ? {project_id: projectId} : undefined,
        })
        const rawSchema = response.data

        if (!rawSchema || typeof rawSchema !== "object") return null

        // Dereference all $ref pointers for a fully resolved schema
        const {schema: dereferencedSchema, errors} = await dereferenceSchema(rawSchema)

        if (errors && errors.length > 0) {
            console.warn("[fetchServiceSchema] Schema dereference warnings:", errors)
        }

        // Build schema state without revision-specific runtime context.
        // runtimePrefix and routePath will be composed from revision entity data
        // by the router atom when serving to consumers.
        return buildRevisionSchemaState(
            dereferencedSchema as OpenAPISpec | null,
            undefined,
            routePath,
        )
    } catch {
        return null
    }
}
