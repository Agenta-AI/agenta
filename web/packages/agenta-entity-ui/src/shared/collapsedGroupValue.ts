/**
 * The value a collapsed group column shows for one row: the object at the group path.
 * A nested group such as `customer.orders` is read through `customer`, and a key that holds a
 * dot (`{"meta.lang": ...}`) is read as one key first.
 */
export function collapsedGroupValue(
    data: Record<string, unknown> | null | undefined,
    groupPath: string,
): unknown {
    if (!data) return undefined
    if (Object.hasOwn(data, groupPath)) return data[groupPath]

    let current: unknown = data
    for (const part of groupPath.split(".")) {
        if (current === null || typeof current !== "object" || Array.isArray(current)) {
            return undefined
        }
        current = (current as Record<string, unknown>)[part]
    }
    return current
}
