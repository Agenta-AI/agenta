/**
 * Run-level metrics of a run: one query per run (batched across runs into one request), and a
 * catalog of the metrics the overview can chart.
 *
 * The query polls every 5 s while the run has not finished, and refreshes the run itself at the
 * same time so the poll stops once the run reaches a terminal status.
 *
 * @packageDocumentation
 */

import {getHostQueryClient} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {createBatchFetcher} from "@agenta/shared/utils"
import {atom} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {evaluationRunQueryKey} from "../api"
import {queryRunLevelMetrics} from "../api/runDetails"
import {
    isAggregatableMetric,
    isTerminalRunStatus,
    normalizeMetricStats,
    type EvaluationMetric,
    type EvaluationRun,
    type MetricStats,
} from "../core"

import {evaluationRunQueryAtomFamily} from "./molecule"

/** Same cadence as the old app's live refresh. */
export const RUN_METRICS_REFRESH_MS = 5_000

export const runLevelMetricsQueryKey = (projectId: string, runId: string) =>
    ["evaluation-run-metrics", projectId, runId] as const

/** Collects the runs asked for in one frame and sends one request for all of them. */
const runMetricsBatchFetcher = createBatchFetcher<
    {projectId: string; runId: string},
    EvaluationMetric[]
>({
    serializeKey: ({projectId, runId}) => `${projectId}:${runId}`,
    batchFn: async (keys, serializedKeys) => {
        const projectId = keys[0].projectId
        if (keys.some((key) => key.projectId !== projectId)) {
            throw new Error("runMetricsBatchFetcher: requests span multiple projects")
        }
        const metrics = await queryRunLevelMetrics({
            projectId,
            runIds: [...new Set(keys.map((key) => key.runId))],
        })
        const results = new Map<string, EvaluationMetric[]>()
        keys.forEach((key, index) =>
            results.set(
                serializedKeys[index],
                metrics.filter((metric) => metric.run_id === key.runId),
            ),
        )
        return results
    },
})

/** Poll while the run is loading or not finished; stop when it finished, failed or is gone. */
const shouldPoll = (run: {data?: EvaluationRun | null; isPending: boolean}) =>
    run.data ? !isTerminalRunStatus(run.data.status) : run.isPending

/**
 * The getter reads the project and the run reactively, so the query key, the request and the
 * poll interval follow a project switch and a run that finishes or resumes.
 */
export const runLevelMetricsQueryAtomFamily = atomFamily((runId: string) =>
    atomWithQuery((get) => {
        const projectId = get(projectIdAtom)
        const poll = shouldPoll(get(evaluationRunQueryAtomFamily(runId)))
        return {
            queryKey: runLevelMetricsQueryKey(projectId ?? "", runId),
            queryFn: async (): Promise<EvaluationMetric[]> => {
                if (!projectId) return []
                // Read the run before the request starts: a refresh of the run that lands while
                // the request is in flight must still count as the run finishing.
                const runKey = evaluationRunQueryKey(runId)
                const before = poll
                    ? getHostQueryClient().getQueryData<EvaluationRun | null>(runKey)
                    : undefined
                const metrics = await runMetricsBatchFetcher({projectId, runId})
                if (!poll) return metrics
                // Refresh the run too, so the poll sees it finish. When it finished since the last
                // look, the numbers above may be older than its last scenario: fetch them once
                // more. A run that was not loaded yet gets no second fetch.
                const client = getHostQueryClient()
                await client.invalidateQueries({queryKey: runKey})
                const after = client.getQueryData<EvaluationRun | null>(runKey)
                const justFinished =
                    Boolean(before) &&
                    !isTerminalRunStatus(before?.status) &&
                    isTerminalRunStatus(after?.status)
                return justFinished ? runMetricsBatchFetcher({projectId, runId}) : metrics
            },
            enabled: Boolean(runId && projectId),
            staleTime: 30_000,
            refetchInterval: poll ? RUN_METRICS_REFRESH_MS : false,
        }
    }),
)

// ============================================================================
// CATALOG
// ============================================================================

export interface TemporalMetricPoint {
    /** ms since the epoch. */
    timestamp: number
    stats: MetricStats
}

export interface RunMetricEntry {
    /** `{stepKey}:{metricKey}` for an evaluator metric; "cost", "duration", "tokens" or "errors". */
    id: string
    kind: "evaluator" | "invocation"
    stepKey: string | null
    metricKey: string
    label: string
    evaluatorId: string | null
    evaluatorSlug: string | null
    /** The run-level stats; for an online run with no static row, the latest point's stats. */
    stats: MetricStats | null
    /** Online runs: one point per timestamped row, oldest first. Empty otherwise. */
    temporal: TemporalMetricPoint[]
}

