/**
 * EtlResolvedCell — a single cell that resolves its value from molecule caches.
 *
 * Each cell:
 *   1. Subscribes to TanStack cache entries for its scenario via `useQuery`
 *      with `enabled: false` — no network triggered from a cell render.
 *      The hydrate / materializer paths populate those entries.
 *   2. Assembles a HydratedScenarioRow from the four entity slices
 *      (results / metrics / testcase / traces).
 *   3. Runs `resolveMappings` against the hydrated row + run schema and
 *      picks out *just this cell's* column value.
 *
 * Non-terminal rendering — the load-bearing difference from the PoC. The
 * PoC fabricated `scenario.status = "success"` because it only ran
 * against finished runs. Production scenarios can be pending / running /
 * failed / partial, so the cell renders four distinct states:
 *
 *   value    — resolved, render it.
 *   running  — scenario not terminal: an in-progress indicator. NEVER a
 *              bare "—" (the user must tell "still computing" apart from
 *              "computed nothing").
 *   loading  — scenario terminal but this cell's slices not hydrated yet.
 *   missing  — scenario terminal, slices hydrated, genuinely no value: "—".
 */

import {useContext, useEffect, useMemo} from "react"

import {evaluationResultMolecule, evaluationMetricMolecule} from "@agenta/entities/evaluationRun"
import {
    resolveMappings,
    unwrapStatsForCompare,
    type RunSchema,
    type ResolvedColumn,
    type ColumnGroup,
    type HydratedScenarioRow,
    type HydratableScenario,
} from "@agenta/entities/evaluationRun/etl"
import {useQuery, useQueryClient} from "@tanstack/react-query"
import {Tag} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import {isTerminalStatus} from "../../atoms/compare"
import {scenarioRowHeightAtom, type ScenarioRowHeight} from "../../state/rowHeight"
import {CellMaterializerContext} from "../cellMaterializerContext"
import {hydrationVersionAtom} from "../useHydrateScenarios"

type ColumnKind = ColumnGroup["kind"]

// Tuned to match the actual visible line count inside `.scenario-table-cell`
// at each row-height variant. With `font-size: 13px` and `line-height: 1.6`
// (~20.8px per line) — defined in `evaluations.css` — the available
// content height after padding fits roughly:
//   small  (80px row, 8px padding):  (80 - 16) / 20.8 ≈ 3 lines
//   medium (160px row, 12px padding): (160 - 24) / 20.8 ≈ 6 lines
//   large  (280px row, 12px padding): (280 - 24) / 20.8 ≈ 12 lines
// `-webkit-line-clamp` places its ellipsis at line N — if N exceeds the
// visible lines, the parent's `overflow: hidden` cuts the text mid-line and
// the ellipsis is never seen. Matching N to the visible count puts the
// ellipsis on the last fully-rendered line.
const MAX_LINES_BY_HEIGHT: Record<ScenarioRowHeight, number> = {
    small: 3,
    medium: 6,
    large: 12,
}

/** Entity slices each column kind reads from. */
const SLICES_BY_KIND: Record<ColumnKind, ("results" | "metrics" | "testcases" | "traces")[]> = {
    testset: ["results", "testcases"],
    application: ["results", "traces"],
    // Evaluator outputs come from metrics first, but string-typed outputs
    // (e.g. an LLM-judge's `reasoning` field) only land in the metric layer
    // as a `{type: "string", count: N}` placeholder — the real value is on
    // the annotation trace. Hydrate traces too so `resolveFromTrace` can
    // find it when `resolveFromMetric` falls through.
    evaluator: ["results", "metrics", "traces"],
    metrics: ["metrics"],
    other: ["results"],
}

export interface EtlResolvedCellProps {
    projectId: string
    runId: string
    scenarioId: string
    /** Real scenario status — drives the running / loading / missing split. */
    scenarioStatus: string
    /** Column the cell should render — group kind + slug + column name. */
    columnKind: ColumnKind
    columnGroupSlug: string | null
    columnName: string
    /** Run schema (steps + mappings). */
    schema: RunSchema | null
}

