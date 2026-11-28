/**
 * The Overview tab of one run as data: one row per evaluator step with its metrics drawn by kind,
 * the "Passed" count over the per-test-case rows, and the meta tiles. Pure: no React, no request.
 *
 * @packageDocumentation
 */

import {
    format3Sig,
    formatCost,
    formatDuration,
    formatTokens,
    isAggregatableMetric,
    isBooleanMetricStats,
    normalizeMetricStats,
    type MetricStats,
} from "./metricStats"

/** How a metric cell is drawn. `text` is a string or json output: the Overview leaves it out. */
export type MetricKind = "binary" | "numeric" | "categorical" | "text"

const KIND_ORDER: Record<MetricKind, number> = {binary: 0, numeric: 1, categorical: 2, text: 3}

/** The kind from the API type; a legacy blob with no type uses the old shape tests. */
export function metricKind(stats: MetricStats | null | undefined): MetricKind {
    if (!stats) return "text"
    if (isBooleanMetricStats(stats)) return "binary"
    const type = stats.type
    if (type?.startsWith("numeric/")) return "numeric"
    if (type?.startsWith("categorical/")) return "categorical"
    if (type || !isAggregatableMetric(stats)) return "text"
    return stats.mean !== undefined ||
        stats.median !== undefined ||
        stats.sum !== undefined ||
        stats.max !== undefined
        ? "numeric"
        : "categorical"
}

/** True when every value of a numeric metric is in 0 to 1: its run-level min and max. */
export function isUnitScale(stats: MetricStats | null | undefined): boolean {
    return stats?.min !== undefined && stats.max !== undefined && stats.min >= 0 && stats.max <= 1
}

/** True and false counts of a binary metric. */
export function binaryCounts(stats: MetricStats | null | undefined): {
    passed: number
    failed: number
} {
    let passed = 0
    let failed = 0
    for (const item of stats?.frequency ?? []) {
        if (item.value === true) passed += item.count
        else if (item.value === false) failed += item.count
    }
    return {passed, failed}
}

/** One value on 0 to 1: a binary pass rate, or the mean of a numeric metric on 0 to 1. */
export function chartValue(stats: MetricStats | null | undefined): number | null {
    const kind = metricKind(stats)
    if (kind === "binary") {
        const {passed, failed} = binaryCounts(stats)
        return passed + failed > 0 ? passed / (passed + failed) : null
    }
    if (kind === "numeric" && isUnitScale(stats) && stats?.mean !== undefined) return stats.mean
    return null
}

/** One bar of a score histogram: the share is its count over the metric's count. */
export interface HistogramBar {
    from: number
    to: number
    count: number
    share: number
}

/**
 * The server's bins as they come (`numeric/continuous`), else one bar per value of the frequency
 * ordered by value (`numeric/discrete`). Never binned again here.
 */
export function histogramBarsOf(stats: MetricStats | null | undefined): HistogramBar[] {
    const bins = stats?.distribution?.length
        ? stats.distribution.map(({interval: [from, to], count}) => ({from, to, count}))
        : (stats?.frequency ?? [])
              .flatMap((item) =>
                  typeof item.value === "number" && Number.isFinite(item.value)
                      ? [{from: item.value, to: item.value, count: item.count}]
                      : [],
              )
              .sort((a, b) => a.from - b.from)
    const total = stats?.count ?? bins.reduce((sum, bin) => sum + bin.count, 0)
    // Every value the same: the server sends zero-width bins on that value; draw one full bar.
    const point = bins[0]?.from
    if (bins.length > 1 && bins.every((bin) => bin.from === point && bin.to === point)) {
        const count = bins.reduce((sum, bin) => sum + bin.count, 0)
        return [{from: point, to: point, count, share: total > 0 ? count / total : 0}]
    }
    return bins.map((bin) => ({...bin, share: total > 0 ? bin.count / total : 0}))
}

/** One segment of a categorical metric: its value as text and its share of all chosen values. */
export interface CategorySegment {
    label: string
    count: number
    share: number
}

const categoryText = (value: unknown) =>
    typeof value === "string" ? value : value === null || value === undefined ? "—" : String(value)

/** The values of a categorical metric, most chosen first. */
export function categorySegments(stats: MetricStats | null | undefined): CategorySegment[] {
    const items = [...(stats?.frequency ?? [])].filter((item) => item.count > 0)
    const total = items.reduce((sum, item) => sum + item.count, 0)
    return items
        .sort((a, b) => b.count - a.count)
        .map((item) => ({
            label: categoryText(item.value),
            count: item.count,
            share: total > 0 ? item.count / total : 0,
        }))
}

