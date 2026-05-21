/**
 * EtlPocScenariosTable
 *
 * Real InfiniteVirtualTable mounted against the production scenarios
 * paginated store, but with the entities-package ETL hydrate strategy
 * wired into the page-load lifecycle.
 *
 * Architecture:
 *
 *     evaluationPreviewTableStore (paginated, scopeId = runId)
 *                       │
 *                       ▼
 *        useInfiniteTablePagination
 *                       │  rows: PreviewTableRow[]
 *                       ▼
 *           useHydrateScenarios(rows)
 *                       │  bulk prefetch on every new page:
 *                       │    results + metrics + testcases + traces
 *                       ▼
 *            (entity caches now populated for visible rows)
 *                       │
 *                       ▼
 *              useEtlColumns(schema)
 *                       │  columns derived from runSchema.steps + mappings
 *                       │  via resolveMappings (same code path as headless PoC)
 *                       ▼
 *                EtlResolvedCell  ──── reads molecule caches per-cell,
 *                                       resolves value via resolveMappings,
 *                                       renders with stats-blob unwrap.
 *
 *     [Optional] post-hydrate predicate filter (v1)
 *     [Always]   scope-change eviction on (projectId, runId) change
 */

import {useEffect, useMemo, useRef, useState} from "react"

import {
    evaluationResultMolecule,
    evaluationMetricMolecule,
    type EvaluationResult,
    type EvaluationMetric,
} from "@agenta/entities/evaluationRun"
import {
    type RowPredicate,
    type RunSchema,
    unwrapStatsForCompare,
    resolveMappings,
} from "@agenta/entities/evaluationRun/etl"
import {InfiniteVirtualTable} from "@agenta/ui/table"
import {Segmented, Tag, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {
    activePreviewProjectIdAtom,
    activePreviewRunIdAtom,
} from "@/oss/components/EvalRunDetails/atoms/run"
import {evaluationRunQueryAtomFamily} from "@/oss/components/EvalRunDetails/atoms/table/run"
import {useInfiniteTablePagination} from "@/oss/components/InfiniteVirtualTable"

import {CellMaterializerContext} from "./cellMaterializerContext"
import PredicateFilterBar from "./PredicateFilterBar"
import {scenarioThinPaginatedStore, type ScenarioThinRow} from "./scenarioPaginatedStore"
import {useCellMaterialization} from "./useCellMaterialization"
import {useEtlColumns} from "./useEtlColumns"
import {hydrationVersionAtom, useHydrateScenarios, type SliceFetchMode} from "./useHydrateScenarios"
import {useLookaheadPrefetch} from "./useLookaheadPrefetch"
import {useScopeChangeEviction} from "./useScopeChangeEviction"

const {Text} = Typography

const PAGE_SIZE = 50

// Stable empty-array reference for the table's dataSource during a
// "scanning, nothing matched yet" state — avoids handing the table a
// fresh `[]` every render.
const EMPTY_ROWS: ScenarioThinRow[] = []

/**
 * Fixed-width numeric slot for the header counters.
 *
 * The header counts grow digit-count as the pipeline loads (0 → 1000),
 * which would reflow every tag after them and make the runId jump on the
 * far right. Rendering each number right-aligned in a fixed `ch`-width
 * inline-block keeps the surrounding text — and the whole header — stable
 * while the values tick up.
 */
const Num = ({value, ch}: {value: number | string; ch: number}) => (
    <span className="inline-block text-right tabular-nums" style={{minWidth: `${ch}ch`}}>
        {value}
    </span>
)

export interface EtlPocScenariosTableProps {
    runId: string
    projectId: string | null
}

const EtlPocScenariosTable = ({runId, projectId}: EtlPocScenariosTableProps) => {
    // The scenarios paginated store + the runSchema atom both read from the
    // shared `activePreviewProjectIdAtom` / `activePreviewRunIdAtom` — they
    // are populated by `EvalRunPreviewPage` in the production scenarios
    // route. The test page lives outside that route, so we set them here.
    // Without this, `isEnabled: ({meta}) => Boolean(meta.projectId)` returns
    // false and pagination never fires.
    const setActiveProjectId = useSetAtom(activePreviewProjectIdAtom)
    const setActiveRunId = useSetAtom(activePreviewRunIdAtom)
    useEffect(() => {
        setActiveProjectId(projectId)
        setActiveRunId(runId)
        return () => {
            setActiveProjectId(null)
            setActiveRunId(null)
        }
    }, [projectId, runId, setActiveProjectId, setActiveRunId])

    // Run schema (steps + mappings) — drives columns + cell resolution.
    const runQuery = useAtomValue(evaluationRunQueryAtomFamily(runId))
    const schema: RunSchema | null = useMemo(() => {
        const rawRun = runQuery.data?.rawRun
        const steps = rawRun?.data?.steps
        const mappings = rawRun?.data?.mappings
        if (!Array.isArray(steps) || !Array.isArray(mappings)) return null
        return {
            name: rawRun?.name ?? rawRun?.id ?? null,
            status: rawRun?.status ?? null,
            steps,
            mappings,
        } as RunSchema
    }, [runQuery.data])

    // Paginated scenario source — thin: rows carry `{key, id, scenarioId,
    // __isSkeleton}` only. All other column data is materialized via
    // molecule caches (page-level hydrate + cell-level lazy fallback).
    // Same convention as `testcasePaginatedStore` in the entities package.
    const pagination = useInfiniteTablePagination({
        store: scenarioThinPaginatedStore,
        scopeId: runId,
        pageSize: PAGE_SIZE,
    })

    // v1 predicate filter — declared early so the hydrate hook can consume it.
    const [predicate, setPredicate] = useState<RowPredicate | null>(null)

    // Programmatic scroll handle for the IVT. Used to reset scroll to row 0
    // whenever the filter changes — without it, the viewport stays at the
    // user's prior offset, which often lands inside the filtered list and
    // hides the first matches.
    const tableRef = useRef<{
        scrollTo: (config: {index: number; align?: "top" | "bottom" | "auto"}) => void
    } | null>(null)

    // Scroll back to the top whenever the predicate changes (added,
    // cleared, or modified). Skip the very first render — the table
    // starts at the top anyway and we don't want a no-op scrollTo
    // before the table mounts.
    const firstPredicateRef = useRef(true)
    useEffect(() => {
        if (firstPredicateRef.current) {
            firstPredicateRef.current = false
            return
        }
        // Schedule after the render that re-evaluates filteredRows so
        // the IVT has the new dataSource mounted before we scroll.
        const id = requestAnimationFrame(() => {
            tableRef.current?.scrollTo({index: 0, align: "top"})
        })
        return () => cancelAnimationFrame(id)
    }, [predicate])
    // Hydrate strategy:
    //   "auto" — fetch only what the predicate needs (or all 4 when no
    //            predicate). Production-realistic default.
    //   "all"  — always fetch all 4. Useful for A/B perf comparison and
    //            for workflows that need every column populated up-front.
    const [sliceMode, setSliceMode] = useState<SliceFetchMode>("auto")

    // Bulk-hydrate every newly-loaded page of scenarios.
    //
    // When `predicate` is set + sliceMode = "auto", hydrate only fetches
    // the entity slices the predicate needs to evaluate (typically
    // `results + metrics` for an evaluator filter — skipping the
    // ~70%-of-bytes trace fetch). Cells whose columns weren't pre-hydrated
    // fall back to lazy materialization on first render (see EtlResolvedCell).
    const hydration = useHydrateScenarios({
        projectId,
        runId,
        rows: pagination.rows,
        schema,
        predicate,
        sliceMode,
    })

    // Scope-change eviction handler — the production-should pattern.
    useScopeChangeEviction({projectId, runId})

    // Cell-side lazy materializer — fills cache slices the predicate-driven
    // page-level hydrate skipped. Visible cells request `(slice, id)` on
    // first render; the materializer coalesces concurrent requests in the
    // same microtask into one bulk fetch per slice.
    const materializer = useCellMaterialization({projectId, runId})

    // (predicate state is declared above so the hydrate hook can consume it.)

    // Subscribe to hydrationVersion so filteredRows re-evaluates when the
    // molecule cache updates. Without this, rows that initially passed
    // through "keep visible until known" stay in filteredRows even after
    // predicate slices land and reveal them as non-matches — the user
    // sees stale incorrect rows until the next pagination event.
    const hydrationVersion = useAtomValue(hydrationVersionAtom)

    const filteredRows = useMemo(() => {
        if (!predicate || !schema) return pagination.rows

        // Skeleton rows pass through (the predicate can't evaluate against
        // them — they don't have hydrated data yet).
        const out: ScenarioThinRow[] = []
        for (const r of pagination.rows as ScenarioThinRow[]) {
            // `key` is IVT row identity (`${runId}::${rowKey}`); `scenarioId`
            // is the actual scenario UUID. Predicate eval needs the latter.
            if (r.__isSkeleton || !r.scenarioId) {
                out.push(r)
                continue
            }
            // Build a thin HydratedScenarioRow from cache for predicate eval.
            // This isn't the most efficient — production should run filter
            // chunk-at-a-time inside the hydrate pipeline. For the test page
            // it's per-render but only touches the visible window so it's
            // fine.
            if (matchesPredicate(predicate, schema, projectId, runId, r.scenarioId)) {
                out.push(r)
            }
        }
        return out
    }, [pagination.rows, predicate, schema, projectId, runId, hydrationVersion])

    // Count of CONFIRMED matches — rows that are hydrated AND actually
    // satisfy the predicate.
    //
    // This deliberately excludes "keep-visible-until-known" rows: a
    // freshly-loaded page is 50 unhydrated scenarios, and
    // `matchesPredicate` optimistically returns true for unhydrated rows
    // (so a real match isn't hidden while it loads). The raw non-skeleton
    // count therefore oscillates 50 → 0 every page during a no-match scan
    // (page lands → 50 "pending" → hydrate → 0 match). The confirmed
    // count stays a steady 0, which is the signal we actually want.
    const confirmedCount = useMemo(() => {
        if (!predicate || !schema || !projectId || !runId) return 0
        let n = 0
        for (const r of filteredRows) {
            if (r.__isSkeleton || !r.scenarioId) continue
            // null until hydrated — those rows are pending, not confirmed.
            if (!resolveOneScenarioFromCache(projectId, runId, r.scenarioId, schema)) continue
            if (matchesPredicate(predicate, schema, projectId, runId, r.scenarioId)) n += 1
        }
        return n
    }, [filteredRows, predicate, schema, projectId, runId, hydrationVersion])

    // "Scanning, nothing matched yet" — a predicate is active, zero rows
    // have CONFIRMED-matched so far, and the pipeline is still working
    // (more pages to scan, or the current page is still hydrating). A
    // no-match predicate makes the fill loop scan the whole dataset;
    // collapsing that into one stable loading state — and showing the
    // real empty state only once everything settles — removes the
    // per-page flicker.
    const scanningEmpty =
        !!predicate &&
        confirmedCount === 0 &&
        (Boolean(pagination.paginationInfo.hasMore) || hydration.isHydrating)

    // Lookahead prefetch for the constructed viewport.
    //
    // Critical: we pass `filteredRows`, NOT `pagination.rows`. With a
    // predicate active, the viewport-fill loop may have loaded 10x more
    // pagination pages than the user actually sees — prefetching for
    // every loaded scenario would waste ~94% of the work on rows that
    // get filtered out. See useLookaheadPrefetch's file header for
    // details.
    //
    // No predicate: filteredRows == pagination.rows  → behaves identically.
    // With predicate: filteredRows is the matched subset → only those
    // rows get cell-data prefetched ahead of view.
    //
    // Skipped when sliceMode === "all" — page-level hydrate already
    // covered every slice for every scenario.
    useLookaheadPrefetch({
        projectId,
        runId,
        rows: filteredRows,
        materializer,
        sliceMode,
    })

    // Viewport-fill loop for client-side filtering.
    //
    // The IVT fires `loadMore` when its internal scroll position approaches
    // the bottom — which never happens if a strict predicate reduces the
    // visible row count below the viewport height. (e.g. 1 match in 50
    // rows: table never scrolls, `loadMore` never fires, user is stuck.)
    //
    // While a predicate is active, drive `loadNextPage` ourselves until
    // either we've accumulated enough matches to fill a typical viewport
    // (TARGET) or the dataset is exhausted (`hasMore: false`). The hook's
    // internal `isFetching` flag de-duplicates concurrent calls.
    //
    // The effect re-runs after each page lands (filteredRows changes), so
    // we naturally walk through pages one at a time. Skipped entirely when
    // no predicate is active — IVT's native scroll-triggered loading
    // handles that case.
    const VIEWPORT_FILL_TARGET = 30
    useEffect(() => {
        if (!predicate) return
        if (!pagination.paginationInfo.hasMore) return
        if (pagination.paginationInfo.isFetching) return
        // Gate on CONFIRMED matches, not the pending-inclusive row count —
        // otherwise a full page of not-yet-hydrated rows (50) trips the
        // target and stalls the scan until they hydrate away.
        if (confirmedCount >= VIEWPORT_FILL_TARGET) return
        pagination.loadNextPage()
    }, [
        predicate,
        confirmedCount,
        pagination.paginationInfo.hasMore,
        pagination.paginationInfo.isFetching,
        pagination,
    ])

    const columns = useEtlColumns({projectId, runId, schema})

    // Compute scenario-index per row for the sticky "#" column. The thin
    // store doesn't track this (it's a presentation concern), so we map
    // through the visible rows once.
    const ivtColumns = useMemo(() => {
        const indexByKey = new Map<string, number>()
        pagination.rows.forEach((r, idx) => {
            indexByKey.set((r as ScenarioThinRow).key, idx + 1)
        })
        const indexCol = {
            key: "__index",
            title: "#",
            width: 56,
            fixed: "left" as const,
            render: (_: unknown, record: ScenarioThinRow) => (
                <Text type="secondary" className="text-xs">
                    {record.__isSkeleton ? "…" : (indexByKey.get(record.key) ?? "")}
                </Text>
            ),
        }
        // Guard every column's `render` against an undefined record.
        //
        // antd's virtual table can briefly call a cell `render` (and
        // `rowKey`) with an out-of-range record while `dataSource`
        // (`filteredRows`) is shrinking right after a predicate change —
        // its internal virtual window lags the new, shorter array by a
        // render. Without this guard that out-of-range `undefined`
        // crashes the page. The guard renders nothing for those phantom
        // rows; antd re-syncs its window on the next frame and they
        // vanish. (See the matching `rowKey` guard on the table below.)
        type RenderCol = {
            render?: (v: unknown, r: ScenarioThinRow, i: number) => React.ReactNode
        }
        const guardCol = <T,>(col: T): T => {
            const c = col as T & RenderCol
            if (typeof c.render !== "function") return col
            const inner = c.render
            return {
                ...c,
                render: (v: unknown, r: ScenarioThinRow, i: number) =>
                    r == null ? null : inner(v, r, i),
            }
        }
        return [guardCol(indexCol), ...columns.map(guardCol)]
    }, [columns, pagination.rows])

    return (
        <CellMaterializerContext.Provider value={materializer}>
            <section className="w-full h-full overflow-hidden flex flex-col">
                {/*
                 * Lean header — only the essentials. The schema (steps/cols)
                 * and per-entity fetch-ms breakdown were removed: pure debug
                 * trivia that widened the bar enough to wrap the runId once a
                 * predicate chip appeared. `whitespace-nowrap` keeps it on one
                 * line; `Num` slots keep counters width-stable as they tick.
                 */}
                <header className="px-3 py-2 flex items-center gap-3 text-xs border-b border-zinc-200 bg-white whitespace-nowrap">
                    <strong>ETL PoC scenarios</strong>
                    <Tag color={hydration.isHydrating ? "processing" : "default"}>
                        <Num value={hydration.hydratedScenarios} ch={4} /> hydrated
                    </Tag>
                    <Tag color={hydration.activeSlices.length < 4 ? "geekblue" : "default"}>
                        slices:{" "}
                        {hydration.activeSlices.length === 0
                            ? "none"
                            : hydration.activeSlices.join(", ")}
                    </Tag>
                    {/*
                     * Slice-fetch strategy toggle. Changing the mode resets
                     * `hydratedScenarioIdsRef` (in useHydrateScenarios) so the
                     * next render re-hydrates with the new slice set — flip
                     * to "All" to see the bytes/time cost of fetching every
                     * slice; back to "Auto" to see the predicate-driven
                     * savings. Live A/B without a page reload.
                     */}
                    <span className="inline-flex items-center gap-1">
                        <span className="text-zinc-500">hydrate:</span>
                        <Segmented<SliceFetchMode>
                            size="small"
                            value={sliceMode}
                            options={[
                                {label: "Auto", value: "auto"},
                                {label: "All slices", value: "all"},
                            ]}
                            onChange={(value) => setSliceMode(value)}
                        />
                    </span>
                    {hydration.lastError && (
                        <Tag color="error" title={hydration.lastError}>
                            hydrate error
                        </Tag>
                    )}
                    {predicate && (
                        <PredicateCountChip
                            predicate={predicate}
                            schema={schema}
                            projectId={projectId}
                            runId={runId}
                            filteredRows={filteredRows}
                            paginationRows={pagination.rows}
                            hydrationVersion={hydrationVersion}
                        />
                    )}
                    <span className="ml-auto text-zinc-500">
                        runId <code>{runId}</code>
                    </span>
                </header>

                <PredicateFilterBar schema={schema} predicate={predicate} onChange={setPredicate} />

                <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                    <InfiniteVirtualTable<ScenarioThinRow>
                        /*
                         * Remount the table whenever the predicate changes.
                         *
                         * Applying a predicate shrinks `filteredRows` sharply
                         * (e.g. 200 → 8), but the IVT's virtual render window
                         * is still sized to the old, larger array — its row
                         * renderer then indexes past the new end and hands
                         * `rowKey` an `undefined` record → crash. The
                         * scroll-to-top effect above can't prevent it: it runs
                         * in rAF, one tick after the crashing render.
                         *
                         * Keying on the predicate forces a fresh mount, which
                         * resets the virtual window to the current dataSource
                         * length. (The scroll-to-top effect is then a no-op on
                         * the freshly mounted table — harmless.)
                         */
                        key={`ivt-${runId}-${predicate ? JSON.stringify(predicate) : "all"}`}
                        columns={
                            ivtColumns as unknown as React.ComponentProps<
                                typeof InfiniteVirtualTable<ScenarioThinRow>
                            >["columns"]
                        }
                        /*
                         * While the viewport-fill loop is still scanning
                         * with zero matches, hand the table a stable empty
                         * array (not the per-page-flickering filteredRows)
                         * and show one steady loading overlay below. Once
                         * a match is found or the scan completes, switch
                         * back to the real filteredRows.
                         */
                        dataSource={scanningEmpty ? EMPTY_ROWS : filteredRows}
                        loadMore={pagination.loadNextPage}
                        /*
                         * Defensive rowKey: antd's virtual table can hand
                         * this an out-of-range `undefined` record for a
                         * frame while `filteredRows` is shrinking after a
                         * predicate change. `r.key` on `undefined` crashes
                         * the page — fall back to an index-based key so the
                         * phantom row renders harmlessly until antd
                         * re-syncs. Paired with the `guardCol` wrapper on
                         * `ivtColumns` above.
                         */
                        rowKey={(r, i) => r?.key ?? `__phantom_${i ?? 0}`}
                        scopeId={`etl-poc-${runId}`}
                        /*
                         * containerClassName matters: the bare InfiniteVirtualTable
                         * doesn't bound its own scroll container by default — the
                         * container grows to content height, which feeds back into
                         * `useContainerResize` and disables virtualization (rendering
                         * all rows at full height). FeatureShell sets the same
                         * class internally; we mirror it here.
                         */
                        containerClassName="w-full grow min-h-0 overflow-hidden"
                        /*
                         * Fixed row-height config. Without it, rows size to
                         * content — empty/skeleton rows collapse short, then
                         * jump tall when JSON data arrives. The config gives
                         * every row a fixed height (small/medium/large) and
                         * publishes `heightPx`/`maxLines` via RowHeightContext;
                         * EtlResolvedCell reads that and clamps its content to
                         * fit, so empty and populated rows are identical
                         * height. `useSettingsDropdown` surfaces the
                         * small/medium/large switcher in the table's gear menu.
                         */
                        rowHeightConfig={{
                            storageKey: "agenta:etl-poc:row-height",
                            defaultSize: "small",
                        }}
                        useSettingsDropdown
                        tableProps={{
                            size: "small",
                            sticky: true,
                            bordered: true,
                            tableLayout: "fixed",
                            /*
                             * One stable loading overlay for the whole
                             * predicate scan — replaces the skeleton ↔
                             * "No Data" per-page flicker. `false` once the
                             * scan settles, so antd's real empty state
                             * ("No Data") shows cleanly.
                             */
                            loading: scanningEmpty
                                ? {spinning: true, tip: "Scanning all rows for matches…"}
                                : false,
                        }}
                        /*
                         * tableRef gives us a handle on antd's virtual
                         * Table for programmatic scroll. Used by the
                         * "reset to top on predicate change" effect above.
                         */
                        tableRef={tableRef}
                        /*
                         * NOTE: do NOT pass `useIsolatedStore` — the cells need to
                         * read `hydrationVersionAtom` written by the hook above,
                         * which lives in the parent Jotai store. An isolated store
                         * would silently desync the bump signal from the cells.
                         */
                    />
                </div>
            </section>
        </CellMaterializerContext.Provider>
    )
}

/**
 * Header chip — distinguishes "confirmed" (predicate slices loaded +
 * evaluator returned true) from "pending" (slices not loaded yet,
 * matchesPredicate's keep-visible fallback). Avoids the chip oscillating
 * between an inflated "matched" count (during predicate evaluation) and
 * the final lower count once slices land.
 *
 * Recomputed on each hydrationVersion bump.
 */
const PredicateCountChip = ({
    predicate,
    schema,
    projectId,
    runId,
    filteredRows,
    paginationRows,
    // hydrationVersion is read from the parent so React knows to re-render
    // this chip when the molecule cache bumps. Not used in the JSX directly
    // — the useMemo below depends on filteredRows / paginationRows /
    // predicate / schema, which all change as the cache populates.
    hydrationVersion: _hydrationVersion,
}: {
    predicate: RowPredicate
    schema: RunSchema | null
    projectId: string | null
    runId: string | null
    filteredRows: ScenarioThinRow[]
    paginationRows: ScenarioThinRow[]
    hydrationVersion: number
}) => {
    const counts = useMemo(() => {
        let confirmed = 0
        let pending = 0
        if (!schema || !projectId || !runId) {
            return {confirmed: 0, pending: 0, totalLoaded: 0}
        }
        for (const r of filteredRows) {
            if (r.__isSkeleton || !r.scenarioId) continue
            const cols = resolveOneScenarioFromCache(projectId, runId, r.scenarioId, schema)
            if (!cols) {
                pending += 1
                continue
            }
            // Re-eval (cheap — cols already in memory) to know if this row
            // ACTUALLY matches vs is keep-visible-until-known.
            if (matchesPredicate(predicate, schema, projectId, runId, r.scenarioId)) {
                confirmed += 1
            }
        }
        const totalLoaded = paginationRows.filter((r) => !r.__isSkeleton).length
        return {confirmed, pending, totalLoaded}
    }, [filteredRows, paginationRows, predicate, schema, projectId, runId])

    // "<matched> matched · <scanned> scanned".
    //
    // The second number is rows *scanned so far* — it grows as the
    // viewport-fill loop walks pages. The word "scanned" is what makes
    // that clear: it is progress, not a dataset total. No denominator —
    // the paginated store doesn't expose a reliable dataset size, and a
    // wrong total is worse than none. When the scan finishes, this number
    // settles at the true total (every row has been scanned).
    return (
        <Tag color="purple">
            <Num value={counts.confirmed} ch={4} /> matched
            <span className="opacity-60">
                {" · "}
                <Num value={counts.totalLoaded} ch={4} /> scanned
            </span>
        </Tag>
    )
}

/**
 * Run a single-predicate filter against the molecule cache for one scenario.
 * Mirrors makeRowPredicateFilter's per-row logic without bringing the whole
 * transform infrastructure into a React render.
 */
function matchesPredicate(
    predicate: RowPredicate,
    schema: RunSchema,
    projectId: string | null,
    runId: string | null,
    scenarioId: string,
): boolean {
    if (!projectId || !runId) return true
    // Resolve all columns for this scenario from cache.
    const cols = resolveOneScenarioFromCache(projectId, runId, scenarioId, schema)
    if (!cols) return true // not hydrated yet — keep visible until hydrate completes
    const target = cols.find((c) => {
        if (c.name !== predicate.columnName) return false
        if (c.group.kind !== predicate.groupKind) return false
        if (predicate.groupSlug != null && c.group.slug !== predicate.groupSlug) return false
        return true
    })
    if (!target) return false
    const actual = unwrapStatsForCompare(target.value)
    switch (predicate.op) {
        case "eq":
            return actual === predicate.value
        case "ne":
            return actual !== predicate.value
        case "lt":
            return (
                typeof actual === "number" &&
                typeof predicate.value === "number" &&
                actual < predicate.value
            )
        case "lte":
            return (
                typeof actual === "number" &&
                typeof predicate.value === "number" &&
                actual <= predicate.value
            )
        case "gt":
            return (
                typeof actual === "number" &&
                typeof predicate.value === "number" &&
                actual > predicate.value
            )
        case "gte":
            return (
                typeof actual === "number" &&
                typeof predicate.value === "number" &&
                actual >= predicate.value
            )
        case "in":
            return Array.isArray(predicate.value) && predicate.value.includes(actual)
        case "nin":
            return Array.isArray(predicate.value) && !predicate.value.includes(actual)
        default:
            return false
    }
}

// Per-cell rendering already pulls from caches via EtlResolvedCell. For the
// row-level predicate check we need the same data plus the run schema —
// reuse the cell's resolution via a direct call.
function resolveOneScenarioFromCache(
    projectId: string,
    runId: string,
    scenarioId: string,
    schema: RunSchema,
) {
    const results = (evaluationResultMolecule.get.byScenario({projectId, runId, scenarioId}) ??
        []) as EvaluationResult[]
    const metrics = (evaluationMetricMolecule.get.byScenario({projectId, runId, scenarioId}) ??
        []) as EvaluationMetric[]
    if (results.length === 0 && metrics.length === 0) return null
    const hydrated = {
        scenario: {id: scenarioId, status: "success"} as {
            id: string
            status: string
            testcase_id?: string | null
        },
        results,
        metrics,
        testcase: null,
        traces: {},
    }
    return resolveMappings(hydrated, {steps: schema.steps, mappings: schema.mappings})
}

export default EtlPocScenariosTable