/** Invocation metrics, in the order the summary table lists them. */
export const INVOCATION_METRICS = [
    {id: "cost", metricKey: "attributes.ag.metrics.costs.cumulative.total", label: "Cost"},
    {id: "duration", metricKey: "attributes.ag.metrics.duration.cumulative", label: "Duration"},
    {id: "tokens", metricKey: "attributes.ag.metrics.tokens.cumulative.total", label: "Tokens"},
    {id: "errors", metricKey: "attributes.ag.metrics.errors.cumulative", label: "Errors"},
] as const

/** Keys under this prefix are invocation analytics, also reported by evaluator steps. */
const INVOCATION_PREFIX = "attributes.ag.metrics."
const LABEL_PREFIXES = ["attributes.ag.data.outputs.", "attributes.ag.data.", "outputs."]

/** "attributes.ag.data.outputs.score" -> "score". */
export function metricLabel(metricKey: string): string {
    const prefix = LABEL_PREFIXES.find((candidate) => metricKey.startsWith(candidate))
    return prefix ? metricKey.slice(prefix.length) : metricKey
}

type StepMetrics = Record<string, Record<string, unknown>>

const stepMetrics = (metric: EvaluationMetric): StepMetrics => {
    const out: StepMetrics = {}
    for (const [stepKey, value] of Object.entries(metric.data ?? {})) {
        if (value && typeof value === "object" && !Array.isArray(value)) {
            out[stepKey] = value as Record<string, unknown>
        }
    }
    return out
}

/**
 * The errors of several evaluators: their totals added up. Only the type, the sum and the count
 * combine; a mean, a median or a range of one evaluator would not describe the total.
 */
function sumCounts(all: (MetricStats | null)[]): MetricStats | null {
    const stats = all.filter((entry): entry is MetricStats => entry !== null)
    if (stats.length === 0) return null
    const total = (pick: (entry: MetricStats) => number | undefined) =>
        stats.reduce((sum, entry) => sum + (pick(entry) ?? 0), 0)
    return {
        type: stats[0].type,
        sum: total((entry) => entry.sum ?? (entry.mean ?? 0) * (entry.count ?? 0)),
        count: total((entry) => entry.count),
    }
}

/**
 * What several evaluators spend on one trace: their totals add up (a trace runs every evaluator)
 * and divide by the number of traces, the largest count. An evaluator that skipped some traces
 * adds only what it spent. When an evaluator has no count, the means add up and there is no
 * total; when one also has no mean, there is no average.
 */
function sumPerTrace(all: (MetricStats | null)[]): MetricStats | null {
    const stats = all.filter((entry): entry is MetricStats => entry !== null)
    if (stats.length === 0) return null
    const type = stats[0].type
    if (stats.every((entry) => entry.count !== undefined)) {
        const count = Math.max(...stats.map((entry) => entry.count ?? 0))
        const totals = stats.map((entry) => entry.sum ?? (entry.mean ?? 0) * (entry.count ?? 0))
        const sum = totals.reduce((acc, total) => acc + total, 0)
        return count > 0 ? {type, mean: sum / count, sum, count} : {type, sum, count}
    }
    const means = stats.map(
        (entry) =>
            entry.mean ??
            (entry.sum !== undefined && entry.count ? entry.sum / entry.count : undefined),
    )
    if (means.some((mean) => mean === undefined)) return {type}
    return {type, mean: means.reduce<number>((acc, mean) => acc + (mean ?? 0), 0)}
}

/** The points of several evaluators, combined per timestamp, oldest first. */
function sumPoints(
    all: TemporalMetricPoint[][],
    combine: (stats: (MetricStats | null)[]) => MetricStats | null = sumCounts,
): TemporalMetricPoint[] {
    const byTime = new Map<number, (MetricStats | null)[]>()
    for (const points of all) {
        for (const {timestamp, stats} of points) {
            byTime.set(timestamp, [...(byTime.get(timestamp) ?? []), stats])
        }
    }
    return [...byTime.entries()]
        .sort(([a], [b]) => a - b)
        .flatMap(([timestamp, stats]) => {
            const summed = combine(stats)
            return summed ? [{timestamp, stats: summed}] : []
        })
}

/**
 * Build the catalog of one run from the run and its run-level metric rows. Pure: the atom below
 * feeds it, and tests call it with captured responses.
 */