/** A mean as the table prints it: 2 decimals on 0 to 1, else 3 significant digits. */
export function formatMean(mean: number, unitScale: boolean): string {
    return unitScale ? mean.toFixed(2) : format3Sig(mean)
}

// ============================================================================
// ROWS
// ============================================================================

/** The catalog entry fields the rows read (see `RunMetricEntry`). */
export interface EvaluatorRowMetricInput {
    id: string
    kind: "evaluator" | "invocation"
    stepKey: string | null
    metricKey: string
    /** The label to show, without the evaluator name. */
    label: string
    stats: MetricStats | null
    statsAreRunWide: boolean
}

export interface EvaluatorRowStepInput {
    stepKey: string
    evaluatorId: string | null
    /** The evaluator's name, else its slug. */
    name: string | null
}

export interface EvaluatorRowMetric {
    id: string
    stepKey: string
    metricKey: string
    label: string
    kind: MetricKind
    /** The stats the cell draws; null shows "No results yet". */
    stats: MetricStats | null
}

export interface EvaluatorRow {
    stepKey: string
    evaluatorId: string | null
    name: string
    /** Binary, numeric, then categorical; by label inside each kind. Never text. */
    metrics: EvaluatorRowMetric[]
}

/**
 * One row per evaluator step: the steps of the run first, in run order, then any other step the
 * catalog names. Text metrics (string, json) are left out, and so is a step that has only text
 * metrics; a step with no metric yet keeps its row. `runWideOnly` (online runs) keeps only stats
 * of the run-wide row.
 */
