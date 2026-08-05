/**
 * makeUniqueKeyTransform — an ETL `Transform<TIn, string>` that emits each
 * row's key exactly once across the whole scan.
 *
 * Dedups by key across chunk boundaries (captures a `Set`) and honors an
 * optional exclude set. Rows with no key are skipped. An optional `limit`
 * caps how many keys are emitted across the whole scan. Useful whenever a
 * scan should write a deduplicated (and optionally bounded) set of ids
 * downstream (e.g. trace ids → a batched sink).
 *
 * @packageDocumentation
 */

import type {Chunk, Transform} from "../core/types"

export interface UniqueKeyTransformConfig<TIn> {
    /** Extract the dedup key. Rows with no key (null/empty) are skipped. */
    selectKey: (item: TIn) => string | undefined | null
    /** Keys to treat as already-seen — counted but never emitted. */
    exclude?: ReadonlySet<string>
    /**
     * Cap on the total number of keys emitted across the whole scan. Once
     * `limit` keys have been emitted, every later row is skipped and the
     * transform yields empty chunks. Excluded keys never count toward the
     * limit. Omit (or pass `undefined`) for no cap.
     */
    limit?: number
}

/**
 * Build a `Transform<TIn, string>` that emits unique keys. The captured
 * `Set` (and emitted counter) means one transform instance is good for
 * exactly one scan.
 */
export function makeUniqueKeyTransform<TIn>(
    config: UniqueKeyTransformConfig<TIn>,
): Transform<TIn, string> {
    const {selectKey, exclude, limit} = config
    const seen = new Set<string>()
    let emitted = 0

    return (chunk: Chunk<TIn>): Chunk<string> => {
        const keys: string[] = []
        for (const item of chunk.items) {
            // Stop emitting once the cap is hit — later rows yield nothing.
            if (limit !== undefined && emitted >= limit) break
            const key = selectKey(item)
            if (!key || seen.has(key)) continue
            seen.add(key)
            if (exclude?.has(key)) continue
            keys.push(key)
            emitted += 1
        }
        return {items: keys, cursor: chunk.cursor, meta: chunk.meta}
    }
}
