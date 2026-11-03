/**
 * Shape helpers for an object variable whose prompt references some of its keys. The card shows
 * only the keys the prompt references; the keys it does not reference stay on the test case.
 */

/** A schema-vs-value structural conflict at a single key (possibly nested
 *  — `key` is a dotted path, e.g. `"obj.a"`). Schema expects a nested
 *  object/array, value carries a scalar. */
export interface ShapeConflict {
    key: string
    currentValue: unknown
    expectedShape: unknown
}

/** A nested key that exists in the value but not in the schema — captured
 *  at the depth where it was first dropped from the rendered shape. `path`
 *  is dotted relative to the variable root (e.g. `"a.y"` for the variable
 *  `obj`'s stashed key `obj.a.y`); `value` is the entire sub-tree the key
 *  carried, which can itself be a primitive or a deeply nested object. */
export interface StashedPath {
    path: string
    value: unknown
}

/** Walks `skel` (schema-derived empty shape) and `val` (current value) in
 *  parallel, building a render shape that contains ONLY the keys the schema
 *  declares — at every depth. Keys present in `val` but absent from `skel`
 *  are dropped from the rendered output and collected into `stashed`; the
 *  caller's write-back path (`mergeEditWithStash` below) restores them when
 *  persisting edits. */
export function buildSchemaStrictShape(
    skel: unknown,
    val: unknown,
    pathPrefix: string,
): {merged: unknown; conflicts: ShapeConflict[]; stashed: StashedPath[]} {
    const skelIsObject = skel !== null && typeof skel === "object" && !Array.isArray(skel)
    const valIsObject = val !== null && typeof val === "object" && !Array.isArray(val)
    if (!skelIsObject || !valIsObject) return {merged: val, conflicts: [], stashed: []}

    const skelRec = skel as Record<string, unknown>
    const valRec = val as Record<string, unknown>
    const merged: Record<string, unknown> = {}
    const conflicts: ShapeConflict[] = []
    const stashed: StashedPath[] = []

    for (const [k, skelV] of Object.entries(skelRec)) {
        const path = pathPrefix ? `${pathPrefix}.${k}` : k
        if (k in valRec) {
            const valV = valRec[k]
            const skelVIsNested =
                skelV !== null && typeof skelV === "object" && !Array.isArray(skelV)
            const valVIsScalar = valV === null || typeof valV !== "object"
            if (skelVIsNested && valVIsScalar) {
                conflicts.push({key: path, currentValue: valV, expectedShape: skelV})
                merged[k] = valV
            } else if (skelVIsNested) {
                const sub = buildSchemaStrictShape(skelV, valV, path)
                merged[k] = sub.merged
                conflicts.push(...sub.conflicts)
                stashed.push(...sub.stashed)
            } else {
                merged[k] = valV
            }
        } else {
            merged[k] = skelV
        }
    }

    // Value-only keys at THIS level — captured AFTER the schema walk so
    // stash entries from deeper levels (descended via recursion) come
    // first in the list. Display order: deepest first, then shallow,
    // which keeps the footer's `obj.a.y` entries grouped together when
    // multiple branches are affected.
    for (const [k, v] of Object.entries(valRec)) {
        if (!(k in skelRec)) {
            stashed.push({path: pathPrefix ? `${pathPrefix}.${k}` : k, value: v})
        }
    }

    return {merged, conflicts, stashed}
}

/** Walks `edit` (the FormView / JSON-editor output) and `original` (the
 *  testcase's current value) in parallel against `skel`. At every depth:
 *  - Keys in `original` that aren't in `skel` (the "stash") are preserved.
 *  - Keys in `skel` are taken from `edit` (recursing if nested).
 *
 *  This is the inverse of `buildSchemaStrictShape`: the user only sees /
 *  edits schema keys, but the underlying value keeps the stash so that
 *  re-adding `{{obj.a.y}}` to the prompt later restores `y`'s value
 *  without data loss. Mirrors the existing top-level "removed variable's
 *  column persists" behaviour, scoped to every depth. */
export function mergeEditWithStash(edit: unknown, original: unknown, skel: unknown): unknown {
    const skelIsObject = skel !== null && typeof skel === "object" && !Array.isArray(skel)
    if (!skelIsObject) return edit
    const editIsObject = edit !== null && typeof edit === "object" && !Array.isArray(edit)
    if (!editIsObject) return edit

    const originalIsObject =
        original !== null && typeof original === "object" && !Array.isArray(original)
    const skelRec = skel as Record<string, unknown>
    const editRec = edit as Record<string, unknown>
    const originalRec = originalIsObject ? (original as Record<string, unknown>) : {}

    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(originalRec)) {
        if (!(k in skelRec)) result[k] = v
    }
    for (const [k, skelV] of Object.entries(skelRec)) {
        if (k in editRec) {
            result[k] = mergeEditWithStash(editRec[k], originalRec[k], skelV)
        }
    }
    return result
}
