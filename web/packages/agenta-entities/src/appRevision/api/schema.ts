/**
 * AppRevision Schema API
 *
 * Functions for fetching and extracting OpenAPI schemas.
 * These are used to drive the schema-aware DrillIn navigation.
 */

import {axios, getAgentaApiUrl} from "@agenta/shared/api"
import {dereferenceSchema} from "@agenta/shared/utils"

import type {EndpointSchema, RevisionSchemaState, EntitySchema, EntitySchemaProperty} from "../core"
import {SERVICE_ROUTE_PATHS, type AppServiceType} from "../core"

// ============================================================================
// TYPES
// ============================================================================

/**
 * OpenAPI specification type (simplified)
 */
export interface OpenAPISpec {
    openapi?: string
    info?: {
        title?: string
        version?: string
    }
    paths?: Record<
        string,
        {
            post?: {
                requestBody?: {
                    content?: {
                        "application/json"?: {
                            schema?: Record<string, unknown>
                        }
                    }
                }
                responses?: {
                    "200"?: {
                        content?: {
                            "application/json"?: {
                                schema?: Record<string, unknown>
                            }
                        }
                    }
                }
            }
        }
    >
    components?: Record<string, unknown>
}

/**
 * Result from recursive schema fetch
 */
export interface SchemaFetchResult {
    schema: OpenAPISpec | null
    runtimePrefix: string
    routePath?: string
}

// ============================================================================
// ENDPOINT PATH CONSTRUCTION
// ============================================================================

/**
 * Construct endpoint path from routePath and endpoint name
 *
 * @param routePath - The route path segment (e.g., "my-app/v1")
 * @param endpoint - The endpoint name (e.g., "/test", "/run")
 * @returns The full path (e.g., "/my-app/v1/test")
 */
export function constructEndpointPath(routePath: string | undefined, endpoint: string): string {
    // Remove leading slash from endpoint if present
    const endpointName = endpoint.startsWith("/") ? endpoint.slice(1) : endpoint

    if (routePath) {
        // Ensure routePath doesn't have leading/trailing slashes
        const cleanRoutePath = routePath.replace(/^\/|\/$/g, "")
        return `/${cleanRoutePath}/${endpointName}`
    }

    return `/${endpointName}`
}

// ============================================================================
// SCHEMA EXTRACTION
// ============================================================================

/**
 * Resolve a $ref reference in an OpenAPI schema.
 * Handles references like "#/components/schemas/SchemaName"
 *
 * Merges the resolved schema with any sibling properties from the original.
 * In OpenAPI 3.1, $ref can have sibling properties that should be preserved.
 */
function resolveSchemaRef(
    spec: OpenAPISpec,
    schema: Record<string, unknown>,
): Record<string, unknown> {
    const ref = schema.$ref as string | undefined
    if (!ref || typeof ref !== "string") {
        return schema
    }

    // Parse the $ref path (e.g., "#/components/schemas/Body_completion_test_post")
    const refPath = ref.replace(/^#\//, "").split("/")

    // Navigate to the referenced schema
    let resolved: unknown = spec
    for (const segment of refPath) {
        if (resolved && typeof resolved === "object") {
            resolved = (resolved as Record<string, unknown>)[segment]
        } else {
            return schema // Could not resolve, return original
        }
    }

    if (resolved && typeof resolved === "object") {
        // Merge sibling properties from original schema (excluding $ref)
        // This preserves properties like 'choices', 'title', 'description' that may be on the parent
        const {$ref: _discard, ...siblings} = schema
        return {...(resolved as Record<string, unknown>), ...siblings}
    }

    return schema
}

/**
 * Recursively resolve all $ref references in a schema and its nested properties.
 * This ensures that all levels of the schema tree have their references resolved.
 */
function resolveSchemaDeep(
    spec: OpenAPISpec,
    schema: Record<string, unknown>,
    visited = new Set<string>(),
    depth = 0,
): Record<string, unknown> {
    // First resolve any $ref at this level
    const ref = schema.$ref as string | undefined
    let resolved = schema

    if (ref && typeof ref === "string") {
        // Prevent infinite recursion
        if (visited.has(ref)) {
            return schema
        }
        visited.add(ref)
        resolved = resolveSchemaRef(spec, schema)
    }

    // If this schema has properties, resolve $refs in each property
    const properties = resolved.properties as Record<string, unknown> | undefined
    if (properties && typeof properties === "object") {
        const resolvedProperties: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(properties)) {
            if (value && typeof value === "object") {
                resolvedProperties[key] = resolveSchemaDeep(
                    spec,
                    value as Record<string, unknown>,
                    new Set(visited),
                    depth + 1,
                )
            } else {
                resolvedProperties[key] = value
            }
        }
        resolved = {...resolved, properties: resolvedProperties}
    }

    // If this schema has items (array), resolve $refs in items
    const items = resolved.items as Record<string, unknown> | undefined
    if (items && typeof items === "object") {
        resolved = {
            ...resolved,
            items: resolveSchemaDeep(spec, items, new Set(visited), depth + 1),
        }
    }

    // If this schema has allOf/anyOf/oneOf, resolve $refs in each
    for (const combiner of ["allOf", "anyOf", "oneOf"] as const) {
        const combined = resolved[combiner] as Record<string, unknown>[] | undefined
        if (combined && Array.isArray(combined)) {
            resolved = {
                ...resolved,
                [combiner]: combined.map((item) =>
                    item && typeof item === "object"
                        ? resolveSchemaDeep(spec, item, new Set(visited), depth + 1)
                        : item,
                ),
            }
        }
    }

    return resolved
}

