/**
 * Value Extraction Utilities
 *
 * Pure functions for stripping enhanced value wrappers and metadata from objects.
 * These are entity-agnostic and can be used by any package.
 */

/**
 * Recursively remove `agenta_metadata` and `__agenta_metadata` keys from objects.
 */
export function stripAgentaMetadataDeep<T = unknown>(value: T): T {
    if (Array.isArray(value)) {
        return value.map(stripAgentaMetadataDeep) as T
    }

    if (value && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([key]) => key !== "agenta_metadata" && key !== "__agenta_metadata")
            .map(([key, val]) => [key, stripAgentaMetadataDeep(val)])

        return Object.fromEntries(entries) as T
    }

    return value
}

/**
 * Recursively drop object keys whose value is an empty array or empty plain object, so a
 * present-but-empty collection compares equal to an absent one.
 *
 * Applied symmetrically to both sides of a config diff (dirty-detection, commit diff), this only
 * removes false-positive differences — e.g. adding then removing a tool/skill/mcp leaves
 * `skills: []` where the committed baseline had no `skills` key. It can never hide a real change:
 * a non-empty collection is never stripped, so any side that still holds content stays different
 * from an empty/absent one. Array *elements* are preserved (only keys are dropped), so list order
 * and length are untouched.
 */
export function stripEmptyCollectionsDeep<T = unknown>(value: T): T {
    if (Array.isArray(value)) {
        return value.map(stripEmptyCollectionsDeep) as T
    }
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {}
        for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
            const cleaned = stripEmptyCollectionsDeep(val)
            const isEmptyArray = Array.isArray(cleaned) && cleaned.length === 0
            const isEmptyObject =
                !!cleaned &&
                typeof cleaned === "object" &&
                !Array.isArray(cleaned) &&
                Object.keys(cleaned as Record<string, unknown>).length === 0
            if (isEmptyArray || isEmptyObject) continue
            out[key] = cleaned
        }
        return out as T
    }
    return value
}

/**
 * Recursively strip enhanced value wrappers (__id, __metadata) from objects
 * and unwrap {value: X} patterns where the object is a simple value wrapper.
 *
 * This is used as a safety net for chat message content parts that may not
 * have been fully extracted by extractValueByMetadata (e.g. when content
 * parts are created by fallback builders with __metadata: {} instead of
 * a proper metadata hash).
 */
export function stripEnhancedWrappers(value: unknown): unknown {
    if (value === null || value === undefined) return value
    if (typeof value !== "object") return value

    if (Array.isArray(value)) {
        return value.map(stripEnhancedWrappers)
    }

    const obj = value as Record<string, unknown>

    // Detect enhanced wrapper keys
    const keys = Object.keys(obj)
    const hasEnhancedMeta = keys.includes("__id") || keys.includes("__metadata")

    // Check if this is a simple enhanced value wrapper: has "value" key alongside
    // only __id/__metadata keys (and optionally "selected" for compound types).
    // If so, unwrap and recursively process the value.
    const metaKeySet = new Set(["__id", "__metadata"])
    if (hasEnhancedMeta) metaKeySet.add("selected")
    const nonMetaKeys = keys.filter((k) => !metaKeySet.has(k))
    if (nonMetaKeys.length === 1 && nonMetaKeys[0] === "value") {
        return stripEnhancedWrappers(obj.value)
    }

    // Otherwise, strip __id/__metadata and recursively process remaining keys
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(obj)) {
        if (key === "__id" || key === "__metadata") continue
        result[key] = stripEnhancedWrappers(val)
    }
    return result
}
