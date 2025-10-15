/**
 * Generic table-helper utilities shared between Scenario & Human-Evaluation tables.
 * Keeping them here ensures we only tweak one place if the backend payload shape changes.
 */

/** Lightweight lodash.get replacement for simple "a.b.c" paths */
export function deepGet(obj: any, path: string): any {
    if (!obj || typeof obj !== "object") return undefined
    return path.split(".").reduce((acc: any, key: string) => (acc ? acc[key] : undefined), obj)
}

/**
 * Recursively collect dotted paths to every leaf value inside a nested object.
 * Example: {a:{b:1,c:{d:2}}, e:3} -> ['a.b', 'a.c.d', 'e']
 */
export function collectLeafPaths(obj: any, prefix = ""): string[] {
    if (!obj || typeof obj !== "object") return []
    const paths: string[] = []
    Object.entries(obj).forEach(([k, v]) => {
        const p = prefix ? `${prefix}.${k}` : k
        if (v && typeof v === "object") {
            paths.push(...collectLeafPaths(v, p))
        } else {
            paths.push(p)
        }
    })
    return paths
}

/** Build placeholder skeleton rows so the table height stays stable while data fetches. */
export function buildSkeletonRows(count: number): {key: string; isSkeleton: true}[] {
    return Array.from({length: count}, (_, idx) => ({
        key: `skeleton-${idx}`,
        isSkeleton: true as const,
    }))
}
