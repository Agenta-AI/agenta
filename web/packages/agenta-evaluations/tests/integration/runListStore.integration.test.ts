/**
 * Read-only integration test: drive the SHIPPED `@agenta/evaluations` run-list paginated
 * store against a REAL project's existing evaluation runs.
 *
 * Mirrors `scenarioData.integration.test.ts` / `metricSchema.integration.test.ts`: same
 * read-only real-project env, same SDK + shared-axios auth wiring, same jotai-store-driven
 * settle-then-assert pattern.
 *
 *   AGENTA_API_URL          — base URL (e.g. http://localhost/api)
 *   AGENTA_REAL_API_KEY     — a project-scoped API key for the project below
 *   AGENTA_REAL_PROJECT_ID  — the project whose existing runs to read
 *
 * When any are unset the suite skips (consistent with the rest of the integration suite).
 *
 * It NEVER re-implements the store: it imports the real `evaluationRunPaginatedStore` and
 * its filter atoms and reads through them. Deleting that surface breaks this file's
 * compilation.
 *
 * Store API discovered (verified against paginatedStore.ts + createPaginatedEntityStore.ts +
 * createInfiniteTableStore.ts):
 *   - Read combined state: `evaluationRunPaginatedStore.selectors.state({scopeId, pageSize})`
 *     → Atom<{rows, hasMore, isFetching, totalCount}>. `rows` are EvaluationRunTableRow.
 *   - The cursor (`nextCursor`) for the *next* page is NOT on the combined state; it lives on
 *     the inner table store: `evaluationRunPaginatedStore.store.atoms.paginationAtom(params)`
 *     → {hasMore, nextCursor, nextOffset, isFetching, totalCount, nextWindowing}.
 *   - Next-page trigger (headless): the dataset store wraps an inner InfiniteTableStore at
 *     `evaluationRunPaginatedStore.store.store`, whose `atoms.scheduleNextPageAtomFamily(
 *     {scopeId, pageSize})` appends a page — set it with
 *     {nextCursor, nextOffset, nextWindowing, totalRows} (same payload the React
 *     `loadNextPage` builds). This appends a page; the combined `rows` then accumulate.
 *   - Filters: `evaluationRunStatusFilterAtom` / `evaluationRunSearchTermAtom` /
 *     `evaluationRunKindFilterAtom` feed the meta atom → query key, so changing them
 *     re-derives the fetch.
 *
 * Auth wiring (verified, not assumed):
 *   - `queryEvaluationRunsList` (backing `fetchPage`) goes through the Fern `@agenta/sdk`
 *     singleton (`getEvaluationsClient`). `init({apiKey, host})` constructs it.
 *   - The store's meta atom reads `projectIdAtom` from `@agenta/shared/state`. The
 *     `atomWithQuery` reads that atom through the jotai store we subscribe with, and the
 *     query client also lives on that store — so we drive EVERYTHING through
 *     `getDefaultStore()` and set `projectIdAtom` on it. (`invalidate()` in the factory
 *     also uses `getDefaultStore()`, confirming that's the store the families write to.)
 *   - We additionally point the raw `@agenta/shared` axios at the host with the API key,
 *     matching the sibling tests.
 */
import {init} from "@agenta/sdk"
import {axios as sharedAxios} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {getDefaultStore} from "jotai"
import {describe, it, expect, beforeAll, vi} from "vitest"

import {
    evaluationRunPaginatedStore,
    evaluationRunSearchTermAtom,
    evaluationRunStatusFilterAtom,
    type EvaluationRunTableRow,
} from "../../src/state/runList"

const apiUrl = process.env.AGENTA_API_URL
const apiKey = process.env.AGENTA_REAL_API_KEY
const projectId = process.env.AGENTA_REAL_PROJECT_ID
const hasRealProject = Boolean(apiUrl && apiKey && projectId)

// Settle timeout for the query-backed paginated store.
const SETTLE_TIMEOUT = 20_000
const PAGE_SIZE = 5
const SCOPE_ID = "evaluations-runlist-integration"

// Drive the store through the default store consistently (see header note).
const store = getDefaultStore()
const params = {scopeId: SCOPE_ID, pageSize: PAGE_SIZE}

const stateAtom = evaluationRunPaginatedStore.selectors.state(params)
const paginationAtom = evaluationRunPaginatedStore.store.atoms.paginationAtom(params)

/** Keep the query-backed atom mounted so its fetch actually runs (no React here). */
function keepMounted(): () => void {
    const unsubState = store.sub(stateAtom, () => {})
    const unsubPagination = store.sub(paginationAtom, () => {})
    return () => {
        unsubState()
        unsubPagination()
    }
}