export function buildRunMetricCatalog(
    run: EvaluationRun | null,
    metrics: readonly EvaluationMetric[],
): RunMetricEntry[] {
    const runLevel = metrics.filter((metric) => !metric.scenario_id)
    const staticRow = runLevel.find((metric) => !metric.timestamp)
    const staticData = staticRow ? stepMetrics(staticRow) : {}
    const timed = runLevel
        .flatMap((metric) => {
            const timestamp = metric.timestamp ? Date.parse(metric.timestamp) : NaN
            return Number.isFinite(timestamp) ? [{timestamp, data: stepMetrics(metric)}] : []
        })
        .sort((a, b) => a.timestamp - b.timestamp)

    const pointsFor = (stepKey: string, metricKey: string): TemporalMetricPoint[] =>
        timed.flatMap(({timestamp, data}) => {
            const stats = normalizeMetricStats(data[stepKey]?.[metricKey])
            return stats ? [{timestamp, stats}] : []
        })

    const statsFor = (stepKey: string, metricKey: string, temporal: TemporalMetricPoint[]) =>
        normalizeMetricStats(staticData[stepKey]?.[metricKey]) ?? temporal.at(-1)?.stats ?? null

    const steps = run?.data?.steps ?? []
    const entries: RunMetricEntry[] = []

    for (const step of steps.filter((candidate) => candidate.type === "annotation")) {
        const keys = new Set<string>(Object.keys(staticData[step.key] ?? {}))
        for (const {data} of timed) Object.keys(data[step.key] ?? {}).forEach((k) => keys.add(k))
        for (const metricKey of keys) {
            if (metricKey.startsWith(INVOCATION_PREFIX)) continue
            const temporal = pointsFor(step.key, metricKey)
            const stats = statsFor(step.key, metricKey, temporal)
            if (!isAggregatableMetric(stats)) continue
            entries.push({
                id: `${step.key}:${metricKey}`,
                kind: "evaluator",
                stepKey: step.key,
                metricKey,
                label: metricLabel(metricKey),
                evaluatorId: step.references?.evaluator?.id ?? null,
                evaluatorSlug: step.references?.evaluator?.slug ?? null,
                stats,
                temporal,
            })
        }
    }

    const keysOf = (type: string) =>
        steps.filter((step) => step.type === type).map((step) => step.key)
    const invocationKeys = keysOf("invocation")
    // A live run calls no app: its evaluators are the steps that fail, so they report the errors.
    const errorKeys = invocationKeys.length > 0 ? invocationKeys : keysOf("annotation")
    const hasMetric = (key: string, metricKey: string) =>
        staticData[key]?.[metricKey] !== undefined ||
        timed.some(({data}) => data[key]?.[metricKey] !== undefined)
    for (const {id, metricKey, label} of INVOCATION_METRICS) {
        // A live run calls no app: what it spends per trace (cost, time, tokens) is its evaluators'.
        const fromEvaluators = invocationKeys.length === 0
        const candidates = id === "errors" || fromEvaluators ? errorKeys : invocationKeys
        const stepKeys = candidates.filter((key) => hasMetric(key, metricKey))
        const stepKey = stepKeys[0] ?? null
        // Several evaluators: errors add up as totals, and cost, time and tokens per trace. Several
        // app steps report cost, time and tokens from the first one, as the old app does.
        const combined = stepKeys.length > 1 && (id === "errors" || fromEvaluators)
        const combine = id === "errors" ? sumCounts : sumPerTrace
        const temporal = combined
            ? sumPoints(
                  stepKeys.map((key) => pointsFor(key, metricKey)),
                  combine,
              )
            : stepKey
              ? pointsFor(stepKey, metricKey)
              : []
        const stats = combined
            ? combine(stepKeys.map((key) => statsFor(key, metricKey, pointsFor(key, metricKey))))
            : stepKey
              ? statsFor(stepKey, metricKey, temporal)
              : null
        entries.push({
            id,
            kind: "invocation",
            stepKey,
            metricKey,
            label,
            evaluatorId: null,
            evaluatorSlug: null,
            stats,
            temporal,
        })
    }

    return entries
}

export const runMetricCatalogAtomFamily = atomFamily((runId: string) =>
    atom<RunMetricEntry[]>((get) =>
        buildRunMetricCatalog(
            get(evaluationRunQueryAtomFamily(runId)).data ?? null,
            get(runLevelMetricsQueryAtomFamily(runId)).data ?? [],
        ),
    ),
)
