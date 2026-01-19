/**
 * AppRevision Schema API
 *
 * Functions for fetching and extracting OpenAPI schemas.
 * These are used to drive the schema-aware DrillIn navigation.
 */

import type {EndpointSchema, RevisionSchemaState, EntitySchema, EntitySchemaProperty} from "../core"

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
 * Extract schema for a specific endpoint from OpenAPI spec
 */
export function extractEndpointSchema(
    spec: OpenAPISpec,
    endpoint: string,
    routePath?: string,
): EndpointSchema | null {
    const path = constructEndpointPath(routePath, endpoint)
    const requestSchema =
        spec?.paths?.[path]?.post?.requestBody?.content?.["application/json"]?.schema

    console.log("[extractEndpointSchema] Extracting", {
        endpoint,
        routePath,
        constructedPath: path,
        availablePaths: spec?.paths ? Object.keys(spec.paths) : [],
        hasRequestSchema: !!requestSchema,
        requestSchemaKeys: requestSchema && typeof requestSchema === "object" ? Object.keys(requestSchema) : [],
    })

    if (!requestSchema || typeof requestSchema !== "object") {
        return null
    }

    const properties = (requestSchema as Record<string, unknown>)?.properties as
        | Record<string, unknown>
        | undefined

    console.log("[extractEndpointSchema] Schema structure", {
        path,
        hasProperties: !!properties,
        propertyKeys: properties ? Object.keys(properties) : [],
        schemaType: (requestSchema as Record<string, unknown>)?.type,
        hasAllOf: !!(requestSchema as Record<string, unknown>)?.allOf,
        hasOneOf: !!(requestSchema as Record<string, unknown>)?.oneOf,
    })

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

    // Extract ag_config schema
    const agConfigRaw = properties.ag_config as Record<string, unknown> | undefined
    let agConfigSchema: EntitySchema | null = null
    if (agConfigRaw && typeof agConfigRaw === "object") {
        agConfigSchema = {
            type: "object",
            properties: (agConfigRaw.properties || {}) as Record<string, EntitySchemaProperty>,
            required: agConfigRaw.required as string[] | undefined,
        }
    }

    // Extract inputs schema
    // First, check if there's a dedicated "inputs" property
    const inputsRaw = properties.inputs as Record<string, unknown> | undefined
    let inputsSchema: EntitySchema | null = null

    console.log("[extractEndpointSchema] Inputs extraction", {
        path,
        hasInputsProperty: !!inputsRaw,
        inputsRawKeys: inputsRaw && typeof inputsRaw === "object" ? Object.keys(inputsRaw) : [],
        inputsRawType: inputsRaw?.type,
        inputsRawProperties: inputsRaw?.properties ? Object.keys(inputsRaw.properties as object) : [],
    })

    if (inputsRaw && typeof inputsRaw === "object") {
        inputsSchema = {
            type: (inputsRaw.type as string) || "object",
            properties: (inputsRaw.properties || {}) as Record<string, EntitySchemaProperty>,
            required: inputsRaw.required as string[] | undefined,
            // Preserve additionalProperties for dynamic inputs
            additionalProperties: inputsRaw.additionalProperties,
        } as EntitySchema
        console.log("[extractEndpointSchema] Created inputsSchema from inputs property", {
            path,
            inputsSchemaPropertyCount: Object.keys(inputsSchema.properties || {}).length,
        })
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

        console.log("[extractEndpointSchema] Fallback input extraction", {
            path,
            allPropertyKeys: Object.keys(properties),
            systemProperties,
            extractedInputKeys: Object.keys(inputProperties),
        })

        if (Object.keys(inputProperties).length > 0) {
            inputsSchema = {
                type: "object",
                properties: inputProperties,
                required: (requestSchema as Record<string, unknown>).required as string[] | undefined,
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

    return {
        path,
        requestSchema,
        agConfigSchema,
        inputsSchema,
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
} {
    const endpointNames = ["/test", "/run", "/generate", "/generate_deployed"] as const

    const endpoints: RevisionSchemaState["endpoints"] = {
        test: extractEndpointSchema(spec, "/test", routePath),
        run: extractEndpointSchema(spec, "/run", routePath),
        generate: extractEndpointSchema(spec, "/generate", routePath),
        generateDeployed: extractEndpointSchema(spec, "/generate_deployed", routePath),
    }

    // Find available endpoints
    const availableEndpoints = endpointNames.filter((name) => {
        const key = name.replace("/", "").replace("_deployed", "Deployed") as keyof typeof endpoints
        return endpoints[key] !== null
    })

    // Check if this is a chat variant (has messages in any endpoint)
    const isChatVariant = Object.values(endpoints).some(
        (ep) => ep?.messagesSchema !== null || ep?.requestProperties.includes("messages"),
    )

    // Get primary ag_config schema (prefer /test, then /run, then others)
    const primaryAgConfigSchema =
        endpoints.test?.agConfigSchema ||
        endpoints.run?.agConfigSchema ||
        endpoints.generate?.agConfigSchema ||
        endpoints.generateDeployed?.agConfigSchema ||
        null

    return {endpoints, availableEndpoints, isChatVariant, primaryAgConfigSchema}
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

    const {endpoints, availableEndpoints, isChatVariant, primaryAgConfigSchema} =
        extractAllEndpointSchemas(schema, routePath)

    return {
        openApiSchema: schema,
        agConfigSchema: primaryAgConfigSchema,
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
