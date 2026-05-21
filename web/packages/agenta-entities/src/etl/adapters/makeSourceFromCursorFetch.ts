/**
 * makeSourceFromCursorFetch — builds an ETL `Source<T>` from a cursor-paged
 * fetch function.
 *
 * The caller injects only the per-page transport (`fetchPage`); this adapter
 * owns the scan loop: cursor advance, the empty-page no-progress guard,
 * request throttling, `AbortSignal` checks, and `cursor: null` end-of-stream
 * signaling. Any cursor-paginated API (trace queries, scenario queries, …)
 * becomes an ETL source through this one adapter.
 *
 * @packageDocumentation
 */

import type {Chunk, Source} from "../core/types"

/** One page of a cursor-paged scan. `nextCursor: null` ⇒ end of stream. */
export interface CursorPage<T> {
    rows: T[]
    nextCursor: string | null
}

export interface CursorFetchSourceConfig<T> {
    /** Fetch one page. `cursor` is `null` for the first page. */
    fetchPage: (cursor: string | null, signal: AbortSignal) => Promise<CursorPage<T>>
    /** Delay between page requests, ms — reduces API load. Default 100. */
    pageDelayMs?: number
    /**
     * Empty pages in a row before the scan stops (a guard against a cursor
     * that never advances). Default 3.
     */
    maxEmptyPages?: number
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Build an ETL `Source<T>` from a cursor-paged fetch function. Yields one
 * `Chunk` per page; the final chunk carries `cursor: null`.
 */
export function makeSourceFromCursorFetch<T>(
    config: CursorFetchSourceConfig<T>,
): Source<T, undefined> {
    const {fetchPage, pageDelayMs = 100, maxEmptyPages = 3} = config

    return {
        async *extract(_params, signal): AsyncIterable<Chunk<T>> {
            let cursor: string | null = null
            let emptyPageCount = 0

            while (true) {
                // Cooperative cancellation between pages.
                if (signal.aborted) return

                const page = await fetchPage(cursor, signal)

                emptyPageCount = page.rows.length === 0 ? emptyPageCount + 1 : 0
                const nextCursor = page.nextCursor
                // Safety: the cursor stopped advancing (pages keep coming back
                // empty) — treat as end-of-stream so the loop can't spin.
                const stalled = emptyPageCount >= maxEmptyPages
                const lastChunk = nextCursor === null || stalled

                yield {items: page.rows, cursor: lastChunk ? null : nextCursor}

                if (lastChunk) return

                await delay(pageDelayMs)
                cursor = nextCursor
            }
        },
    }
}
