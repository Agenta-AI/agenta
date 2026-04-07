/**
 * Pure schema extraction and navigation utilities.
 *
 * These functions operate on in-memory OpenAPI spec objects and have
 * NO network or browser dependencies, making them safe to use in
 * web workers and other non-browser contexts.
 *
 * Schema conversion uses the `openapi-json-schema` package to walk
 * OpenAPI schema nodes and convert them to JSON Schema 7.
 */

import type {JSONSchema7, JSONSchema7TypeName} from "json-schema"
import {recurseSchema, encodeRefNameJsonSchema, decodeRefNameOpenApi} from "openapi-json-schema"

import type {EntitySchema, EntitySchemaProperty} from "../"

import type {EndpointSchema, RevisionSchemaState} from "./types"

// ============================================================================
// TYPES
// ============================================================================

/**
 * OpenAPI specification type (simplified)
 */
export interface OpenAPISpec {
    [key: string]: unknown
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
// OPENAPI → JSON SCHEMA CONVERSION
// ============================================================================

/** Known system properties that are not user inputs */
const SYSTEM_PROPERTIES = [
    "ag_config",
    "messages",
    "environment",
    "revision_id",
    "variant_id",
    "app_id",
]

/**
 * Convert OpenAPI `type` + `nullable` to JSON Schema 7 `type`.
 *
 * OpenAPI 3.0 uses `nullable: true` as a sibling to `type`.
 * JSON Schema 7 uses `type: ["string", "null"]` instead.
 */
function openApiTypeToJsonSchema7Type(
    type: string | string[] | undefined,
    nullable: boolean | undefined,
): JSONSchema7TypeName | JSONSchema7TypeName[] | undefined {
    if (type === undefined || type === "any") return undefined
    if (!Array.isArray(type)) {
        return type === "null" || !nullable
            ? (type as JSONSchema7TypeName)
            : ([type, "null"] as JSONSchema7TypeName[])
    }
    const arr = [...type] as JSONSchema7TypeName[]
    if (arr.includes("any" as JSONSchema7TypeName)) return undefined
    if (!arr.includes("null") && nullable) arr.push("null")
    if (arr.length === 1) return arr[0]
    return arr
}

/**
 * Re-encode `$ref` from OpenAPI convention to JSON Schema convention.
 * OpenAPI: `#/components/schemas/Foo` → JSON Schema: `#/definitions/Foo`
 */
function openApiToJsonSchema7Ref(node: Record<string, unknown>): Record<string, unknown> {
    if (node.$ref && typeof node.$ref === "string") {
        return {
            ...node,
            $ref: encodeRefNameJsonSchema(decodeRefNameOpenApi(node.$ref as string)),
        }
    }
    return node
}

/**
 * Convert a single OpenAPI schema node to JSON Schema 7.
 *
 * Uses `recurseSchema` from openapi-json-schema to walk nested schemas,
 * with per-node conversion that handles:
 * - `nullable: true` → `type: ["string", "null"]` (JSON Schema 7 style)
 * - `$ref` path re-encoding (OpenAPI → JSON Schema conventions)
 *
 * Preserves OpenAPI extension properties (`x-*`) as passthrough.
 */
export function convertOpenApiSchemaToJsonSchema(
    schema: Record<string, unknown> | null | undefined,
): JSONSchema7 | null {
    if (!schema) return null

    try {
        const convert = (node: Record<string, unknown>): Record<string, unknown> => {
            if (typeof node === "boolean") return node as unknown as Record<string, unknown>
            const {
                type: _type,
                nullable,
                ...rest
            } = node as Record<string, unknown> & {
                type?: string | string[]
                nullable?: boolean
            }
            const type = openApiTypeToJsonSchema7Type(_type, nullable)
            let output: Record<string, unknown> = {...rest, ...(type ? {type} : {})}
            output = openApiToJsonSchema7Ref(output)
            return recurseSchema(
                output,
                convert as Parameters<typeof recurseSchema>[1],
            ) as unknown as Record<string, unknown>
        }

        const result = convert(schema)
        return result as JSONSchema7
    } catch (error) {
        console.warn("[schemaUtils] convertOpenApiSchemaToJsonSchema failed:", error)
        return null
    }
}

/**
 * Convert JSON Schema 7 to our EntitySchema shape.
 *
 * This adapter allows JSON Schema 7 output from `convertOpenApiSchemaToJsonSchema`
 * to be consumed by downstream code that expects EntitySchema.
 */
export function jsonSchemaToEntitySchema(jsonSchema: JSONSchema7 | null): EntitySchema | null {
    if (!jsonSchema) return null

    return {
        type: (jsonSchema.type as string) ?? "object",
        properties: jsonSchema.properties as Record<string, EntitySchemaProperty> | undefined,
        required: jsonSchema.required,
        additionalProperties: jsonSchema.additionalProperties,
    } as EntitySchema
}

// ============================================================================
// SCHEMA EXTRACTION
// ============================================================================

/**
 * Extract schema for a specific endpoint from OpenAPI spec.
 *
 * Uses `convertOpenApiSchemaToJsonSchema` (backed by `openapi-json-schema`)
 * to convert each extracted schema node to standard JSON Schema 7 form,
 * then adapts back to EntitySchema via `jsonSchemaToEntitySchema`.
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
    let rawRequestSchema =
        spec?.paths?.[path]?.post?.requestBody?.content?.["application/json"]?.schema

    // If not found and routePath was provided, try without it
    if ((!rawRequestSchema || typeof rawRequestSchema !== "object") && routePath) {
        path = pathWithoutRoute
        rawRequestSchema =
            spec?.paths?.[path]?.post?.requestBody?.content?.["application/json"]?.schema
    }

    if (!rawRequestSchema || typeof rawRequestSchema !== "object") {
        return null
    }

    const properties = (rawRequestSchema as Record<string, unknown>)?.properties as
        | Record<string, Record<string, unknown>>
        | undefined

    if (!properties) {
        return {
            path,
            requestSchema: rawRequestSchema,
            agConfigSchema: null,
            inputsSchema: null,
            messagesSchema: null,
            requestProperties: [],
        }
    }

    const requestProperties = Object.keys(properties)

    // Extract ag_config schema
    const agConfigRaw = properties.ag_config as Record<string, unknown> | undefined
    const agConfigSchema = jsonSchemaToEntitySchema(convertOpenApiSchemaToJsonSchema(agConfigRaw))

    // Extract inputs schema
    let inputsSchema: EntitySchema | null = null
    const inputsRaw = properties.inputs as Record<string, unknown> | undefined

    if (inputsRaw) {
        inputsSchema = jsonSchemaToEntitySchema(convertOpenApiSchemaToJsonSchema(inputsRaw))
    } else {
        // Fallback: collect non-system top-level properties as inputs
        const inputProperties: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(properties)) {
            if (!SYSTEM_PROPERTIES.includes(key) && value && typeof value === "object") {
                inputProperties[key] = value
            }
        }
        if (Object.keys(inputProperties).length > 0) {
            inputsSchema = jsonSchemaToEntitySchema(
                convertOpenApiSchemaToJsonSchema({
                    type: "object",
                    properties: inputProperties,
                    required: (rawRequestSchema as Record<string, unknown>).required,
                }),
            )
        }
    }

    // Extract messages schema (for chat variants)
    const messagesRaw = properties.messages as Record<string, unknown> | undefined
    const messagesSchema = jsonSchemaToEntitySchema(
        convertOpenApiSchemaToJsonSchema(messagesRaw),
    ) as EntitySchemaProperty | null

    // Extract outputs schema from response (200 OK)
    let outputsSchema: EntitySchema | null = null
    const responseSchema =
        spec?.paths?.[path]?.post?.responses?.["200"]?.content?.["application/json"]?.schema

    if (responseSchema && typeof responseSchema === "object") {
        const convertedResponse = convertOpenApiSchemaToJsonSchema(
            responseSchema as Record<string, unknown>,
        )
        if (convertedResponse) {
            if (convertedResponse.properties) {
                outputsSchema = jsonSchemaToEntitySchema(convertedResponse)
            } else if (convertedResponse.type === "string" || convertedResponse.type === "number") {
                // Simple type response - wrap in standard "output" property
                outputsSchema = {
                    type: "object",
                    properties: {
                        output: convertedResponse as unknown as EntitySchemaProperty,
                    },
                }
            }
        }
    }

    return {
        path,
        requestSchema: rawRequestSchema,
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
    primaryEndpoint: EndpointSchema | null
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

    // Check if this is a chat variant
    // Prefer explicit x-agenta.flags.is_chat from the SDK, fall back to heuristic
    const isChatVariant = (() => {
        for (const name of endpointNames) {
            const path = constructEndpointPath(routePath, name)
            const operation = spec?.paths?.[path]?.post as Record<string, unknown> | undefined
            const agentaExt = operation?.["x-agenta"] as Record<string, unknown> | undefined
            const flags = agentaExt?.flags as Record<string, unknown> | undefined
            if (flags && typeof flags.is_chat === "boolean") {
                return flags.is_chat
            }
        }
        // Fallback: heuristic — check if any endpoint has messages schema
        return Object.values(endpoints).some(
            (ep) => !!ep?.messagesSchema || ep?.requestProperties?.includes("messages"),
        )
    })()

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

    // Get primary endpoint (first available in priority order)
    const primaryEndpoint =
        endpoints.test ||
        endpoints.run ||
        endpoints.generate ||
        endpoints.generateDeployed ||
        endpoints.root ||
        null

    return {
        endpoints,
        availableEndpoints,
        isChatVariant,
        primaryAgConfigSchema,
        primaryOutputsSchema,
        primaryEndpoint,
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
        primaryEndpoint,
    } = extractAllEndpointSchemas(schema, routePath)

    return {
        openApiSchema: schema,
        agConfigSchema: primaryAgConfigSchema,
        outputsSchema: primaryOutputsSchema,
        primaryEndpoint,
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
// INPUT KEY EXTRACTION
// ============================================================================

/**
 * Extract input keys from an OpenAPI spec, excluding ag_config and messages.
 */
export const extractInputKeysFromSchema = (spec: OpenAPISpec, routePath = "") => {
    const {primaryEndpoint} = extractAllEndpointSchemas(spec as Record<string, unknown>, routePath)
    if (!primaryEndpoint) return []

    const reservedInputKeys = new Set([
        "ag_config",
        "messages",
        "inputs",
        "environment",
        "revision_id",
        "variant_id",
        "app_id",
    ])

    const inputSchemaProperties = primaryEndpoint.inputsSchema?.properties
    const schemaInputKeys =
        inputSchemaProperties && typeof inputSchemaProperties === "object"
            ? Object.keys(inputSchemaProperties as Record<string, unknown>)
            : []

    if (schemaInputKeys.length > 0) {
        return schemaInputKeys.filter((key) => key && !reservedInputKeys.has(key))
    }

    return (primaryEndpoint.requestProperties || []).filter(
        (key: string) => key && !reservedInputKeys.has(key),
    )
}
