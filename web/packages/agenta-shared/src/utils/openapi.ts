/**
 * OpenAPI Schema Utilities
 *
 * Functions for processing OpenAPI specifications, including
 * dereferencing $ref references.
 */

/**
 * Result from dereferencing an OpenAPI spec
 */
export interface DereferencedSchemaResult {
    schema: Record<string, unknown> | null
    errors?: string[]
}

/**
 * Resolve a JSON Pointer (e.g. "#/components/schemas/Foo") against a root object.
 */
function resolvePointer(root: Record<string, unknown>, pointer: string): unknown {
    const path = pointer.replace(/^#\//, "").split("/").map(decodeURIComponent)
    let current: unknown = root
    for (const segment of path) {
        if (current == null || typeof current !== "object") return undefined
        current = (current as Record<string, unknown>)[segment]
    }
    return current
}

/**
 * Recursively resolve all internal $ref pointers in a JSON value.
 * Tracks visited refs to handle circular references safely.
 */
function resolveRefs(node: unknown, root: Record<string, unknown>, seen: Set<string>): unknown {
    if (node == null || typeof node !== "object") return node

    if (Array.isArray(node)) {
        return node.map((item) => resolveRefs(item, root, seen))
    }

    const obj = node as Record<string, unknown>

    if (typeof obj.$ref === "string") {
        const ref = obj.$ref
        if (seen.has(ref)) return obj // circular — return as-is
        seen.add(ref)
        const resolved = resolvePointer(root, ref)
        if (resolved === undefined) return obj // unresolvable — return as-is
        return resolveRefs(resolved, root, seen)
    }

    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
        result[key] = resolveRefs(value, root, seen)
    }
    return result
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
        const schema = resolveRefs(spec, spec, new Set()) as Record<string, unknown>
        return {schema}
    } catch (error) {
        console.error("[dereferenceSchema] Failed to dereference schema:", error)
        return {
            schema: null,
            errors: [error instanceof Error ? error.message : "Unknown error during dereferencing"],
        }
    }
}
