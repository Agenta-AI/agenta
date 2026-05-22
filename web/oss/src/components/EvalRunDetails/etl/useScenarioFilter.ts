/**
 * useScenarioFilter — applies the active multi-predicate filter (D8) to
 * the scenario rows.
 *
 * A row is kept when its resolved columns satisfy the filter. Rows whose
 * slices are not hydrated yet are kept visible ("keep-visible-until-known")
 * so a real match is never hidden while it loads; the viewport-fill loop
 * and the confirmed-match count gate on *confirmed* matches only.
 *
 * Because a strict filter can reduce the visible row count below the
 * viewport height, the IVT's scroll-triggered `loadMore` may never fire.
 * While a filter is active this hook drives `loadNextPage` itself until
 * enough confirmed matches accumulate or the dataset is exhausted.
 */

import {useEffect, useMemo} from "react"

import {evaluationResultMolecule, evaluationMetricMolecule} from "@agenta/entities/evaluationRun"
import {
    evaluateRowFilter,
    resolveMappings,
    type HydratedScenarioRow,
    type PredicateGroup,
    type ResolvedColumn,
    type RunSchema,
} from "@agenta/entities/evaluationRun/etl"
import {useQueryClient, type QueryClient} from "@tanstack/react-query"
import {useAtomValue} from "jotai"

import {
    scenarioFilterAtomFamily,
    isScenarioFilterActive,
    toEffectiveFilter,
} from "./scenarioFilterState"
import {hydrationVersionAtom} from "./useHydrateScenarios"

/** Enough confirmed matches to fill a typical viewport before the loop stops. */
const VIEWPORT_FILL_TARGET = 30

interface FilterableRow {
    scenarioId?: unknown
    __isSkeleton?: unknown
}

/**
 * Build a row's resolved columns from the molecule caches. Returns `null`
 * when nothing is hydrated yet for the scenario (results + metrics both
 * empty) — the caller treats that as "not known yet".
 */
function resolveScenarioColumnsFromCache(
    queryClient: QueryClient,
    projectId: string,
    runId: string,
    scenarioId: string,
    schema: RunSchema,
): ResolvedColumn[] | null {
    const results = (evaluationResultMolecule.get.byScenario({projectId, runId, scenarioId}) ??
        []) as HydratedScenarioRow["results"]
    const metrics = (evaluationMetricMolecule.get.byScenario({projectId, runId, scenarioId}) ??
        []) as HydratedScenarioRow["metrics"]
    if (results.length === 0 && metrics.length === 0) return null

    const testcaseId =
        results.find((r) => typeof r.testcase_id === "string" && r.testcase_id)?.testcase_id ?? null
    const testcase = testcaseId
        ? (queryClient.getQueryData<HydratedScenarioRow["testcase"]>([
              "testcase",
              projectId,
              testcaseId,
          ]) ?? null)
        : null

    const traces: Record<string, unknown> = {}
    for (const r of results) {
        if (typeof r.trace_id === "string" && r.trace_id) {
            const cached = queryClient.getQueryData<unknown>([
                "trace-entity",
                projectId,
                r.trace_id,
            ])
            if (cached != null) traces[r.trace_id] = cached
        }
    }

    return resolveMappings(
        {
            scenario: {id: scenarioId, status: "success"},
            results,
            metrics,
            testcase,
            traces,
        },
        {steps: schema.steps, mappings: schema.mappings},
    )
}

export interface UseScenarioFilterArgs<TRow extends FilterableRow> {
    projectId: string | null
    runId: string | null
    schema: RunSchema | null
    /** The base (main-run) rows, pre-merge. */
    baseRows: readonly TRow[]
    loadNextPage: () => void
    hasMore: boolean
    isFetching: boolean
}

export interface UseScenarioFilterResult<TRow extends FilterableRow> {
    /** Raw filter (may contain half-built conditions) — for the filter bar. */
    rawFilter: PredicateGroup
    /** Filter actually evaluated — half-built conditions dropped. */
    effectiveFilter: PredicateGroup
    /** True when at least one complete condition is set. */
    active: boolean
    /** Base rows after the filter — unfiltered when no filter is active. */
    filteredBaseRows: TRow[]
    /** Rows confirmed (hydrated AND matching) to satisfy the filter. */
    confirmedMatchCount: number
}

export function useScenarioFilter<TRow extends FilterableRow>({
    projectId,
    runId,
    schema,
    baseRows,
    loadNextPage,
    hasMore,
    isFetching,
}: UseScenarioFilterArgs<TRow>): UseScenarioFilterResult<TRow> {
    const queryClient = useQueryClient()
    const rawFilter = useAtomValue(scenarioFilterAtomFamily(runId ?? "__none__"))
    // Re-evaluate when the molecule caches change.
    const hydrationVersion = useAtomValue(hydrationVersionAtom)

    const effectiveFilter = useMemo(() => toEffectiveFilter(rawFilter), [rawFilter])
    const active = isScenarioFilterActive(rawFilter)

    const filteredBaseRows = useMemo(() => {
        if (!active || !schema || !projectId || !runId) return baseRows as TRow[]
        return (baseRows as TRow[]).filter((r) => {
            const scenarioId = typeof r.scenarioId === "string" ? r.scenarioId : null
            // Skeleton / not-yet-keyed rows pass — they can't be evaluated.
            if (r.__isSkeleton || !scenarioId) return true
            const cols = resolveScenarioColumnsFromCache(
                queryClient,
                projectId,
                runId,
                scenarioId,
                schema,
            )
            // Not hydrated yet — keep visible until known.
            if (!cols) return true
            return evaluateRowFilter(effectiveFilter, cols)
        })
    }, [baseRows, active, schema, projectId, runId, effectiveFilter, hydrationVersion, queryClient])

    // Count of CONFIRMED matches — hydrated AND actually satisfying the
    // filter. Excludes "keep-visible-until-known" rows, so it does not
    // oscillate as pages hydrate.
    const confirmedMatchCount = useMemo(() => {
        if (!active || !schema || !projectId || !runId) return 0
        let n = 0
        for (const r of baseRows as TRow[]) {
            const scenarioId = typeof r.scenarioId === "string" ? r.scenarioId : null
            if (r.__isSkeleton || !scenarioId) continue
            const cols = resolveScenarioColumnsFromCache(
                queryClient,
                projectId,
                runId,
                scenarioId,
                schema,
            )
            if (!cols) continue
            if (evaluateRowFilter(effectiveFilter, cols)) n += 1
        }
        return n
    }, [baseRows, active, schema, projectId, runId, effectiveFilter, hydrationVersion, queryClient])

    // Viewport-fill loop — a strict filter may keep the visible row count
    // below the viewport, so IVT's scroll-triggered loadMore never fires.
    // Drive it ourselves until enough confirmed matches accumulate or the
    // dataset is exhausted.
    useEffect(() => {
        if (!active) return
        if (!hasMore || isFetching) return
        if (confirmedMatchCount >= VIEWPORT_FILL_TARGET) return
        loadNextPage()
    }, [active, hasMore, isFetching, confirmedMatchCount, loadNextPage])

    return {
        rawFilter,
        effectiveFilter,
        active,
        filteredBaseRows,
        confirmedMatchCount,
    }
}
