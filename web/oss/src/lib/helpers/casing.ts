/** Convert snake_case object keys to camelCase (shallow) */
export const snakeToCamelCaseKeys = <T extends Record<string, unknown>>(obj: T): T => {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
        const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
        result[camelKey] = value
    }
    return result as T
}
