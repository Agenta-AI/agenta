/**
 * EtlResolvedCell — a single cell that resolves its value from molecule caches.
 *
 * Each cell:
 *   1. Subscribes to TanStack cache entries for its scenario via `useQuery`
 *      with `enabled: false` — no network triggered from a cell render.
 *      The hydrate hook populates those entries via `setQueryData`.
 *   2. Once all four entity slices are present (results / metrics /
 *      testcase / traces), assembles a HydratedScenarioRow.
 *   3. Runs `resolveMappings` against the hydrated row + run schema and
 *      picks out *just this cell's* column value.
 *   4. Applies the same `unwrapStatsForCompare`-style projection the
 *      headless PoC uses for binary / numeric stats blobs.
 *
 * Re-renders only when one of the four cache keys it subscribes to
 * changes. Per-cell subscription = no whole-table re-renders on hydrate.
 */

import {useContext, useEffect, useMemo} from "react"

import {evaluationResultMolecule, evaluationMetricMolecule} from "@agenta/entities/evaluationRun"
import {
    resolveMappings,
    unwrapStatsForCompare,
    type RunSchema,
    type ResolvedColumn,
    type HydratedScenarioRow,
    type HydratableScenario,
} from "@agenta/entities/evaluationRun/etl"
import {useQuery, useQueryClient} from "@tanstack/react-query"
import {Tag, Typography} from "antd"
import {useAtomValue} from "jotai"

import {CellMaterializerContext} from "../cellMaterializerContext"
import {hydrationVersionAtom} from "../useHydrateScenarios"

const {Text} = Typography

export interface EtlResolvedCellProps {
    projectId: string
    runId: string
    scenarioId: string
    /** Column the cell should render — group kind + slug + column name. */
    columnKind: "testset" | "application" | "evaluator" | "metrics"
    columnGroupSlug: string | null
    columnName: string
    /** Run schema (steps + mappings) — passed in for stable identity. */
    schema: RunSchema | null
}