export function buildEvaluatorRows(
    steps: readonly EvaluatorRowStepInput[],
    entries: readonly EvaluatorRowMetricInput[],
    {runWideOnly = false}: {runWideOnly?: boolean} = {},
): EvaluatorRow[] {
    const evaluatorEntries = entries.filter(
        (entry): entry is EvaluatorRowMetricInput & {stepKey: string} =>
            entry.kind === "evaluator" && entry.stepKey !== null,
    )
    const all = [...steps]
    for (const entry of evaluatorEntries) {
        if (!all.some((step) => step.stepKey === entry.stepKey)) {
            all.push({stepKey: entry.stepKey, evaluatorId: null, name: null})
        }
    }
    return all.flatMap((step) => {
        const stepEntries = evaluatorEntries.filter((entry) => entry.stepKey === step.stepKey)
        const metrics = stepEntries
            .filter((entry) => metricKind(entry.stats) !== "text")
            .map((entry) => ({
                id: entry.id,
                stepKey: entry.stepKey,
                metricKey: entry.metricKey,
                label: entry.label,
                kind: metricKind(entry.stats),
                stats: runWideOnly && !entry.statsAreRunWide ? null : entry.stats,
            }))
            .sort(
                (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.label.localeCompare(b.label),
            )
        if (stepEntries.length > 0 && metrics.length === 0) return []
        return [
            {
                stepKey: step.stepKey,
                evaluatorId: step.evaluatorId,
                name: step.name ?? step.stepKey,
                metrics,
            },
        ]
    })
}

// ============================================================================
// PASSED
// ============================================================================

/** The per-test-case request reads at most this many rows; a full page means "not available". */
export const SCENARIO_METRICS_LIMIT = 5000

interface ScenarioMetricRowInput {
    scenario_id?: string | null
    data?: Record<string, unknown> | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

/** A binary value of one test case: true, false, or null when the blob holds neither. */
function scenarioBinaryValue(raw: unknown): boolean | null {
    const {passed, failed} = binaryCounts(normalizeMetricStats(raw))
    if (failed > 0) return false
    return passed > 0 ? true : null
}

/**
 * Test cases whose binary values are all true, over the test cases that ran and have a binary
 * value. A missing value does not fail; a test case with no binary value is not counted, and
 * neither is a test case that did not run (`notRunIds`, from {@link runFailures}). Null when the
 * rows are not all there (a full page of {@link SCENARIO_METRICS_LIMIT} rows).
 */
export function passedTestCases(
    rows: readonly ScenarioMetricRowInput[],
    binaryMetrics: readonly {stepKey: string; metricKey: string}[],
    notRunIds: ReadonlySet<string>,
): {passed: number; total: number} | null {
    if (rows.length >= SCENARIO_METRICS_LIMIT) return null
    const byScenario = new Map<string, (boolean | null)[]>()
    for (const row of rows) {
        if (!row.scenario_id || notRunIds.has(row.scenario_id)) continue
        const data = isRecord(row.data) ? row.data : {}
        const values = binaryMetrics.map(({stepKey, metricKey}) => {
            const bucket = data[stepKey]
            return isRecord(bucket) ? scenarioBinaryValue(bucket[metricKey]) : null
        })
        byScenario.set(row.scenario_id, [...(byScenario.get(row.scenario_id) ?? []), ...values])
    }
    let passed = 0
    let total = 0
    for (const values of byScenario.values()) {
        const known = values.filter((value): value is boolean => value !== null)
        if (known.length === 0) continue
        total += 1
        if (known.every(Boolean)) passed += 1
    }
    return {passed, total}
}

/** One step of one test case whose stored result is `failure` or `errors`. */
export interface FailedStepInput {
    scenarioId: string
    stepKey: string
}

/** Failed test cases, read from the per-test-case rows and the failed step results. */
export interface RunFailures {
    /** Test cases with a per-test-case row or a failed step. */
    total: number
    /** Test cases whose application step failed. */
    notRun: number
    /** The ids of those test cases; "Passed" does not count them. */
    notRunIds: ReadonlySet<string>
    /** Test cases that ran but where at least one evaluator step failed. */
    evaluatorFailed: number
    /** By evaluator step key: the test cases that ran where that evaluator step failed. */
    byStep: Record<string, number>
}

/**
 * The test cases that did not run (a step that is not an evaluator failed: the application) and
 * the ones an evaluator failed on, from the stored status of each step result. The trace errors metric is not used: it also
 * counts an error inside the application that the application recovered from. Null when the rows
 * or the failed steps are not all there (a full page of {@link SCENARIO_METRICS_LIMIT}). A missing
 * evaluator value without a failed step (the evaluator did not apply) is not a failure.
 */
export function runFailures(
    rows: readonly ScenarioMetricRowInput[],
    failedSteps: readonly FailedStepInput[],
    evaluatorStepKeys: readonly string[],
): RunFailures | null {
    if (rows.length >= SCENARIO_METRICS_LIMIT || failedSteps.length >= SCENARIO_METRICS_LIMIT) {
        return null
    }
    // A test case whose application failed before it wrote a trace has no row, but is one.
    const scenarioIds = new Set([
        ...rows.flatMap((row) => (row.scenario_id ? [row.scenario_id] : [])),
        ...failedSteps.map((step) => step.scenarioId),
    ])
    const failedByScenario = new Map<string, Set<string>>()
    for (const {scenarioId, stepKey} of failedSteps) {
        failedByScenario.set(
            scenarioId,
            (failedByScenario.get(scenarioId) ?? new Set()).add(stepKey),
        )
    }
    const notRunIds = new Set<string>()
    let evaluatorFailed = 0
    const byStep: Record<string, number> = {}
    for (const [scenarioId, failed] of failedByScenario) {
        if ([...failed].some((key) => !evaluatorStepKeys.includes(key))) {
            notRunIds.add(scenarioId)
            continue
        }
        const failedEvaluators = evaluatorStepKeys.filter((key) => failed.has(key))
        if (failedEvaluators.length > 0) evaluatorFailed += 1
        for (const key of failedEvaluators) byStep[key] = (byStep[key] ?? 0) + 1
    }
    return {total: scenarioIds.size, notRun: notRunIds.size, notRunIds, evaluatorFailed, byStep}
}

// ============================================================================
// TILES
// ============================================================================

export type RunTileId = "testCases" | "passed" | "cost" | "duration" | "tokens" | "errors"

/** The line under a tile's value; the view turns it into text. */
export type RunTileDetail =
    | {kind: "allFinished"}
    | {kind: "someFailed"}
    | {kind: "perCase"}
    | {kind: "perTrace"}
    | {kind: "total"}
    | {kind: "testCasesPassed"; passed: number; total: number; thatRan: boolean}
    | {kind: "notRun"; count: number; total: number}
    | {kind: "errorsSplit"; runs: number; evaluator: number}

export interface RunTile {
    id: RunTileId
    /**
     * The formatted value, "—" when there is none, "…" while it loads. A "Test cases" tile with a
     * `notRun` detail holds the count that ran; the view writes "{ran} of {total}".
     */
    value: string
    detail: RunTileDetail | null
    /** The "Passed" tile only: true binary values over all binary values of the run. */
    assertions: {passed: number; total: number} | null
}

export const TILE_MISSING = "—"
export const TILE_PENDING = "…"

/** Per-test-case rows: loading, not available (failed, too many, online), or the count. */
export type PassedState =
    | {status: "pending"}
    | {status: "unavailable"}
    | {status: "ready"; passed: number; total: number}

export interface RunTilesInput {
    /** The run's own status, for the "Test cases" line. */
    status: string | null
    online: boolean
    /** The invocation entries of the catalog: cost, duration, tokens, errors. */
    invocation: readonly {id: string; stats: MetricStats | null; statsAreRunWide: boolean}[]
    /** The stats of every binary metric of the run. */
    binaryStats: readonly (MetricStats | null)[]
    passed: PassedState
    metricsPending: boolean
    /** Failed test cases from the per-test-case rows; null when they are not available. */
    failures?: RunFailures | null
}

const meanOf = (stats: MetricStats) =>
    stats.mean ?? (stats.sum !== undefined && stats.count ? stats.sum / stats.count : undefined)

const totalOf = (stats: MetricStats) =>
    stats.sum ??
    (stats.mean !== undefined && stats.count !== undefined ? stats.mean * stats.count : undefined)

const percent = (part: number, whole: number) => `${Math.round((part / whole) * 100)}%`

/**
 * The tiles in order: test cases, passed, cost, duration, tokens, errors. No "Passed" tile when
 * the run has no binary metric.
 */
export function runTiles({
    status,
    online,
    invocation,
    binaryStats,
    passed,
    metricsPending,
    failures = null,
}: RunTilesInput): RunTile[] {
    // An online run without a run-wide row has only its latest time bucket, which is not the run.
    const statsOf = (id: string) => {
        const entry = invocation.find((item) => item.id === id)
        return entry && (!online || entry.statsAreRunWide) ? entry.stats : null
    }
    const show = (value: number | undefined, format: (value: number) => string, loaded: boolean) =>
        value !== undefined
            ? format(value)
            : metricsPending && !loaded
              ? TILE_PENDING
              : TILE_MISSING
    const tile = (
        id: RunTileId,
        pick: (stats: MetricStats) => number | undefined,
        format: (value: number) => string,
        detail: RunTileDetail | null,
    ): RunTile => {
        const stats = statsOf(id === "testCases" ? "duration" : id)
        return {
            id,
            value: show(stats ? pick(stats) : undefined, format, Boolean(stats)),
            detail,
            assertions: null,
        }
    }
    const average: RunTileDetail = online ? {kind: "perTrace"} : {kind: "perCase"}
    const whole = (value: number) => String(Math.round(value))

    const notRun = failures?.notRun ?? 0
    const failedCases = notRun + (failures?.evaluatorFailed ?? 0)
    const tiles: RunTile[] = [
        failures && notRun > 0
            ? {
                  id: "testCases" as const,
                  value: String(failures.total - notRun),
                  detail: {kind: "notRun", count: notRun, total: failures.total} as const,
                  assertions: null,
              }
            : tile(
                  "testCases",
                  (stats) => stats.count,
                  whole,
                  status === "success"
                      ? {kind: "allFinished"}
                      : status === "errors"
                        ? {kind: "someFailed"}
                        : null,
              ),
    ]
    if (binaryStats.length > 0) {
        const counts = binaryStats.map(binaryCounts)
        const truths = counts.reduce((sum, count) => sum + count.passed, 0)
        const values = counts.reduce((sum, count) => sum + count.passed + count.failed, 0)
        tiles.push({
            id: "passed",
            value:
                passed.status === "pending"
                    ? TILE_PENDING
                    : passed.status === "ready" && passed.total > 0
                      ? percent(passed.passed, passed.total)
                      : TILE_MISSING,
            detail:
                passed.status === "ready" && passed.total > 0
                    ? {
                          kind: "testCasesPassed",
                          passed: passed.passed,
                          total: passed.total,
                          thatRan: notRun > 0,
                      }
                    : null,
            assertions: values > 0 ? {passed: truths, total: values} : null,
        })
    }
    tiles.push(
        tile("cost", meanOf, formatCost, average),
        tile("duration", meanOf, formatDuration, average),
        tile("tokens", meanOf, formatTokens, average),
        failures && failedCases > 0
            ? {
                  id: "errors",
                  value: String(failedCases),
                  detail: {kind: "errorsSplit", runs: notRun, evaluator: failures.evaluatorFailed},
                  assertions: null,
              }
            : tile("errors", totalOf, whole, {kind: "total"}),
    )
    return tiles
}