const EtlResolvedCell = ({
    projectId,
    runId,
    scenarioId,
    scenarioStatus,
    columnKind,
    columnGroupSlug,
    columnName,
    schema,
}: EtlResolvedCellProps) => {
    const queryClient = useQueryClient()
    const materializer = useContext(CellMaterializerContext)
    // Bumped after each hydrate / materialize batch so cells re-render and
    // pick up late-arriving testcase / trace cache writes.
    const hydrationVersion = useAtomValue(hydrationVersionAtom)
    const rowHeight = useAtomValue(scenarioRowHeightAtom)
    const maxLines = MAX_LINES_BY_HEIGHT[rowHeight]

    // Pure subscriptions — `enabled: false` + no-op queryFn means a cell
    // render never triggers network. The hydrate / materializer paths are
    // the only writers; cells just observe.
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

    const resultsFetched = resultsQ.data !== undefined
    const metricsFetched = metricsQ.data !== undefined

    // Resolve this cell's column from the molecule caches.
    const resolved = useMemo<ResolvedColumn | null>(() => {
        if (!schema) return null

        const results = (resultsQ.data ??
            evaluationResultMolecule.get.byScenario({projectId, runId, scenarioId}) ??
            []) as HydratedScenarioRow["results"]
        const metrics = (metricsQ.data ??
            evaluationMetricMolecule.get.byScenario({projectId, runId, scenarioId}) ??
            []) as HydratedScenarioRow["metrics"]

        const testcaseIdCandidates = results
            .map((r) => r.testcase_id)
            .filter((v): v is string => typeof v === "string" && v.length > 0)
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
                const cached = queryClient.getQueryData<unknown>([
                    "trace-entity",
                    projectId,
                    r.trace_id,
                ])
                if (cached != null) traces[r.trace_id] = cached
            }
        }

        const hydrated: HydratedScenarioRow<HydratableScenario> = {
            scenario: {id: scenarioId, status: scenarioStatus} as HydratableScenario,
            results,
            metrics,
            testcase,
            traces,
        }

        const cols = resolveMappings(hydrated, {
            steps: schema.steps,
            mappings: schema.mappings,
        })

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
        scenarioStatus,
        columnKind,
        columnGroupSlug,
        columnName,
        schema,
        resultsQ.data,
        metricsQ.data,
        hydrationVersion,
        queryClient,
    ])

    // Cell-side lazy materialization. Ask the page-level materializer to
    // fill cache slices this cell needs; the materializer coalesces
    // concurrent same-tick requests into one bulk fetch per (slice, run).
    useEffect(() => {
        if (!materializer || !projectId || !runId || !scenarioId) return
        for (const slice of SLICES_BY_KIND[columnKind]) {
            if (slice === "results") {
                if (!evaluationResultMolecule.get.byScenario({projectId, runId, scenarioId})) {
                    materializer.request("results", {scenarioId, runId})
                }
            } else if (slice === "metrics") {
                if (!evaluationMetricMolecule.get.byScenario({projectId, runId, scenarioId})) {
                    materializer.request("metrics", {scenarioId, runId})
                }
            } else if (slice === "testcases") {
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
                // A scenario can carry multiple traces — typically one per
                // result (invocation, annotation, …). Materialize every
                // trace_id so evaluator cells can find the annotation trace
                // alongside the application's invocation trace.
                const cachedResults = evaluationResultMolecule.get.byScenario({
                    projectId,
                    runId,
                    scenarioId,
                })
                const traceIds = (cachedResults ?? [])
                    .map((r) => r.trace_id)
                    .filter((id): id is string => typeof id === "string" && id.length > 0)
                for (const traceId of traceIds) {
                    const cached = queryClient.getQueryData(["trace-entity", projectId, traceId])
                    if (cached == null) materializer.request("traces", {traceId})
                }
            }
        }
    }, [materializer, projectId, runId, scenarioId, columnKind, hydrationVersion, queryClient])

    const hasValue = !!resolved && resolved.source !== "missing"

    // Is a slice this cell needs still in flight? Distinguishes
    // "slice-not-hydrated" (skeleton) from "genuinely missing" ("—") for
    // a terminal scenario. A slice that the materializer marked failed is
    // NOT counted as loading — otherwise a permanently rate-limited fetch
    // would leave the cell on an infinite skeleton.
    const sliceStillLoading = useMemo(() => {
        for (const slice of SLICES_BY_KIND[columnKind]) {
            if (slice === "results") {
                if (!resultsFetched && !materializer?.hasFailed("results", {scenarioId, runId})) {
                    return true
                }
            } else if (slice === "metrics") {
                if (!metricsFetched && !materializer?.hasFailed("metrics", {scenarioId, runId})) {
                    return true
                }
            } else if (slice === "testcases") {
                // Needs results first — covered by the results check above.
                if (!resultsFetched) continue
                const cachedResults = evaluationResultMolecule.get.byScenario({
                    projectId,
                    runId,
                    scenarioId,
                })
                const testcaseId =
                    cachedResults?.find((r) => typeof r.testcase_id === "string" && r.testcase_id)
                        ?.testcase_id ?? null
                if (!testcaseId) continue
                const cached = queryClient.getQueryData(["testcase", projectId, testcaseId])
                if (cached === undefined && !materializer?.hasFailed("testcases", {testcaseId})) {
                    return true
                }
            } else if (slice === "traces") {
                if (!resultsFetched) continue
                const cachedResults = evaluationResultMolecule.get.byScenario({
                    projectId,
                    runId,
                    scenarioId,
                })
                // Check every result's trace_id (not just the first) — a
                // scenario can carry multiple traces and an evaluator cell
                // needs the annotation trace, which isn't always result[0].
                const traceIds = (cachedResults ?? [])
                    .map((r) => r.trace_id)
                    .filter((id): id is string => typeof id === "string" && id.length > 0)
                for (const traceId of traceIds) {
                    const cached = queryClient.getQueryData(["trace-entity", projectId, traceId])
                    if (cached === undefined && !materializer?.hasFailed("traces", {traceId})) {
                        return true
                    }
                }
            }
        }
        return false
    }, [
        columnKind,
        projectId,
        runId,
        scenarioId,
        resultsFetched,
        metricsFetched,
        materializer,
        queryClient,
        hydrationVersion,
    ])

    const isTerminal = isTerminalStatus(scenarioStatus)

    let content: React.ReactNode
    if (hasValue) {
        content = (
            <div
                className="scenario-table-text w-full"
                style={{
                    display: "-webkit-box",
                    WebkitBoxOrient: "vertical",
                    WebkitLineClamp: maxLines,
                    overflow: "hidden",
                    wordBreak: "break-word",
                }}
            >
                {formatValue(unwrapStatsForCompare(resolved!.value))}
            </div>
        )
    } else if (!isTerminal) {
        // Scenario not finished — in-progress, NOT a missing value.
        content = <RunningIndicator status={scenarioStatus} />
    } else if (sliceStillLoading) {
        // Terminal scenario, this cell's slices not hydrated yet.
        content = <div className="h-3 w-2/3 rounded bg-neutral-200 animate-pulse" />
    } else {
        // Terminal, hydrated, genuinely no value.
        content = <span className="scenario-table-text scenario-table-placeholder">—</span>
    }

    return <div className="scenario-table-cell">{content}</div>
}

