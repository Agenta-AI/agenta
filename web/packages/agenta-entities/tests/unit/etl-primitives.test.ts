/**
 * Unit tests for the generic ETL primitives in `@agenta/entities/etl`:
 * makeSourceFromCursorFetch, makeBufferedBatchSink, makeUniqueKeyTransform.
 *
 * All three are dependency-injected and pure — exercised here against fakes,
 * no network or entity coupling.
 */

import {describe, expect, it} from "vitest"

import {
    BatchFlushError,
    makeBufferedBatchSink,
    makeSourceFromCursorFetch,
    makeUniqueKeyTransform,
    type Chunk,
    type CursorPage,
    type Source,
} from "../../src/etl"

// ── makeSourceFromCursorFetch ───────────────────────────────────────────────

const collectChunks = async <T>(
    source: Source<T, undefined>,
    signal: AbortSignal,
): Promise<Chunk<T>[]> => {
    const chunks: Chunk<T>[] = []
    for await (const chunk of source.extract(undefined, signal)) chunks.push(chunk)
    return chunks
}

describe("makeSourceFromCursorFetch", () => {
    it("yields one chunk per page, advances the cursor, ends with cursor null", async () => {
        const pages: CursorPage<string>[] = [
            {rows: ["a", "b"], nextCursor: "c1"},
            {rows: ["c", "d"], nextCursor: "c2"},
            {rows: ["e"], nextCursor: null},
        ]
        const seenCursors: (string | null)[] = []
        let i = 0
        const source = makeSourceFromCursorFetch<string>({
            pageDelayMs: 0,
            fetchPage: async (cursor) => {
                seenCursors.push(cursor)
                return pages[i++]
            },
        })

        const chunks = await collectChunks(source, new AbortController().signal)

        expect(chunks).toEqual([
            {items: ["a", "b"], cursor: "c1"},
            {items: ["c", "d"], cursor: "c2"},
            {items: ["e"], cursor: null},
        ])
        // First page is fetched with cursor null; later pages advance.
        expect(seenCursors).toEqual([null, "c1", "c2"])
    })

    it("stops via the empty-page no-progress guard", async () => {
        let calls = 0
        const source = makeSourceFromCursorFetch<string>({
            pageDelayMs: 0,
            maxEmptyPages: 3,
            // Cursor advances each page (so the stuck-cursor guard doesn't
            // fire) but rows stay empty — exercises the empty-page guard.
            fetchPage: async () => {
                calls++
                return {rows: [], nextCursor: `c${calls}`}
            },
        })

        const chunks = await collectChunks(source, new AbortController().signal)

        expect(calls).toBe(3)
        expect(chunks).toHaveLength(3)
        expect(chunks[2].cursor).toBeNull()
    })

    it("stops when the server returns the same cursor we just used (stuck-cursor guard)", async () => {
        // Real-world trigger: every row on the page shares a `start_time`
        // the backend's strict-less-than filter can't bump past, so each
        // fetch returns the same rows + same cursor. The empty-page guard
        // never fires because `rows.length > 0`, but the loop can never
        // make forward progress — the stuck-cursor check ends it cleanly.
        let calls = 0
        const seenCursors: (string | null)[] = []
        const source = makeSourceFromCursorFetch<string>({
            pageDelayMs: 0,
            fetchPage: async (cursor) => {
                calls++
                seenCursors.push(cursor)
                return {rows: ["a", "b"], nextCursor: "stuck-timestamp"}
            },
        })

        const chunks = await collectChunks(source, new AbortController().signal)

        // First fetch with cursor=null gets nextCursor="stuck-timestamp"
        // (no comparison possible). Second fetch with cursor="stuck-timestamp"
        // gets the SAME nextCursor back → loop ends.
        expect(calls).toBe(2)
        expect(seenCursors).toEqual([null, "stuck-timestamp"])
        expect(chunks).toHaveLength(2)
        expect(chunks[1].cursor).toBeNull() // last chunk is closed off
    })

    it("stops scanning once the signal is aborted", async () => {
        const controller = new AbortController()
        let calls = 0
        const source = makeSourceFromCursorFetch<string>({
            pageDelayMs: 0,
            fetchPage: async () => {
                calls++
                if (calls === 2) controller.abort()
                return {rows: ["x"], nextCursor: "next"}
            },
        })

        await collectChunks(source, controller.signal)

        // Page 3 is never fetched — the loop checks the signal first.
        expect(calls).toBe(2)
    })
})

// ── makeBufferedBatchSink ───────────────────────────────────────────────────

const chunkOf = <T>(items: T[]): Chunk<T> => ({items, cursor: null})

