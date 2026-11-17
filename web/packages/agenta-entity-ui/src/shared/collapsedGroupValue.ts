/**
 * The value a collapsed group column shows for one row: the object at the group path.
 * The path is dotted, and a key may hold a dot itself (`{"meta.lang": {orders: ...}}`), so each
 * step takes the longest key the object owns that the path starts with.
 */
export function collapsedGroupValue(
    data: Record<string, unknown> | null | undefined,
    groupPath: string,
): unknown {
    if (!data) return undefined
    if (Object.hasOwn(data, groupPath)) return data[groupPath]

    for (let dot = groupPath.lastIndexOf("."); dot > 0; dot = groupPath.lastIndexOf(".", dot - 1)) {
        const key = groupPath.slice(0, dot)
        const next = Object.hasOwn(data, key) ? data[key] : undefined
        if (next !== null && typeof next === "object" && !Array.isArray(next)) {
            const value = collapsedGroupValue(
                next as Record<string, unknown>,
                groupPath.slice(dot + 1),
            )
            if (value !== undefined) return value
        }
    }
    return undefined
}
