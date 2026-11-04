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
