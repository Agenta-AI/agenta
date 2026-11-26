/** One row of a step table: a newest item, or an older one shown under it once expanded. */
export interface TreeRow<Row> {
    row: Row
    /** The key of the group the row belongs to: the variant, or the evaluator. */
    groupKey: string
    /** 0 for the newest item of a group, 1 for an older one. */
    depth: 0 | 1
    /** On a depth 0 row: how many older items the group holds. */
    olderCount: number
}

/**
 * Rows grouped by `groupKey`, newest first in each group, flattened for one table: the newest
 * row of each group, and the older rows right under it while that group is expanded. Groups keep
 * the order their newest row first appears in.
 */
export const flattenTree = <Row>(
    rows: readonly Row[],
    groupKey: (row: Row) => string,
    expanded: ReadonlySet<string>,
): TreeRow<Row>[] => {
    const groups = new Map<string, Row[]>()
    for (const row of rows) {
        const key = groupKey(row)
        const group = groups.get(key)
        if (group) group.push(row)
        else groups.set(key, [row])
    }
    return [...groups].flatMap(([key, [newest, ...older]]) => [
        {row: newest, groupKey: key, depth: 0 as const, olderCount: older.length},
        ...(expanded.has(key)
            ? older.map((row) => ({row, groupKey: key, depth: 1 as const, olderCount: 0}))
            : []),
    ])
}

/** The set with `key` added, or removed when it is already there. */
export const toggleKey = (set: ReadonlySet<string>, key: string): Set<string> => {
    const next = new Set(set)
    if (!next.delete(key)) next.add(key)
    return next
}
