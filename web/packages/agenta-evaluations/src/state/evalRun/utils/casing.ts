/**
 * Tiny local casing helper for the eval-run atom layer.
 *
 * Inlined from `@/oss/lib/helpers/casing` so the relocated atoms stay free of any `@/oss`
 * import. Shallow snake_case → camelCase key conversion only.
 */

/** Convert snake_case object keys to camelCase (shallow) */
export const snakeToCamelCaseKeys = <T extends Record<string, unknown>>(obj: T): T => {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
        const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
        result[camelKey] = value
    }
    return result as T
}
