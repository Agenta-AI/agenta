/**
 * resolveSchemaType — resolve a JSON-schema node's primitive type.
 *
 * Tolerates the nullable encodings an evaluator output schema may use:
 *   - `type: "boolean"`                                    — plain
 *   - `type: ["boolean", "null"]`                          — array / nullable
 *   - `anyOf | oneOf: [{type: "boolean"}, {type: "null"}]` — union / nullable
 *
 * Returns the first non-`"null"` type found, or `undefined` when none is
 * resolvable.
 *
 * Kept in its own dependency-free module so it is unit-testable without
 * pulling in the evaluator-resolution import graph.
 *
 * @packageDocumentation
 */

export const resolveSchemaType = (
    schema: Record<string, unknown> | null | undefined,
): string | undefined => {
    if (!schema || typeof schema !== "object") return undefined

    const type = schema.type
    if (typeof type === "string") return type === "null" ? undefined : type
    if (Array.isArray(type)) {
        const first = type.find((t) => typeof t === "string" && t !== "null")
        if (typeof first === "string") return first
    }

    for (const key of ["anyOf", "oneOf"] as const) {
        const branches = schema[key]
        if (!Array.isArray(branches)) continue
        for (const branch of branches) {
            const resolved = resolveSchemaType(branch as Record<string, unknown>)
            if (resolved) return resolved
        }
    }
    return undefined
}
