/**
 * makeSourceFromPaginatedStore — wraps any `createPaginatedEntityStore` instance
 * as an ETL `Source<TApiRow>`.
 *
 * This is the integration point between the ETL engine and the existing
 * paginated-store infrastructure. The Source drives the store's reactive
 * pagination machinery (subscribes to the controller, schedules next pages
 * via the underlying table store's atoms), yielding chunks of newly-loaded
 * rows for each page.
 *
 * Key properties:
 *   - Uses the SAME `fetchPage` callback the store uses (no duplicate plumbing)
 *   - Shares the store's accumulated rows with any UI consumer subscribed to
 *     the same scope (so an ETL pipeline running in parallel populates the
 *     same atoms the V-table would read from)
 *   - Honors AbortSignal — cancellation stops the loop and prevents further
 *     page scheduling
 *   - Yields cursor=null on the final chunk to signal end-of-stream cleanly
 *
 * Architectural note: this file uses deep relative imports (rather than
 * `@agenta/entities/shared`) because the entities package's `shared` barrel
 * transitively pulls React components (via `shared/user/UserAuthorLabel.tsx`).
 * The barrel hygiene issue is documented in eval-package-architecture.md;
 * once that's fixed, this file can switch to clean package imports.
 *
 * @packageDocumentation
 */

import {getDefaultStore, type Atom, type WritableAtom} from "jotai"

import type {WindowingState} from "../../shared/tableTypes"
import type {Chunk, Source} from "../core/types"

// ============================================================================
// Type-level shape of what we need from a PaginatedEntityStore
// ============================================================================

/**
 * The subset of `PaginatedEntityStore` this adapter relies on. Declared
 * locally so we don't have to import the full type (which would pull deep
 * paginated-store internals into the engine package).
 */
export interface PaginatedStoreLike<TApiRow> {
    entityName: string
    /** The dataset store wraps the inner table store. */
    store: {
        /** Inner table store with the pagination primitives. */
        store: {
            atoms: {
                paginationInfoAtomFamily: (params: {scopeId: string; pageSize: number}) => Atom<{
                    isFetching: boolean
                    hasMore: boolean
                    nextCursor: string | null
                    nextOffset: number | null
                    nextWindowing: WindowingState | null
                    totalCount: number | null
                }>
                combinedRowsAtomFamily: (params: {
                    scopeId: string
                    pageSize: number
                }) => Atom<TApiRow[]>
                // Must match `ScheduleWriteArg` in createInfiniteTableStore.ts:
                // a real paginated store's scheduler requires all four fields.
                scheduleNextPageAtomFamily: (params: {
                    scopeId: string
                    pageSize: number
                }) => WritableAtom<
                    null,
                    [
                        null | {
                            nextCursor: string
                            nextOffset: number
                            nextWindowing: WindowingState | null
                            totalRows: number
                        },
                    ],
                    void
                >
            }
        }
    }
    /** Controller atom family — subscribing triggers the initial fetch. */
    controller: (params: {scopeId: string; pageSize: number}) => Atom<{
        rows: TApiRow[]
        hasMore: boolean
        isFetching: boolean
        totalCount: number | null
        selectedKeys: unknown[]
    }>
}

// ============================================================================
// Adapter
// ============================================================================

export interface MakeSourceParams {
    /** Scope ID for the paginated store's controller atom family. */
    scopeId: string
    /** Page size — passed to the store's pagination machinery. */
    pageSize?: number
    /** Max time (ms) to wait for any single page load. Defaults to 30s. */
    pageLoadTimeoutMs?: number
}

