/**
 * Unit tests for `exportMatchingTraces` — the bulk-trace export ETL pipeline
 * composition in `@agenta/entities/trace/etl`.
 *
 * Both transports (`fetchPage`, `flushBatch`) are injected, so the whole
 * pipeline is exercised here against fakes — no network, no CSV encoding,
 * no oss coupling.
 */

import {describe, expect, it} from "vitest"

import {
    BatchFlushError,
    exportMatchingTraces,
    type ExportTracePage,
    type ExportTracePageFetcher,
    type ScannedExportRow,
} from "../../src/trace/etl"

interface FakeSpan extends ScannedExportRow {
    trace_id: string
    span_id: string
    name?: string
    children?: FakeSpan[]
}

const span = (trace_id: string, span_id: string, extras: Partial<FakeSpan> = {}): FakeSpan => ({
    trace_id,
    span_id,
    ...extras,
})

/** Build a `fetchPage` that walks a fixed list of pages. */
const pagesFetcher = (pages: ExportTracePage<FakeSpan>[]): ExportTracePageFetcher<FakeSpan> => {
    let i = 0
    return async () => pages[i++] ?? {rows: [], nextCursor: null}
}

describe("exportMatchingTraces", () => {
    it("flattens span trees, dedups by trace+span, and flushes in batches", async () => {
        const flushed: FakeSpan[][] = []
        const result = await exportMatchingTraces<FakeSpan>({
            fetchPage: pagesFetcher([
                {
                    rows: [
                        span("t1", "s1", {children: [span("t1", "s2"), span("t1", "s3")]}),
                        span("t2", "s4"),
                    ],
                    nextCursor: null,
                },
            ]),
            flushBatch: async (batch) => {
                flushed.push(batch)
            },
            batchSize: 2,
            pageDelayMs: 0,
        })

        expect(result.stoppedBy).toBe("done")
        expect(result.rowCount).toBe(4)
        // 4 flattened spans across 2 batches of size 2.
        expect(flushed.map((b) => b.map((r) => r.span_id))).toEqual([
            ["s1", "s2"],
            ["s3", "s4"],
        ])
    })

    it("dedups identical rows across page boundaries", async () => {
        const flushed: FakeSpan[][] = []
        const result = await exportMatchingTraces<FakeSpan>({
            fetchPage: pagesFetcher([
                {rows: [span("t1", "s1"), span("t2", "s2")], nextCursor: "c1"},
                {rows: [span("t2", "s2"), span("t3", "s3")], nextCursor: null},
            ]),
            flushBatch: async (batch) => {
                flushed.push(batch)
            },
            batchSize: 10,
            pageDelayMs: 0,
        })

        expect(result.rowCount).toBe(3)
        expect(flushed.flat().map((r) => r.span_id)).toEqual(["s1", "s2", "s3"])
    })

    it("reports rowCount=0 and stoppedBy=done when no traces match", async () => {
        const result = await exportMatchingTraces<FakeSpan>({
            fetchPage: pagesFetcher([{rows: [], nextCursor: null}]),
            flushBatch: async () => {},
            pageDelayMs: 0,
        })

        expect(result.rowCount).toBe(0)
        expect(result.stoppedBy).toBe("done")
        expect(result.limitReached).toBe(false)
    })

    it("stops at the maxRows cap and flushes exactly maxRows", async () => {
        let page = 0
        const flushed: FakeSpan[][] = []
        const result = await exportMatchingTraces<FakeSpan>({
            // Pages never run out — only the cap stops the scan.
            fetchPage: async () => {
                const base = page++ * 100
                return {
                    rows: Array.from({length: 100}, (_, i) => span(`t${base + i}`, `s${base + i}`)),
                    nextCursor: `c${page}`,
                }
            },
            flushBatch: async (batch) => {
                flushed.push(batch)
            },
            maxRows: 250,
            batchSize: 1000,
            pageDelayMs: 0,
        })

        expect(result.stoppedBy).toBe("limit")
        expect(result.limitReached).toBe(true)
        // The transform's `limit` makes the cap exact — never an overshoot.
        expect(result.rowCount).toBe(250)
        expect(flushed.flat()).toHaveLength(250)
        expect(result.scanned).toBeGreaterThanOrEqual(250)
    })

    it("reports done (not limit) when the source exhausts exactly at the cap", async () => {
        const result = await exportMatchingTraces<FakeSpan>({
            fetchPage: pagesFetcher([
                {
                    rows: Array.from({length: 250}, (_, i) => span(`t${i}`, `s${i}`)),
                    nextCursor: null,
                },
            ]),
            flushBatch: async () => {},
            maxRows: 250,
            batchSize: 1000,
            pageDelayMs: 0,
        })

        // Everything matching was flushed — the limit was reached but nothing
        // was truncated, so this is a clean completion.
        expect(result.stoppedBy).toBe("done")
        expect(result.limitReached).toBe(false)
        expect(result.rowCount).toBe(250)
    })

    it("recurses into nested children when flattening", async () => {
        const flushed: FakeSpan[][] = []
        await exportMatchingTraces<FakeSpan>({
            fetchPage: pagesFetcher([
                {
                    rows: [
                        span("t1", "root", {
                            children: [
                                span("t1", "child", {
                                    children: [span("t1", "grandchild")],
                                }),
                            ],
                        }),
                    ],
                    nextCursor: null,
                },
            ]),
            flushBatch: async (batch) => {
                flushed.push(batch)
            },
            batchSize: 100,
            pageDelayMs: 0,
        })

        expect(flushed.flat().map((r) => r.span_id)).toEqual(["root", "child", "grandchild"])
    })

    it("emits progress for each page and a final reconciliation", async () => {
        const progress: {scanned: number; rows: number}[] = []
        await exportMatchingTraces<FakeSpan>({
            fetchPage: pagesFetcher([
                {rows: [span("t1", "s1")], nextCursor: "c1"},
                {rows: [span("t2", "s2")], nextCursor: null},
            ]),
            flushBatch: async () => {},
            batchSize: 1,
            pageDelayMs: 0,
            onProgress: (p) => progress.push({...p}),
        })

        expect(progress.length).toBeGreaterThanOrEqual(2)
        expect(progress[progress.length - 1].rows).toBe(2)
    })

    it("surfaces a flush failure as BatchFlushError", async () => {
        let caught: unknown
        try {
            await exportMatchingTraces<FakeSpan>({
                fetchPage: pagesFetcher([
                    {rows: [span("t1", "s1"), span("t2", "s2")], nextCursor: null},
                ]),
                flushBatch: async () => {
                    throw new Error("simulated flush failure")
                },
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
        const result = await exportMatchingTraces<FakeSpan>({
            fetchPage: async () => {
                calls++
                if (calls === 2) controller.abort()
                return {rows: [span(`t${calls}`, `s${calls}`)], nextCursor: `c${calls}`}
            },
            flushBatch: async () => {},
            signal: controller.signal,
            batchSize: 100,
            pageDelayMs: 0,
        })

        expect(result.stoppedBy).toBe("cancelled")
        expect(result.limitReached).toBe(false)
    })

    it("accepts a fetchPage that retries internally (rate-limit-wrapper contract)", async () => {
        // Demonstrates the integration contract: callers may wrap their
        // transport with retry logic (e.g. `withRateLimitRetry` in oss) so a
        // transient failure pauses and re-fetches before resolving. The
        // pipeline must accept the eventual successful resolution without
        // double-counting rows or breaking pagination.
        let firstCallAttempted = 0
        const fetchPage: ExportTracePageFetcher<FakeSpan> = async () => {
            firstCallAttempted += 1
            if (firstCallAttempted === 1) {
                throw Object.assign(new Error("Rate limit exceeded"), {status: 429})
            }
            return {
                rows: [span("t1", "s1"), span("t2", "s2")],
                nextCursor: null,
            }
        }

        const flushed: FakeSpan[][] = []
        // Wrap the transport with a one-shot retry that swallows the first 429
        // — the same shape `withRateLimitRetry` produces in production.
        const fetchPageWithRetry: ExportTracePageFetcher<FakeSpan> = async (cursor, signal) => {
            try {
                return await fetchPage(cursor, signal)
            } catch (err) {
                if ((err as {status?: number}).status !== 429) throw err
                return await fetchPage(cursor, signal)
            }
        }

        const result = await exportMatchingTraces<FakeSpan>({
            fetchPage: fetchPageWithRetry,
            flushBatch: async (batch) => {
                flushed.push(batch)
            },
            batchSize: 10,
            pageDelayMs: 0,
        })

        expect(result.rowCount).toBe(2)
        expect(result.stoppedBy).toBe("done")
        expect(flushed.flat().map((r) => r.span_id)).toEqual(["s1", "s2"])
        expect(firstCallAttempted).toBe(2) // 429 then success
    })

    it("terminates cleanly when the server returns a stuck cursor (regression for the 'Exporting 0 rows' hang)", async () => {
        // Reproduces the bug QA hit: every fetched page contains the same
        // rows (cursor never advances). Without the source's stuck-cursor
        // guard, the dedup transform filters every page to empty, the
        // empty-page guard never fires (raw rows.length > 0), and the scan
        // loops forever while the UI shows "Exporting 0 rows".
        let calls = 0
        const flushed: FakeSpan[][] = []
        const result = await exportMatchingTraces<FakeSpan>({
            fetchPage: async () => {
                calls++
                return {
                    rows: [span("t1", "s1"), span("t1", "s2")],
                    nextCursor: "stuck-timestamp",
                }
            },
            flushBatch: async (batch) => {
                flushed.push(batch)
            },
            batchSize: 1000,
            pageDelayMs: 0,
        })

        // First fetch (cursor=null) reads the page. Second fetch
        // (cursor="stuck-timestamp") returns the same cursor → source
        // ends the stream. Pipeline finalizes with whatever made it past
        // dedup from the first page.
        expect(calls).toBe(2)
        expect(result.stoppedBy).toBe("done")
        expect(result.rowCount).toBe(2) // s1, s2 from first page; second page deduped out
        expect(flushed.flat().map((r) => r.span_id)).toEqual(["s1", "s2"])
    })

    it("progress reports matched rows immediately (regression for 'stuck at 0' during scan)", async () => {
        // The buffered batch sink only flushes when a batch fills (default
        // 500). Reporting the flushed count makes the toast stay at 0
        // until the first full batch lands — confusing for users who see
        // "Exporting 0 rows" while pages are clearly being fetched.
        const progressRows: number[] = []
        await exportMatchingTraces<FakeSpan>({
            fetchPage: pagesFetcher([
                {
                    rows: Array.from({length: 50}, (_, i) => span(`t${i}`, `s${i}`)),
                    nextCursor: "c1",
                },
                {
                    rows: Array.from({length: 50}, (_, i) => span(`t${50 + i}`, `s${50 + i}`)),
                    nextCursor: null,
                },
            ]),
            flushBatch: async () => {},
            // Batch size larger than the total — nothing actually flushes
            // until finalize. Progress must still report per-page rows.
            batchSize: 1000,
            pageDelayMs: 0,
            onProgress: (p) => progressRows.push(p.rows),
        })

        // Two per-page progress events + one final reconciliation. The
        // per-page values must be > 0 (post-dedup matched count), not 0.
        expect(progressRows.length).toBeGreaterThanOrEqual(2)
        expect(progressRows[0]).toBe(50)
        expect(progressRows[1]).toBe(100)
        expect(progressRows[progressRows.length - 1]).toBe(100)
    })

    it("uses a custom selectKey when provided", async () => {
        const flushed: FakeSpan[][] = []
        const result = await exportMatchingTraces<FakeSpan>({
            fetchPage: pagesFetcher([
                {
                    rows: [
                        span("t1", "s1", {name: "duplicate-name"}),
                        span("t2", "s2", {name: "duplicate-name"}),
                        span("t3", "s3", {name: "unique-name"}),
                    ],
                    nextCursor: null,
                },
            ]),
            flushBatch: async (batch) => {
                flushed.push(batch)
            },
            // Dedup by name instead of trace+span — drops the second
            // "duplicate-name" row.
            selectKey: (row) => row.name ?? `${row.trace_id}:${row.span_id}`,
            batchSize: 10,
            pageDelayMs: 0,
        })

        expect(result.rowCount).toBe(2)
        expect(flushed.flat().map((r) => r.span_id)).toEqual(["s1", "s3"])
    })
})
