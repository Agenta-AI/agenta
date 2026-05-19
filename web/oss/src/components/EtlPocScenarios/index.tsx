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
        const matched = filteredRows.filter((r) => !r.__isSkeleton).length
        if (matched >= VIEWPORT_FILL_TARGET) return
        pagination.loadNextPage()
    }, [
        predicate,
        filteredRows,
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
        return [indexCol, ...columns]
    }, [columns, pagination.rows])

    return (
        <CellMaterializerContext.Provider value={materializer}>
            <section className="w-full h-full overflow-hidden flex flex-col">
                <header className="px-3 py-2 flex items-center gap-3 text-xs border-b border-zinc-200 bg-white">
                    <strong>ETL PoC scenarios</strong>
                    <Tag color={schema ? "blue" : "default"}>
                        {schema
                            ? `${schema.steps.length} steps · ${schema.mappings.length} cols`
                            : "schema loading…"}
                    </Tag>
                    <Tag color={hydration.isHydrating ? "processing" : "default"}>
                        hydrated {hydration.hydratedScenarios} scenarios / {hydration.pagesHydrated}{" "}
                        pages
                    </Tag>
                    <Tag>
                        fetch ms — r:{hydration.fetchMsByEntity.results.toFixed(0)} · m:
                        {hydration.fetchMsByEntity.metrics.toFixed(0)} · t:
                        {hydration.fetchMsByEntity.testcases.toFixed(0)} · tr:
                        {hydration.fetchMsByEntity.traces.toFixed(0)}
                    </Tag>
                    <Tag color={hydration.activeSlices.length < 4 ? "geekblue" : "default"}>
                        slices:{" "}
                        {hydration.activeSlices.length === 0
                            ? "none (cell-side on-demand)"
                            : hydration.activeSlices.join(", ")}
                        {hydration.activeSlices.length > 0 && hydration.activeSlices.length < 4
                            ? " (predicate-driven)"
                            : ""}
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
                        columns={
                            ivtColumns as unknown as React.ComponentProps<
                                typeof InfiniteVirtualTable<ScenarioThinRow>
                            >["columns"]
                        }
                        dataSource={filteredRows}
                        loadMore={pagination.loadNextPage}
                        rowKey={(r) => r.key}
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
                        tableProps={{
                            size: "small",
                            sticky: true,
                            bordered: true,
                            tableLayout: "fixed",
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

    return (
        <Tag color="purple">
            {counts.confirmed} matched
            {counts.pending > 0 && <span className="opacity-60"> · {counts.pending} pending</span>}
            <span className="opacity-60"> / {counts.totalLoaded} loaded</span>
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
