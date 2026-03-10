/**
 * LegacyAppRevision Schema API
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
