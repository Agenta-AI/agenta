/**
 * makeUniqueKeyTransform — an ETL `Transform<TIn, string>` that emits each
 * row's key exactly once across the whole scan.
 *
 * Dedups by key across chunk boundaries (captures a `Set`) and honors an
 * optional exclude set. Rows with no key are skipped. Useful whenever a scan
 * should write a deduplicated set of ids downstream (e.g. trace ids → a
 * batched sink).
 *
 * @packageDocumentation
 */

import type {Chunk, Transform} from "../core/types"

export interface UniqueKeyTransformConfig<TIn> {
    /** Extract the dedup key. Rows with no key (null/empty) are skipped. */
    selectKey: (item: TIn) => string | undefined | null
    /** Keys to treat as already-seen — counted but never emitted. */
    exclude?: ReadonlySet<string>
}

/**
 * Build a `Transform<TIn, string>` that emits unique keys. The captured
 * `Set` means one transform instance is good for exactly one scan.
 */
export function makeUniqueKeyTransform<TIn>(
    config: UniqueKeyTransformConfig<TIn>,
): Transform<TIn, string> {
    const {selectKey, exclude} = config
    const seen = new Set<string>()

    return (chunk: Chunk<TIn>): Chunk<string> => {
        const keys: string[] = []
        for (const item of chunk.items) {
            const key = selectKey(item)
            if (!key || seen.has(key)) continue
            seen.add(key)
            if (exclude?.has(key)) continue
            keys.push(key)
        }
        return {items: keys, cursor: chunk.cursor, meta: chunk.meta}
    }
}