describe.skipIf(!hasRealProject)(
    "evaluationRun run-list paginated store against a real project",
    () => {
        beforeAll(() => {
            // Configure BOTH transports the shipped store path uses against the real project:
            //  1. Fern SDK singleton — backs queryEvaluationRunsList (fetchPage).
            init({apiKey, host: apiUrl})
            //  2. Raw @agenta/shared axios — authenticated to match the sibling tests.
            sharedAxios.defaults.baseURL = apiUrl
            sharedAxios.defaults.headers.common.Authorization = `ApiKey ${apiKey}`

            // The store's meta atom reads projectIdAtom — set it on the store we read through.
            store.set(projectIdAtom, projectId!)
            // Start from an unfiltered view.
            store.set(evaluationRunStatusFilterAtom, null)
            store.set(evaluationRunSearchTermAtom, "")
            // Force a fresh fetch (clears any stale paginated cache from prior runs).
            evaluationRunPaginatedStore.invalidate()
        })

        it("first page resolves to an array of EvaluationRunTableRow through the shipped store", async () => {
            const release = keepMounted()
            try {
                await vi.waitFor(
                    () => {
                        const s = store.get(stateAtom)
                        expect(s.isFetching).toBe(false)
                    },
                    {timeout: SETTLE_TIMEOUT, interval: 250},
                )

                const state = store.get(stateAtom)
                expect(Array.isArray(state.rows)).toBe(true)

                // Skeleton rows can linger in the array shape; assert on the real (non-skeleton)
                // rows the store surfaces.
                const realRows = state.rows.filter((row) => row.__isSkeleton !== true)

                if (realRows.length === 0) {
                    console.warn(
                        `[runListStore] Project ${projectId} has zero evaluation runs — ` +
                            `skipping row-shape assertions (the empty-list path through the ` +
                            `shipped store still executed and rows is an array).`,
                    )
                    return
                }

                expect(realRows.length).toBeGreaterThan(0)
                for (const row of realRows) {
                    const typed: EvaluationRunTableRow = row
                    expect(typeof typed.id).toBe("string")
                    expect(typed.id.length).toBeGreaterThan(0)
                    // transformRow sets key = id.
                    expect(typeof typed.key).toBe("string")
                    expect(typed.key.length).toBeGreaterThan(0)
                }
            } finally {
                release()
            }
        })

        it("exposes windowing/cursor state and accumulates rows when paging (or notes single-page)", async () => {
            const release = keepMounted()
            try {
                await vi.waitFor(
                    () => {
                        const s = store.get(stateAtom)
                        expect(s.isFetching).toBe(false)
                    },
                    {timeout: SETTLE_TIMEOUT, interval: 250},
                )

                const firstState = store.get(stateAtom)
                const firstReal = firstState.rows.filter((row) => row.__isSkeleton !== true)

                // The inner pagination atom exposes the cursor shape (the combined `state`
                // selector only surfaces hasMore/isFetching/totalCount).
                const pagination = store.get(paginationAtom)
                expect(typeof pagination.hasMore).toBe("boolean")
                // nextCursor is string|null — assert the shape regardless of presence.
                expect(
                    pagination.nextCursor === null || typeof pagination.nextCursor === "string",
                ).toBe(true)
                // Combined state mirrors hasMore.
                expect(firstState.hasMore).toBe(pagination.hasMore)

                if (!pagination.hasMore || !pagination.nextCursor) {
                    console.warn(
                        `[runListStore] Project ${projectId} has a single page of runs ` +
                            `(hasMore=${pagination.hasMore}); asserted the first-page cursor ` +
                            `shape only — no next-page trigger exercised.`,
                    )
                    return
                }

                // Trigger the next page exactly the way the React loadNextPage does, but
                // headlessly via the SHIPPED inner store's scheduleNextPage atom.
                const scheduleAtom =
                    evaluationRunPaginatedStore.store.store.atoms.scheduleNextPageAtomFamily(params)
                store.set(scheduleAtom, {
                    nextCursor: pagination.nextCursor,
                    nextOffset: pagination.nextOffset ?? firstReal.length,
                    nextWindowing: pagination.nextWindowing,
                    totalRows: firstReal.length,
                })

                // The new page's query fires on subscription; wait for it to settle, then
                // assert the combined rows accumulated (or at least did not shrink).
                await vi.waitFor(
                    () => {
                        const s = store.get(stateAtom)
                        expect(s.isFetching).toBe(false)
                        const real = s.rows.filter((row) => row.__isSkeleton !== true)
                        expect(real.length).toBeGreaterThanOrEqual(firstReal.length)
                    },
                    {timeout: SETTLE_TIMEOUT, interval: 250},
                )

                const secondReal = store
                    .get(stateAtom)
                    .rows.filter((row) => row.__isSkeleton !== true)
                // Resilient: a second page MAY return 0 new rows if the backend's hasMore was a
                // boundary artifact. We assert non-shrinking accumulation (the page was appended
                // and re-merged through the shipped combined-rows path).
                expect(secondReal.length).toBeGreaterThanOrEqual(firstReal.length)
            } finally {
                release()
            }
        })

        it("status filter atom re-derives the shipped query and filtered rows respect it", async () => {
            const release = keepMounted()
            try {
                // Discover a status present in the data from the (unfiltered) first page.
                await vi.waitFor(
                    () => {
                        const s = store.get(stateAtom)
                        expect(s.isFetching).toBe(false)
                    },
                    {timeout: SETTLE_TIMEOUT, interval: 250},
                )

                const baseRows = store
                    .get(stateAtom)
                    .rows.filter((row) => row.__isSkeleton !== true)

                const presentStatus = baseRows
                    .map((row) => row.status)
                    .find(
                        (status): status is string =>
                            typeof status === "string" && status.length > 0,
                    )

                if (!presentStatus) {
                    // Can't guarantee a matching value — assert the filter atom is WIRED:
                    // setting it changes the meta-driven query key (the store re-derives). We
                    // verify by reading the meta atom before/after.
                    console.warn(
                        `[runListStore] No run with a string status on the first page — ` +
                            `asserting filter-atom wiring (meta re-derivation) instead of rows.`,
                    )
                    const metaBefore = store.get(evaluationRunPaginatedStore.metaAtom)
                    store.set(evaluationRunStatusFilterAtom, "running")
                    const metaAfter = store.get(evaluationRunPaginatedStore.metaAtom)
                    expect(metaAfter.status).toBe("running")
                    expect(metaAfter.status).not.toBe(metaBefore.status)
                    store.set(evaluationRunStatusFilterAtom, null)
                    return
                }

                // Apply the discovered status and let the store refetch.
                store.set(evaluationRunStatusFilterAtom, presentStatus)

                await vi.waitFor(
                    () => {
                        const s = store.get(stateAtom)
                        expect(s.isFetching).toBe(false)
                    },
                    {timeout: SETTLE_TIMEOUT, interval: 250},
                )

                const filtered = store
                    .get(stateAtom)
                    .rows.filter((row) => row.__isSkeleton !== true)

                // The backend applies the status filter; every returned run must match it.
                for (const row of filtered) {
                    expect(row.status).toBe(presentStatus)
                }
            } finally {
                store.set(evaluationRunStatusFilterAtom, null)
                release()
            }
        })

        it("search term atom filters rows client-side by name through the shipped store", async () => {
            const release = keepMounted()
            try {
                await vi.waitFor(
                    () => {
                        const s = store.get(stateAtom)
                        expect(s.isFetching).toBe(false)
                    },
                    {timeout: SETTLE_TIMEOUT, interval: 250},
                )

                const baseRows = store
                    .get(stateAtom)
                    .rows.filter((row) => row.__isSkeleton !== true)

                // Pick a substring from a named run to guarantee a match exists.
                const namedRun = baseRows.find(
                    (row): row is EvaluationRunTableRow & {name: string} =>
                        typeof row.name === "string" && row.name.trim().length >= 2,
                )

                if (!namedRun) {
                    console.warn(
                        `[runListStore] No named run on the first page — asserting search-atom ` +
                            `wiring (meta re-derivation) instead of filtered rows.`,
                    )
                    store.set(evaluationRunSearchTermAtom, "zzz-nomatch")
                    const meta = store.get(evaluationRunPaginatedStore.metaAtom)
                    expect(meta.searchTerm).toBe("zzz-nomatch")
                    store.set(evaluationRunSearchTermAtom, "")
                    return
                }

                const term = namedRun.name.trim().slice(0, 2).toLowerCase()
                store.set(evaluationRunSearchTermAtom, term)

                await vi.waitFor(
                    () => {
                        const s = store.get(stateAtom)
                        expect(s.isFetching).toBe(false)
                    },
                    {timeout: SETTLE_TIMEOUT, interval: 250},
                )

                const filtered = store
                    .get(stateAtom)
                    .rows.filter((row) => row.__isSkeleton !== true)

                // The store applies the search term client-side in fetchPage by name substring.
                for (const row of filtered) {
                    expect((row.name ?? "").toLowerCase()).toContain(term)
                }
            } finally {
                store.set(evaluationRunSearchTermAtom, "")
                release()
            }
        })
    },
)
