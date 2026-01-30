/**
 * OpenAPI Schema Utilities
 *
 * Functions for processing OpenAPI specifications, including
 * dereferencing $ref references.
 */

import {dereference} from "@scalar/openapi-parser"

/**
 * Result from dereferencing an OpenAPI spec
 */
export interface DereferencedSchemaResult {
    schema: Record<string, unknown> | null
    errors?: string[]
}

/**
 * Dereference all $ref references in an OpenAPI specification.
 *
 * This resolves all JSON Schema $ref pointers to their actual values,
 * producing a fully expanded schema that can be traversed without
 * encountering any $ref objects.
 *
 * @param spec - The raw OpenAPI specification with potential $ref references
 * @returns The dereferenced schema and any errors
 *
 * @example
 * ```ts
 * const rawSpec = await fetchOpenApiSpec(uri)
 * const { schema, errors } = await dereferenceSchema(rawSpec)
 * if (schema) {
 *   // Use the fully resolved schema
 *   const properties = schema.paths['/test'].post.requestBody.content['application/json'].schema.properties
 * }
 * ```
 */
export async function dereferenceSchema(
    spec: Record<string, unknown>,
): Promise<DereferencedSchemaResult> {
    try {
        const result = await dereference(spec)
        return {
            schema: result.schema as Record<string, unknown> | null,
            errors: result.errors?.map((e) => (typeof e === "string" ? e : JSON.stringify(e))),
        }
    } catch (error) {
        console.error("[dereferenceSchema] Failed to dereference schema:", error)
        return {
            schema: null,
            errors: [error instanceof Error ? error.message : "Unknown error during dereferencing"],
        }
    }
}