describe("makeBufferedBatchSink", () => {
    it("flushes every full batch; finalize flushes the remainder", async () => {
        const flushed: string[][] = []
        const {sink, getFlushedCount} = makeBufferedBatchSink<string>({
            batchSize: 2,
            flush: async (batch) => {
                flushed.push(batch)
            },
        })

        await sink.load(chunkOf(["a", "b", "c"]))
        expect(flushed).toEqual([["a", "b"]]) // [c] buffered

        await sink.load(chunkOf(["d"]))
        expect(flushed).toEqual([
            ["a", "b"],
            ["c", "d"],
        ])

        await sink.load(chunkOf(["e"]))
        await sink.finalize?.()
        expect(flushed).toEqual([["a", "b"], ["c", "d"], ["e"]])
        expect(getFlushedCount()).toBe(5)
    })

    it("finalize drops the buffer when aborted — partial stays a clean multiple", async () => {
        const controller = new AbortController()
        const flushed: string[][] = []
        const {sink, getFlushedCount} = makeBufferedBatchSink<string>({
            batchSize: 10,
            signal: controller.signal,
            flush: async (batch) => {
                flushed.push(batch)
            },
        })

        await sink.load(chunkOf(["a", "b", "c"])) // no full batch — all buffered
        controller.abort()
        await sink.finalize?.()

        expect(flushed).toEqual([])
        expect(getFlushedCount()).toBe(0)
    })

    it("a failed flush throws BatchFlushError carrying the flushed-so-far count", async () => {
        const {sink, getFlushedCount} = makeBufferedBatchSink<string>({
            batchSize: 2,
            flush: async (batch) => {
                if (batch[0] === "c") throw new Error("boom")
            },
        })

        await sink.load(chunkOf(["a", "b"]))
        expect(getFlushedCount()).toBe(2)

        let caught: unknown
        try {
            await sink.load(chunkOf(["c", "d"]))
        } catch (err) {
            caught = err
        }
        expect(caught).toBeInstanceOf(BatchFlushError)
        expect((caught as BatchFlushError).flushedCount).toBe(2)
        expect((caught as BatchFlushError).failedCount).toBe(2)
    })

    it("finalize drops a non-empty buffer after a prior failed flush", async () => {
        const flushed: string[][] = []
        const {sink} = makeBufferedBatchSink<string>({
            batchSize: 2,
            flush: async (batch) => {
                flushed.push([...batch])
                throw new Error("boom")
            },
        })

        let caught: unknown
        try {
            // [a,b] is flushed (and fails); [c] stays buffered.
            await sink.load(chunkOf(["a", "b", "c"]))
        } catch (err) {
            caught = err
        }
        expect(caught).toBeInstanceOf(BatchFlushError)
        expect(flushed).toEqual([["a", "b"]])

        await sink.finalize?.()
        // errored — finalize drops [c], no second flush attempt.
        expect(flushed).toEqual([["a", "b"]])
    })
})

// ── makeUniqueKeyTransform ──────────────────────────────────────────────────

describe("makeUniqueKeyTransform", () => {
    it("dedups keys across chunk boundaries", async () => {
        const transform = makeUniqueKeyTransform<{id: string}>({selectKey: (row) => row.id})

        const first = await transform({items: [{id: "a"}, {id: "b"}, {id: "a"}], cursor: "x"})
        const second = await transform({items: [{id: "b"}, {id: "c"}], cursor: null})

        expect(first.items).toEqual(["a", "b"])
        expect(first.cursor).toBe("x")
        expect(second.items).toEqual(["c"]) // "b" was already seen in the first chunk
    })

    it("honors the exclude set — excluded keys counted as seen, never emitted", async () => {
        const transform = makeUniqueKeyTransform<{id: string}>({
            selectKey: (row) => row.id,
            exclude: new Set(["b"]),
        })

        const out = await transform({items: [{id: "a"}, {id: "b"}, {id: "c"}], cursor: null})

        expect(out.items).toEqual(["a", "c"])
    })

    it("skips rows with no key", async () => {
        const transform = makeUniqueKeyTransform<{id?: string}>({selectKey: (row) => row.id})

        const out = await transform({
            items: [{id: "a"}, {}, {id: undefined}, {id: ""}],
            cursor: null,
        })

        expect(out.items).toEqual(["a"])
    })

    it("caps total emitted keys at the limit, across chunk boundaries", async () => {
        const transform = makeUniqueKeyTransform<{id: string}>({
            selectKey: (row) => row.id,
            limit: 3,
        })

        const first = await transform({items: [{id: "a"}, {id: "b"}], cursor: "x"})
        const second = await transform({
            items: [{id: "c"}, {id: "d"}, {id: "e"}],
            cursor: null,
        })

        expect(first.items).toEqual(["a", "b"])
        // Only "c" fits under the limit of 3 — "d" and "e" are dropped.
        expect(second.items).toEqual(["c"])
    })

    it("does not count excluded keys toward the limit", async () => {
        const transform = makeUniqueKeyTransform<{id: string}>({
            selectKey: (row) => row.id,
            exclude: new Set(["a", "b"]),
            limit: 2,
        })

        const out = await transform({
            items: [{id: "a"}, {id: "b"}, {id: "c"}, {id: "d"}, {id: "e"}],
            cursor: null,
        })

        // a, b excluded (never emitted, never counted); c, d fill the limit.
        expect(out.items).toEqual(["c", "d"])
    })
})