/**
 * Extract schema for a specific endpoint from OpenAPI spec
 */
export function extractEndpointSchema(
    spec: OpenAPISpec,
    endpoint: string,
    routePath?: string,
): EndpointSchema | null {
    // Try with routePath first, then fall back to endpoint only
    const pathWithRoute = constructEndpointPath(routePath, endpoint)
    const pathWithoutRoute = constructEndpointPath(undefined, endpoint)

    // Try the path with routePath first
    let path = pathWithRoute
    let requestSchema =
        spec?.paths?.[path]?.post?.requestBody?.content?.["application/json"]?.schema

    // If not found and routePath was provided, try without it
    if ((!requestSchema || typeof requestSchema !== "object") && routePath) {
        path = pathWithoutRoute
        requestSchema =
            spec?.paths?.[path]?.post?.requestBody?.content?.["application/json"]?.schema
    }

    if (!requestSchema || typeof requestSchema !== "object") {
        return null
    }

    // Resolve all $ref references recursively (deep resolution)
    const resolvedSchema = resolveSchemaDeep(spec, requestSchema as Record<string, unknown>)

    const properties = resolvedSchema?.properties as Record<string, unknown> | undefined

    if (!properties) {
        return {
            path,
            requestSchema,
            agConfigSchema: null,
            inputsSchema: null,
            messagesSchema: null,
            requestProperties: [],
        }
    }

    const requestProperties = Object.keys(properties)

    // Extract ag_config schema (already resolved by resolveSchemaDeep)
    const agConfigResolved = properties.ag_config as Record<string, unknown> | undefined

    let agConfigSchema: EntitySchema | null = null
    if (agConfigResolved && typeof agConfigResolved === "object") {
        agConfigSchema = {
            type: "object",
            properties: (agConfigResolved.properties || {}) as Record<string, EntitySchemaProperty>,
            required: agConfigResolved.required as string[] | undefined,
        }
    }

    // Extract inputs schema
    // First, check if there's a dedicated "inputs" property
    const inputsRaw = properties.inputs as Record<string, unknown> | undefined
    let inputsSchema: EntitySchema | null = null

    if (inputsRaw && typeof inputsRaw === "object") {
        inputsSchema = {
            type: (inputsRaw.type as string) || "object",
            properties: (inputsRaw.properties || {}) as Record<string, EntitySchemaProperty>,
            required: inputsRaw.required as string[] | undefined,
            // Preserve additionalProperties for dynamic inputs
            additionalProperties: inputsRaw.additionalProperties,
        } as EntitySchema
    } else {
        // Fallback: If no "inputs" property, collect top-level properties that are likely inputs
        // (i.e., not ag_config, messages, or other known system properties)
        const systemProperties = [
            "ag_config",
            "messages",
            "environment",
            "revision_id",
            "variant_id",
            "app_id",
        ]
        const inputProperties: Record<string, EntitySchemaProperty> = {}

        for (const [key, value] of Object.entries(properties)) {
            if (!systemProperties.includes(key) && value && typeof value === "object") {
                inputProperties[key] = value as EntitySchemaProperty
            }
        }

        if (Object.keys(inputProperties).length > 0) {
            inputsSchema = {
                type: "object",
                properties: inputProperties,
                required: (requestSchema as Record<string, unknown>).required as
                    | string[]
                    | undefined,
            }
        }
    }

    // Extract messages schema (for chat variants) - this is an array schema
    const messagesRaw = properties.messages as Record<string, unknown> | undefined
    let messagesSchema: EntitySchemaProperty | null = null
    if (messagesRaw && typeof messagesRaw === "object") {
        messagesSchema = {
            type: (messagesRaw.type as string) || "array",
            items: messagesRaw.items as Record<string, unknown> | undefined,
        } as EntitySchemaProperty
    }

    // Extract outputs schema from response (200 OK)
    let outputsSchema: EntitySchema | null = null
    const responseSchema =
        spec?.paths?.[path]?.post?.responses?.["200"]?.content?.["application/json"]?.schema

    if (responseSchema && typeof responseSchema === "object") {
        const resolvedResponse = resolveSchemaDeep(spec, responseSchema as Record<string, unknown>)
        if (resolvedResponse) {
            // Check if it's an object with properties
            if (resolvedResponse.properties) {
                outputsSchema = {
                    type: "object",
                    properties: resolvedResponse.properties as Record<string, EntitySchemaProperty>,
                    required: resolvedResponse.required as string[] | undefined,
                }
            } else if (resolvedResponse.type === "string" || resolvedResponse.type === "number") {
                // Simple type response - wrap in a standard "output" property
                outputsSchema = {
                    type: "object",
                    properties: {
                        output: resolvedResponse as EntitySchemaProperty,
                    },
                }
            }
        }
    }

    return {
        path,
        requestSchema,
        agConfigSchema,
        inputsSchema,
        outputsSchema,
        messagesSchema,
        requestProperties,
    }
}

