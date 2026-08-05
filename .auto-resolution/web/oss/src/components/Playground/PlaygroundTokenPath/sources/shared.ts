/**
 * Helpers shared across envelope sources.
 */

import type {TokenPathSuggestion} from "@agenta/ui/editor"

/**
 * Dig sub-path names out of the synthetic schema the grouping helper
 * attaches to each port. `_pathHints` preserves the ORIGINAL sub-paths
 * (including multi-segment like `a.b`); `properties` holds flattened
 * top-level keys.
 */
export function getSubPathsFromSchema(schema: unknown): string[] {
    if (!schema || typeof schema !== "object") return []
    const s = schema as {properties?: Record<string, unknown>; _pathHints?: string[]}
    if (Array.isArray(s._pathHints) && s._pathHints.length > 0) return s._pathHints
    if (s.properties && typeof s.properties === "object") return Object.keys(s.properties)
    return []
}

/** Case-insensitive prefix match; empty query matches everything. */
export function queryMatches(label: string, query: string): boolean {
    if (!query) return true
    return label.toLowerCase().startsWith(query.toLowerCase())
}

/**
 * Walk an observed value along a path and return the next-level keys.
 *
 * JSON-string cells (the common storage shape in testcase data) are
 * parsed on the fly so callers can traverse `{"a": {"b": "c"}}` even
 * though it was persisted as a string.
 *
 * Returns an empty set when:
 *   - the path runs off the end of the object
 *   - a segment hits a non-object (primitive or array)
 *   - a JSON-string segment fails to parse
 */
export function collectNextKeysAtPath(root: unknown, path: string[]): Set<string> {
    let current: unknown = root
    for (const segment of path) {
        if (typeof current === "string" && current) {
            try {
                current = JSON.parse(current)
            } catch {
                return new Set()
            }
        }
        if (!current || typeof current !== "object" || Array.isArray(current)) return new Set()
        current = (current as Record<string, unknown>)[segment]
    }
    if (typeof current === "string" && current) {
        try {
            current = JSON.parse(current)
        } catch {
            return new Set()
        }
    }
    if (!current || typeof current !== "object" || Array.isArray(current)) return new Set()
    return new Set(Object.keys(current as Record<string, unknown>))
}

/**
 * Convenience: collect candidate labels across many observations, apply
 * the query filter, and wrap each in a `TokenPathSuggestion` with the
 * given hint. Used by runtime-inferred sources.
 */
export function aggregateObservedKeys(
    observations: Iterable<unknown>,
    afterSlot: string[],
    query: string,
    hint: string,
): TokenPathSuggestion[] {
    const merged = new Set<string>()
    for (const obs of observations) {
        for (const key of collectNextKeysAtPath(obs, afterSlot)) merged.add(key)
    }
    const out: TokenPathSuggestion[] = []
    for (const label of merged) {
        if (!queryMatches(label, query)) continue
        out.push({label, hint})
    }
    return out
}
