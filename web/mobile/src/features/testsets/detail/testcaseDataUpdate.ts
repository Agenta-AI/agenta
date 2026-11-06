/**
 * The testcase update that makes a row's data equal `next`. The package update merges, so a
 * key that `current` has and `next` lacks is sent as undefined, which removes it.
 */
export const replaceDataUpdate = (
    current: Record<string, unknown>,
    next: Record<string, unknown>,
): {data: Record<string, unknown>} => ({
    data: {
        ...next,
        ...Object.fromEntries(
            Object.keys(current)
                .filter((key) => !(key in next))
                .map((key) => [key, undefined]),
        ),
    },
})

/** Keys the API keeps in a row's data to match rows across versions. Users never edit them. */
const INTERNAL_FIELDS: ReadonlySet<string> = new Set(["testcase_dedup_id", "__dedup_id__"])

/**
 * A row's data split into what the drawer shows and the internal fields it keeps aside. Built
 * with `Object.fromEntries`, so a field named `__proto__` stays a field of the row.
 */
export const splitInternalFields = (data: Record<string, unknown>) => {
    const entries = Object.entries(data)
    return {
        value: Object.fromEntries(entries.filter(([key]) => !INTERNAL_FIELDS.has(key))),
        internal: Object.fromEntries(entries.filter(([key]) => INTERNAL_FIELDS.has(key))),
    }
}