/**
 * Extract all endpoint schemas from OpenAPI spec
 */
export function extractAllEndpointSchemas(
    spec: OpenAPISpec,
    routePath?: string,
): {
    endpoints: RevisionSchemaState["endpoints"]
    availableEndpoints: string[]
    isChatVariant: boolean
    primaryAgConfigSchema: EntitySchema | null
    primaryOutputsSchema: EntitySchema | null
} {
    const endpointNames = ["/test", "/run", "/generate", "/generate_deployed", "/"] as const

    const endpoints: RevisionSchemaState["endpoints"] = {
        test: extractEndpointSchema(spec, "/test", routePath),
        run: extractEndpointSchema(spec, "/run", routePath),
        generate: extractEndpointSchema(spec, "/generate", routePath),
        generateDeployed: extractEndpointSchema(spec, "/generate_deployed", routePath),
        // Support root path endpoint for custom apps using @ag.route("/")
        root: extractEndpointSchema(spec, "/", routePath),
    }

    // Find available endpoints
    const availableEndpoints = endpointNames.filter((name) => {
        if (name === "/") {
            return endpoints.root !== null
        }
        const key = name.replace("/", "").replace("_deployed", "Deployed") as keyof typeof endpoints
        return endpoints[key] !== null
    })

    // Check if this is a chat variant (has messages in any endpoint)
    const isChatVariant = Object.values(endpoints).some(
        (ep) => ep?.messagesSchema !== null || ep?.requestProperties?.includes("messages"),
    )

    // Get primary ag_config schema (prefer /test, then /run, then others, then root)
    const primaryAgConfigSchema =
        endpoints.test?.agConfigSchema ||
        endpoints.run?.agConfigSchema ||
        endpoints.generate?.agConfigSchema ||
        endpoints.generateDeployed?.agConfigSchema ||
        endpoints.root?.agConfigSchema ||
        null

    // Get primary outputs schema (prefer /test, then /run, then others, then root)
    const primaryOutputsSchema =
        endpoints.test?.outputsSchema ||
        endpoints.run?.outputsSchema ||
        endpoints.generate?.outputsSchema ||
        endpoints.generateDeployed?.outputsSchema ||
        endpoints.root?.outputsSchema ||
        null

    return {
        endpoints,
        availableEndpoints,
        isChatVariant,
        primaryAgConfigSchema,
        primaryOutputsSchema,
    }
}

/**
 * Create empty revision schema state
 */
export function createEmptyRevisionSchemaState(): RevisionSchemaState {
    return {
        openApiSchema: null,
        agConfigSchema: null,
        endpoints: {
            test: null,
            run: null,
            generate: null,
            generateDeployed: null,
            root: null,
        },
        availableEndpoints: [],
        isChatVariant: false,
    }
}

/**
 * Build revision schema state from OpenAPI spec
 */
export function buildRevisionSchemaState(
    schema: OpenAPISpec | null,
    runtimePrefix?: string,
    routePath?: string,
): RevisionSchemaState {
    if (!schema) {
        return {
            ...createEmptyRevisionSchemaState(),
            runtimePrefix,
            routePath,
        }
    }

    const {
        endpoints,
        availableEndpoints,
        isChatVariant,
        primaryAgConfigSchema,
        primaryOutputsSchema,
    } = extractAllEndpointSchemas(schema, routePath)

    return {
        openApiSchema: schema,
        agConfigSchema: primaryAgConfigSchema,
        outputsSchema: primaryOutputsSchema,
        endpoints,
        availableEndpoints,
        isChatVariant,
        runtimePrefix,
        routePath,
    }
}

// ============================================================================
// SCHEMA PATH NAVIGATION
// ============================================================================

/**
 * Get schema property at a specific path within a schema
 */
export function getSchemaPropertyAtPath(
    schema: EntitySchema | null,
    path: (string | number)[],
): EntitySchemaProperty | null {
    if (!schema || path.length === 0) return schema as EntitySchemaProperty | null

    let current: EntitySchemaProperty | undefined = schema as unknown as EntitySchemaProperty

    for (const segment of path) {
        if (!current) return null

        if (typeof segment === "number") {
            // Array index - use items schema
            if (current.type === "array" && current.items) {
                current = current.items as EntitySchemaProperty
            } else {
                return null
            }
        } else {
            // Object key - use properties
            if (current.type === "object" && current.properties) {
                current = current.properties[segment]
            } else {
                return null
            }
        }
    }

    return current || null
}

// ============================================================================
// SERVICE SCHEMA PREFETCH
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
