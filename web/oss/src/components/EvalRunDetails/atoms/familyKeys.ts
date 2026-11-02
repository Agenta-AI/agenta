/**
 * Value equality for `atomFamily` keys.
 *
 * jotai's `atomFamily(initializeAtom, areEqual?)` keys its cache by REFERENCE when
 * `areEqual` is omitted — jotai 2.20's implementation is a plain `atoms.get(param)`
 * against a `Map`. Every family in this folder is keyed by an object literal that is
 * rebuilt at each call site (`get(scenarioStepsQueryFamily({scenarioId, runId}))`), so
 * without a comparator the `Map` never hits and each call mints a BRAND NEW atom.
 *
 * That is unbounded, and for a query atom it is self-driving: each generation mounts its
 * own observer, the observer emits, the emit invalidates the atom that created it, the
 * re-read mints the next generation. React sees an update per generation and eventually
 * throws error #185, "Maximum update depth exceeded". Measured on a 25-scenario run
 * before this comparator existed: 10,744 step-query atoms in 20 seconds, still climbing,
 * where ~200 cells should have created ~200 atoms once.
 *
 * So: every object-keyed `atomFamily` in this folder passes {@link sameFamilyKey}.
 *
 * The keys here are flat records of scalars, sometimes carrying a column descriptor
 * (itself flat, with a `pathSegments` string array), so one level of nesting plus arrays
 * of scalars is all the comparison needs. A nullish key normalises to `{}`, because
 * `family(undefined)` and `family({})` mean the same thing to every caller here.
 */

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const sameArray = (a: unknown[], b: unknown[]): boolean =>
    a.length === b.length && a.every((item, index) => Object.is(item, b[index]))

/** One level of value comparison: scalars by `Object.is`, arrays and flat records by element. */
const sameValue = (a: unknown, b: unknown): boolean => {
    if (Object.is(a, b)) return true
    if (Array.isArray(a) && Array.isArray(b)) return sameArray(a, b)
    if (isPlainObject(a) && isPlainObject(b)) return sameRecord(a, b)
    return false
}

/** Compares the UNION of both key sets, so an absent key and an explicit `undefined` match. */
const sameRecord = (a: Record<string, unknown>, b: Record<string, unknown>): boolean => {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const key of keys) {
        const left = a[key]
        const right = b[key]
        if (Object.is(left, right)) continue
        if (Array.isArray(left) && Array.isArray(right) && sameArray(left, right)) continue
        // Only ONE level deeper: the column descriptor is flat, and going arbitrarily deep
        // would make the comparator the expensive part of every family lookup.
        if (isPlainObject(left) && isPlainObject(right)) {
            const nested = new Set([...Object.keys(left), ...Object.keys(right)])
            if ([...nested].every((k) => sameValue(left[k], right[k]))) continue
        }
        return false
    }
    return true
}

/**
 * `areEqual` for an object-keyed `atomFamily`. Pass this as the second argument to EVERY
 * such family, or the family mints a new atom per call. See the module docstring.
 */
export const sameFamilyKey = <T>(a: T, b: T): boolean => {
    const left = a ?? {}
    const right = b ?? {}
    if (!isPlainObject(left) || !isPlainObject(right)) return Object.is(a, b)
    return sameRecord(left, right)
}
