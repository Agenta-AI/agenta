/**
 * Recursively remove empty values from an object or array.
 *
 * Strips out:
 * - `null` and `undefined`
 * - Empty strings (`""`)
 * - Empty objects (`{}`)
 * - Empty arrays after recursive cleanup
 *
 * Used to clean up form payloads before sending to APIs that
 * reject empty/null fields (e.g. vault custom secret payloads).
 */
export const removeEmptyFromObjects = <T = unknown>(obj: T): T => {
    if (Array.isArray(obj)) {
        return obj
            .map((item) => removeEmptyFromObjects(item))
            .filter(
                (item) =>
                    item != null &&
                    (typeof item !== "object" || Object.keys(item as object).length > 0),
            ) as unknown as T
    }
    if (obj && typeof obj === "object") {
        return Object.entries(obj as Record<string, unknown>).reduce(
            (acc, [key, value]) => {
                const cleaned = removeEmptyFromObjects(value)
                if (cleaned !== null && cleaned !== undefined && cleaned !== "") {
                    acc[key] = cleaned
                }
                return acc
            },
            {} as Record<string, unknown>,
        ) as unknown as T
    }
    return obj
}