const EtlResolvedCell = ({
    projectId,
    runId,
    scenarioId,
    columnKind,
    columnGroupSlug,
    columnName,
    schema,
}: EtlResolvedCellProps) => {
    const queryClient = useQueryClient()
    const materializer = useContext(CellMaterializerContext)
    // Bumped by useHydrateScenarios after each fully-completed batch.
    // Subscribing here causes every mounted cell to re-render once stage 2
    // (testcases + traces) finishes, so cells whose useMemo deps
    // (results / metrics) had already settled in stage 1 pick up the
    // late-arriving testcase / trace cache writes.
    const hydrationVersion = useAtomValue(hydrationVersionAtom)

    // Subscribe to each cache slice the resolver needs. `enabled: false` +
    // a no-op queryFn keeps these as pure subscriptions — they will not
    // trigger network from a cell render. The hydrate hook is the only
    // writer; cells just observe.
    const resultsQ = useQuery<unknown>({
        queryKey: ["evaluation-results", projectId, runId, scenarioId],
        queryFn: () => null,
        enabled: false,
        staleTime: Infinity,
    })
    const metricsQ = useQuery<unknown>({
        queryKey: ["evaluation-metrics", projectId, runId, scenarioId],
        queryFn: () => null,
        enabled: false,
        staleTime: Infinity,
    })

    // Build the hydrated row from molecule caches. Memoize on the four
    // pieces so we don't re-resolve when an unrelated cache key changes.
    const resolved = useMemo<ResolvedColumn | null>(() => {
        if (!schema) return null

        const results = (resultsQ.data ??
            evaluationResultMolecule.get.byScenario({projectId, runId, scenarioId}) ??
            []) as HydratedScenarioRow["results"]
        const metrics = (metricsQ.data ??
            evaluationMetricMolecule.get.byScenario({projectId, runId, scenarioId}) ??
            []) as HydratedScenarioRow["metrics"]

        // Derive testcase + traces from cache too.
        const testcaseIdCandidates = [...results.map((r) => r.testcase_id)].filter(
            (v): v is string => typeof v === "string" && v.length > 0,
        )
        const testcaseId = testcaseIdCandidates[0] ?? null
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
                // Pass the envelope through as-is. `findInTrace` handles the
                // `{count, traces: {...}}` shape (case 3) — same code path
                // every other trace consumer uses.
                const cached = queryClient.getQueryData<unknown>([
                    "trace-entity",
                    projectId,
                    r.trace_id,
                ])
                if (cached != null) traces[r.trace_id] = cached
            }
        }

        const hydrated: HydratedScenarioRow<HydratableScenario> = {
            scenario: {id: scenarioId, status: "success"} as HydratableScenario,
            results,
            metrics,
            testcase,
            traces,
        }

        const cols = resolveMappings(hydrated, {
            steps: schema.steps,
            mappings: schema.mappings,
        })

        // Pick the one column this cell renders. Match by name + kind +
        // optional slug.
        return (
            cols.find((c) => {
                if (c.name !== columnName) return false
                if (c.group.kind !== columnKind) return false
                if (columnGroupSlug != null && c.group.slug !== columnGroupSlug) return false
                return true
            }) ?? null
        )
    }, [
        projectId,
        runId,
        scenarioId,
        columnKind,
        columnGroupSlug,
        columnName,
        schema,
        resultsQ.data,
        metricsQ.data,
        // hydrationVersion bumps after stage-2 cache writes (testcases +
        // traces) so the memo re-evaluates and picks them up.
        hydrationVersion,
        queryClient,
    ])

    // Cell-side lazy materialization. If the active predicate's slice set
    // skipped what this cell needs (e.g. predicate is on evaluator but
    // this cell renders testcase/country), ask the page-level materializer
    // to fill the cache. The materializer coalesces concurrent same-tick
    // requests into one bulk fetch per slice — so 30 visible cells asking
    // for testcase become 1 bulk testcase fetch, not 30.
    useEffect(() => {
        if (!materializer || !projectId || !runId || !scenarioId) return
        // Map this cell's columnKind → entity slices it reads from.
        // Mirrors `predicateToEntitySlices`'s convention.
        const needs: ("results" | "metrics" | "testcases" | "traces")[] = []
        if (columnKind === "testset") needs.push("results", "testcases")
        else if (columnKind === "application") needs.push("results", "traces")
        else if (columnKind === "evaluator") needs.push("results", "metrics")
        else if (columnKind === "metrics") needs.push("metrics")

        for (const slice of needs) {
            if (slice === "results") {
                if (!evaluationResultMolecule.get.byScenario({projectId, runId, scenarioId})) {
                    materializer.request("results", {scenarioId})
                }
            } else if (slice === "metrics") {
                if (!evaluationMetricMolecule.get.byScenario({projectId, runId, scenarioId})) {
                    materializer.request("metrics", {scenarioId})
                }
            } else if (slice === "testcases") {
                // Need a testcase_id — read it from cached results.
                const cachedResults = evaluationResultMolecule.get.byScenario({
                    projectId,
                    runId,
                    scenarioId,
                })
                const testcaseId =
                    cachedResults?.find((r) => typeof r.testcase_id === "string" && r.testcase_id)
                        ?.testcase_id ?? null
                if (testcaseId) {
                    const cached = queryClient.getQueryData(["testcase", projectId, testcaseId])
                    if (cached == null) materializer.request("testcases", {testcaseId})
                }
            } else if (slice === "traces") {
                const cachedResults = evaluationResultMolecule.get.byScenario({
                    projectId,
                    runId,
                    scenarioId,
                })
                const traceId =
                    cachedResults?.find((r) => typeof r.trace_id === "string" && r.trace_id)
                        ?.trace_id ?? null
                if (traceId) {
                    const cached = queryClient.getQueryData(["trace-entity", projectId, traceId])
                    if (cached == null) materializer.request("traces", {traceId})
                }
            }
        }
    }, [
        materializer,
        projectId,
        runId,
        scenarioId,
        columnKind,
        // Re-run after each hydrate batch lands — newly-populated results
        // unlock testcase / trace ID derivation that wasn't possible before.
        hydrationVersion,
        queryClient,
    ])

    if (!resolved) {
        return <Text type="secondary">—</Text>
    }
    if (resolved.source === "missing") {
        return <Text type="secondary">—</Text>
    }

    // Apply same stats-blob unwrap the predicate filter uses for display.
    const display = formatValue(unwrapStatsForCompare(resolved.value))
    return <span>{display}</span>
}

function formatValue(v: unknown): React.ReactNode {
    if (v === null || v === undefined) return <Text type="secondary">—</Text>
    if (typeof v === "boolean") {
        return <Tag color={v ? "green" : "red"}>{String(v)}</Tag>
    }
    if (typeof v === "number") {
        return Number.isInteger(v) ? String(v) : v.toFixed(3)
    }
    if (typeof v === "string") {
        return v.length > 120 ? `${v.slice(0, 117)}…` : v
    }
    try {
        const json = JSON.stringify(v)
        return json.length > 120 ? `${json.slice(0, 117)}…` : json
    } catch {
        return String(v)
    }
}

export default EtlResolvedCell