/**
 * In-progress indicator for a non-terminal scenario's cell. A colored,
 * pulsing dot + label — deliberately distinct from both the grey skeleton
 * bar (data loading) and the "—" placeholder (no value).
 */
const RunningIndicator = ({status}: {status: string}) => {
    const s = status.toLowerCase()
    const dotClass = s === "running" ? "bg-blue-500" : "bg-amber-400"
    const label = s === "running" ? "Running" : s === "queued" ? "Queued" : "Pending"
    return (
        <span className="inline-flex items-center gap-1.5 text-xs text-neutral-400">
            <span className={clsx("h-1.5 w-1.5 rounded-full animate-pulse", dotClass)} />
            {label}
        </span>
    )
}

/**
 * Fixed-height placeholder for skeleton (not-yet-keyed) rows. Occupies
 * the same `scenario-table-cell` box as a populated cell so the table
 * doesn't jump when a skeleton row resolves to real data.
 */
export const EtlSkeletonCell = () => (
    <div className="scenario-table-cell">
        <div className="h-3 w-2/3 rounded bg-neutral-200 animate-pulse" />
    </div>
)

function formatValue(v: unknown): React.ReactNode {
    if (v === null || v === undefined) {
        return <span className="scenario-table-text scenario-table-placeholder">—</span>
    }
    if (typeof v === "boolean") {
        return <Tag color={v ? "green" : "red"}>{String(v)}</Tag>
    }
    if (typeof v === "number") {
        return Number.isInteger(v) ? String(v) : v.toFixed(3)
    }
    // Cap at 800 chars as a DOM-size guard; the cell's CSS line-clamp does
    // the visible truncation.
    if (typeof v === "string") {
        return v.length > 800 ? v.slice(0, 800) : v
    }
    try {
        const json = JSON.stringify(v)
        return json.length > 800 ? json.slice(0, 800) : json
    } catch {
        return String(v)
    }
}

export default EtlResolvedCell