/**
 * Wraps a `createPaginatedEntityStore` instance as an ETL `Source<TApiRow>`.
 *
 * Implementation strategy:
 *   1. Subscribe to the controller atom — this kicks off the initial fetch
 *      and keeps the store's reactive pagination machinery alive.
 *   2. Poll the pagination atom for `isFetching=false`. When the page lands,
 *      yield the newly-loaded rows as a chunk (diff from rowsSeen index).
 *   3. If `hasMore` is true, dispatch `scheduleNextPage` and loop.
 *   4. If `hasMore` is false, yield with `cursor: null` and return.
 *
 * The same `fetchPage` callback the store was constructed with drives every
 * page load. Other consumers of the store (e.g. a V-table subscribed to the
 * same scope) will see rows accumulate in real time as this Source iterates.
 */
export function makeSourceFromPaginatedStore<TApiRow>(
    paginatedStore: PaginatedStoreLike<TApiRow>,
    params: MakeSourceParams,
): Source<TApiRow, undefined> {
    const {scopeId, pageSize = 200, pageLoadTimeoutMs = 30_000} = params

    return {
        async *extract(_extractParams, signal) {
            const store = getDefaultStore()
            const tableAtoms = paginatedStore.store.store.atoms
            const familyKey = {scopeId, pageSize}

            const paginationAtom = tableAtoms.paginationInfoAtomFamily(familyKey)
            const rowsAtom = tableAtoms.combinedRowsAtomFamily(familyKey)
            const scheduleAtom = tableAtoms.scheduleNextPageAtomFamily(familyKey)
            const controllerAtom = paginatedStore.controller(familyKey)

            // Subscribe to controller — kicks off the initial fetch and keeps
            // the reactive machinery alive. Unsubscribe in the finally block.
            const unsub = store.sub(controllerAtom, () => {})

            try {
                let rowsSeen = 0
                let lastCursor: string | null = null

                while (!signal.aborted) {
                    // Wait for the current page to settle (isFetching → false)
                    const waitStart = Date.now()
                    while (!signal.aborted) {
                        const pagination = store.get(paginationAtom)
                        if (!pagination.isFetching) break
                        if (Date.now() - waitStart > pageLoadTimeoutMs) {
                            throw new Error(
                                `page load exceeded ${pageLoadTimeoutMs}ms (scope: ${scopeId})`,
                            )
                        }
                        await new Promise((r) => setTimeout(r, 50))
                    }
                    if (signal.aborted) return

                    const pagination = store.get(paginationAtom)
                    const rows = store.get(rowsAtom)
                    const newRows = rows.slice(rowsSeen)
                    rowsSeen = rows.length

                    // Compute cursor for this chunk:
                    //   - If hasMore: cursor is the store's nextCursor (or fallback to last-row-id)
                    //   - If !hasMore: cursor is null (end of stream)
                    const apiCursor = pagination.nextCursor
                    const lastRow = newRows[newRows.length - 1] as {id?: string} | undefined
                    const fallback = lastRow?.id ?? null
                    const chunkCursor: string | null = pagination.hasMore
                        ? (apiCursor ?? fallback)
                        : null

                    const chunk: Chunk<TApiRow> = {
                        items: newRows,
                        cursor: chunkCursor,
                        meta: {
                            hint: paginatedStore.entityName,
                            hasMore: pagination.hasMore,
                        },
                    }

                    yield chunk

                    if (!pagination.hasMore || newRows.length === 0) return
                    if (signal.aborted) return

                    // Drive the next page via the store's own scheduler
                    const nextCursor = pagination.nextCursor ?? fallback
                    if (!nextCursor || nextCursor === lastCursor) return
                    lastCursor = nextCursor

                    // Mirror `useInfiniteTablePagination.loadNextPage` — the
                    // store's scheduler reducer requires all four fields.
                    const nextWindowing: WindowingState = pagination.nextWindowing ?? {
                        next: nextCursor,
                        order: "ascending",
                        limit: pageSize,
                        stop: null,
                    }
                    store.set(scheduleAtom, {
                        nextCursor,
                        nextOffset: pagination.nextOffset ?? rowsSeen,
                        nextWindowing,
                        totalRows: rowsSeen,
                    })
                }
            } finally {
                unsub()
            }
        },
    }
}
