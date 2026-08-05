/**
 * Unit tests for `addAllMatchingTracesToQueue` — the batch-add-to-queue ETL
 * pipeline composition in `@agenta/entities/simpleQueue/etl`.
 *
 * Both transports (`fetchPage`, `addTraces`) are injected, so the whole
 * pipeline is exercised here against fakes — no network or molecule coupling.
 */

import {describe, expect, it} from "vitest"

import {
    addAllMatchingTracesToQueue,
    BatchFlushError,
    type TracePage,
    type TracePageFetcher,
} from "../../src/simpleQueue/etl"

/** Build a `fetchPage` that walks a fixed list of pages. */
const pagesFetcher = (pages: TracePage[]): TracePageFetcher => {
    let i = 0
    return async () => pages[i++] ?? {rows: [], nextCursor: null}
}

describe("addAllMatchingTracesToQueue", () => {
    it("scans, dedups by trace_id, flushes in batches, reports a done result", async () => {
        const flushed: string[][] = []
        const result = await addAllMatchingTracesToQueue({
            fetchPage: pagesFetcher([
                {rows: [{trace_id: "t1"}, {trace_id: "t2"}], nextCursor: "c1"},
                {rows: [{trace_id: "t2"}, {trace_id: "t3"}], nextCursor: null},
            ]),
            addTraces: async (_queueId, ids) => {
                flushed.push(ids)
                return "queue-1"
            },
            queueId: "queue-1",
            batchSize: 2,
            pageDelayMs: 0,
        })

        expect(result.stoppedBy).toBe("done")
        expect(result.queued).toBe(3) // t2 deduped across pages
        expect(flushed).toEqual([["t1", "t2"], ["t3"]])
    })

    it("reports nothing queued when no trace matches", async () => {
        const result = await addAllMatchingTracesToQueue({
            fetchPage: pagesFetcher([{rows: [], nextCursor: null}]),
            addTraces: async () => "q",
            queueId: "q",
            pageDelayMs: 0,
        })

        expect(result.queued).toBe(0)
        expect(result.stoppedBy).toBe("done")
    })

    it("excludes already-queued trace ids", async () => {
        const flushed: string[][] = []
        const result = await addAllMatchingTracesToQueue({
            fetchPage: pagesFetcher([
                {
                    rows: [{trace_id: "t1"}, {trace_id: "t2"}, {trace_id: "t3"}],
                    nextCursor: null,
                },
            ]),
            addTraces: async (_queueId, ids) => {
                flushed.push(ids)
                return "q"
            },
            queueId: "q",
            excludeTraceIds: new Set(["t2"]),
            batchSize: 10,
            pageDelayMs: 0,
        })

        expect(result.queued).toBe(2)
        expect(flushed).toEqual([["t1", "t3"]])
    })

    it("emits progress for each page and a final reconciliation", async () => {
        const progress: {scanned: number; queued: number}[] = []
        await addAllMatchingTracesToQueue({
            fetchPage: pagesFetcher([
                {rows: [{trace_id: "t1"}], nextCursor: "c1"},
                {rows: [{trace_id: "t2"}], nextCursor: null},
            ]),
            addTraces: async () => "q",
            queueId: "q",
            batchSize: 1,
            pageDelayMs: 0,
            onProgress: (p) => progress.push({...p}),
        })

        expect(progress.length).toBeGreaterThanOrEqual(2)
        expect(progress[progress.length - 1].queued).toBe(2)
    })

    it("stops at the maxItems cap and queues exactly maxItems", async () => {
        let page = 0
        const flushed: string[][] = []
        const result = await addAllMatchingTracesToQueue({
            // Pages never run out — only the cap stops the scan.
            fetchPage: async () => {
                const base = page++ * 100
                return {
                    rows: Array.from({length: 100}, (_, i) => ({trace_id: `t${base + i}`})),
                    nextCursor: `c${page}`,
                }
            },
            addTraces: async (_queueId, ids) => {
                flushed.push(ids)
                return "q"
            },
            queueId: "q",
            maxItems: 250,
            batchSize: 1000,
            pageDelayMs: 0,
        })

        expect(result.stoppedBy).toBe("cap")
        // The transform's `limit` makes the cap exact — never an overshoot.
        expect(result.queued).toBe(250)
        expect(flushed.flat()).toHaveLength(250)
        expect(result.scanned).toBeGreaterThanOrEqual(250)
    })

    it("reports `done`, not `cap`, when the source exhausts exactly at the cap", async () => {
        const result = await addAllMatchingTracesToQueue({
            fetchPage: pagesFetcher([
                {
                    rows: Array.from({length: 250}, (_, i) => ({trace_id: `t${i}`})),
                    nextCursor: null,
                },
            ]),
            addTraces: async () => "q",
            queueId: "q",
            maxItems: 250,
            batchSize: 1000,
            pageDelayMs: 0,
        })

        // Everything matching was queued — the limit was reached but nothing
        // was truncated, so this is a clean completion.
        expect(result.stoppedBy).toBe("done")
        expect(result.queued).toBe(250)
    })

    it("surfaces a flush failure as BatchFlushError", async () => {
        let caught: unknown
        try {
            await addAllMatchingTracesToQueue({
                fetchPage: pagesFetcher([
                    {rows: [{trace_id: "t1"}, {trace_id: "t2"}], nextCursor: null},
                ]),
                addTraces: async () => null, // a handled failure
                queueId: "q",
                batchSize: 2,
                pageDelayMs: 0,
            })
        } catch (err) {
            caught = err
        }
        expect(caught).toBeInstanceOf(BatchFlushError)
    })

    it("returns a cancelled result when aborted mid-scan", async () => {
        const controller = new AbortController()
        let calls = 0
        const result = await addAllMatchingTracesToQueue({
            fetchPage: async () => {
                calls++
                if (calls === 2) controller.abort()
                return {rows: [{trace_id: `t${calls}`}], nextCursor: `c${calls}`}
            },
            addTraces: async () => "q",
            queueId: "q",
            signal: controller.signal,
            batchSize: 100,
            pageDelayMs: 0,
        })

        expect(result.stoppedBy).toBe("cancelled")
    })
})
