/**
 * Run comparison rules, copied from the old app as pure functions: the `?compare=` URL value
 * (`EvalRunDetails/state/urlCompare.ts`), the run structure and the "can this run be compared"
 * check (`EvalRunDetails/atoms/compare.ts`), and the candidate rule of `CompareRunsMenu.tsx`.
 *
 * @packageDocumentation
 */

import {runStatusTone} from "./runKind"

/** The old app compares a run with at most 4 others. */
export const MAX_COMPARISON_RUNS = 4

export const COMPARE_QUERY_KEY = "compare"

/** `?compare=a,b&compare=c` -> ["a", "b", "c"]; blanks are dropped. */
export function parseCompareParam(value: string | readonly string[] | null | undefined): string[] {
    if (!value) return []
    const parts = typeof value === "string" ? [value] : value
    return parts
        .flatMap((entry) => String(entry).split(","))
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
}

/** The `compare` query value for these ids, or null to remove it. */
export const compareParamValue = (ids: readonly string[]): string | null =>
    ids.length ? ids.join(",") : null

/** Add or remove a compared run; adding past the limit changes nothing. */
export function toggleCompareRun(ids: readonly string[], runId: string): string[] {
    if (ids.includes(runId)) return ids.filter((id) => id !== runId)
    if (ids.length >= MAX_COMPARISON_RUNS) return [...ids]
    return [...ids, runId]
}

interface CompareStep {
    key?: string
    type?: string | null
    references?: Record<string, unknown> | null
}

export interface CompareRunInput {
    id: string
    status?: string | null
    data?: {steps?: readonly CompareStep[] | null} | null
}

export interface RunComparisonStructure {
    testsetIds: string[]
    hasQueryInput: boolean
    inputStepCount: number
    /** Evaluator ids (else slugs) of the annotation steps. */
    evaluatorIds: string[]
}

const refId = (value: unknown): string | undefined => {
    if (!value || typeof value !== "object") return undefined
    const ref = value as {id?: unknown; slug?: unknown}
    return typeof ref.id === "string" ? ref.id : undefined
}

const refIdOrSlug = (value: unknown): string | undefined => {
    if (!value || typeof value !== "object") return undefined
    const ref = value as {id?: unknown; slug?: unknown}
    if (typeof ref.id === "string") return ref.id
    return typeof ref.slug === "string" ? ref.slug : undefined
}

/** The test sets, the evaluators and the kind of input of a run, from its steps. */
export function runComparisonStructure(run: CompareRunInput): RunComparisonStructure {
    const testsetIds = new Set<string>()
    const evaluatorIds = new Set<string>()
    let hasQueryInput = false
    let inputStepCount = 0
    for (const step of run.data?.steps ?? []) {
        const refs = step.references ?? {}
        if (step.type === "input") {
            inputStepCount += 1
            if (refs.query || refs.query_revision || refs.query_variant) hasQueryInput = true
            const testsetId = refId(refs.testset)
            if (testsetId) testsetIds.add(testsetId)
        } else if (step.type === "annotation") {
            const evaluatorId = refIdOrSlug(refs.evaluator)
            if (evaluatorId) evaluatorIds.add(evaluatorId)
        }
    }
    return {
        testsetIds: [...testsetIds],
        hasQueryInput,
        inputStepCount,
        evaluatorIds: [...evaluatorIds],
    }
}

/** Statuses of a finished run, in which a run can be compared. */
const COMPARABLE_STATUSES = new Set([
    "success",
    "failure",
    "failed",
    "errors",
    "cancelled",
    "completed",
    "finished",
    "ok",
    "evaluation_finished",
    "evaluation_finished_with_errors",
    "evaluation_failed",
    "evaluation_aggregation_failed",
])

export type CompareBlockReason = "pending-status" | "no-input" | "no-testset" | "query-input"

/**
 * Whether a run can be compared, and why not: it must have finished, have an input step, run on a
 * test set, and not read a live query.
 */
export function compareBlockReason(run: CompareRunInput): CompareBlockReason | null {
    if (!run.status || !COMPARABLE_STATUSES.has(run.status.toLowerCase())) return "pending-status"
    const structure = runComparisonStructure(run)
    if (structure.inputStepCount === 0) return "no-input"
    if (structure.testsetIds.length === 0) return "no-testset"
    if (structure.hasQueryInput) return "query-input"
    return null
}

/**
 * The runs that can be compared with `base`: other comparable runs that share a test set and an
 * evaluator with it.
 */
export function compareCandidates<T extends CompareRunInput>(
    base: CompareRunInput,
    runs: readonly T[],
): T[] {
    if (compareBlockReason(base)) return []
    const baseStructure = runComparisonStructure(base)
    const testsets = new Set(baseStructure.testsetIds)
    const evaluators = new Set(baseStructure.evaluatorIds)
    return runs.filter((run) => {
        if (run.id === base.id || compareBlockReason(run)) return false
        const structure = runComparisonStructure(run)
        return (
            structure.testsetIds.some((id) => testsets.has(id)) &&
            structure.evaluatorIds.some((id) => evaluators.has(id))
        )
    })
}

/**
 * The runs compared with `baseId`, from the `?compare=` value: without the base run, without
 * repeats, and at most `MAX_COMPARISON_RUNS`.
 */
export function compareRunIds(
    value: string | readonly string[] | null | undefined,
    baseId: string,
): string[] {
    const ids = [...new Set(parseCompareParam(value))].filter((id) => id !== baseId)
    return ids.slice(0, MAX_COMPARISON_RUNS)
}

/** The old picker's status filters, in its order. */
export const COMPARE_STATUS_FILTERS = [
    {key: "all", label: "All"},
    {key: "success", label: "Success"},
    {key: "running", label: "Running"},
    {key: "error", label: "Errors"},
    {key: "other", label: "Other"},
] as const

export type CompareStatusFilter = (typeof COMPARE_STATUS_FILTERS)[number]["key"]
type CompareStatusGroup = Exclude<CompareStatusFilter, "all">

/** The picker's status group of a run: the tone its status tag shows. */
export function compareStatusGroup(status: string | null | undefined): CompareStatusGroup {
    const tone = status ? runStatusTone(status) : "default"
    if (tone === "success" || tone === "error") return tone
    return tone === "processing" ? "running" : "other"
}

/** How many runs each status filter keeps. */
export function compareStatusCounts(
    runs: readonly {status?: string | null}[],
): Record<CompareStatusFilter, number> {
    const counts: Record<CompareStatusFilter, number> = {
        all: runs.length,
        success: 0,
        running: 0,
        error: 0,
        other: 0,
    }
    for (const run of runs) counts[compareStatusGroup(run.status)] += 1
    return counts
}

/** The runs whose name holds `search` (any case) and whose status is in `status`. */
export function filterCompareRuns<T extends {name?: string | null; status?: string | null}>(
    runs: readonly T[],
    {search, status}: {search: string; status: CompareStatusFilter},
): T[] {
    const query = search.trim().toLowerCase()
    return runs.filter(
        (run) =>
            (!query || (run.name ?? "").toLowerCase().includes(query)) &&
            (status === "all" || compareStatusGroup(run.status) === status),
    )
}

/**
 * The key that finds one metric in every compared run: the invocation metric's id, or the
 * evaluator (id, else slug, else step key) with the metric key. Step keys can differ between runs.
 */
export function compareMetricKey(metric: {
    id: string
    kind: "evaluator" | "invocation"
    stepKey: string | null
    metricKey: string
    evaluatorId: string | null
    evaluatorSlug: string | null
}): string {
    if (metric.kind === "invocation") return metric.id
    const evaluator = metric.evaluatorId ?? metric.evaluatorSlug ?? metric.stepKey
    return evaluator ? `${evaluator}:${metric.metricKey}` : metric.id
}

export type CompareDeltaTone = "positive" | "negative" | "neutral"

/**
 * A compared run's value against the base run's, in percent, as the old metric cards print it:
 * "+12%", "-100%", "0%", or "-" when either value is missing or the base is 0.
 */
export function compareDelta(
    value: number | null | undefined,
    base: number | null | undefined,
): {text: string; tone: CompareDeltaTone} {
    if (
        typeof value !== "number" ||
        typeof base !== "number" ||
        !Number.isFinite(value) ||
        !Number.isFinite(base) ||
        base === 0
    ) {
        return {text: "-", tone: "neutral"}
    }
    const rounded = Math.round(((value - base) / base) * 100)
    if (rounded > 0) return {text: `+${rounded}%`, tone: "positive"}
    if (rounded < 0) return {text: `${rounded}%`, tone: "negative"}
    return {text: "0%", tone: "neutral"}
}

/** One bar group of a chart: its category and the value of each series. */
export interface CompareBarDatum {
    category: string
    values: Readonly<Record<string, number | null>>
}

/**
 * The bars of several runs in one chart: each category once, with the value of every run that has
 * it. Categories keep the order they first appear in, base run first; when every category is a
 * number or a numeric range ("0.5–1"), they are sorted by their first number.
 */
export function mergeCompareBars(
    series: readonly (readonly CompareBarDatum[])[],
): CompareBarDatum[] {
    const merged = new Map<string, CompareBarDatum>()
    for (const data of series) {
        for (const datum of data) {
            const entry = merged.get(datum.category) ?? {category: datum.category, values: {}}
            entry.values = {...entry.values, ...datum.values}
            merged.set(datum.category, entry)
        }
    }
    const rows = [...merged.values()]
    const start = (category: string) => Number.parseFloat(category)
    const numeric = rows.every(({category}) => /^-?\d/.test(category))
    return numeric ? rows.sort((a, b) => start(a.category) - start(b.category)) : rows
}

/**
 * Each base row followed by the matching row of every compared run, as the old scenarios table
 * lays them out. A row matches on its test case, else on its position. `row` is null when the
 * compared run has no match among the rows it has loaded.
 */
export function matchCompareRows<T>(
    base: readonly T[],
    compared: readonly {runId: string; rows: readonly T[]}[],
    {testcaseOf, indexOf}: {testcaseOf: (row: T) => string | null; indexOf: (row: T) => number},
): {base: T; runId: string | null; slot: number; row: T | null}[] {
    const lookups = compared.map(({runId, rows}) => {
        const byTestcase = new Map<string, T>()
        const byIndex = new Map<number, T>()
        for (const row of rows) {
            const testcase = testcaseOf(row)
            if (testcase && !byTestcase.has(testcase)) byTestcase.set(testcase, row)
            byIndex.set(indexOf(row), row)
        }
        return {runId, byTestcase, byIndex}
    })
    return base.flatMap((row) => {
        const testcase = testcaseOf(row)
        return [
            {base: row, runId: null, slot: 0, row},
            ...lookups.map(({runId, byTestcase, byIndex}, index) => ({
                base: row,
                runId,
                slot: index + 1,
                row:
                    (testcase ? byTestcase.get(testcase) : undefined) ??
                    byIndex.get(indexOf(row)) ??
                    null,
            })),
        ]
    })
}

/**
 * The key of the compared run's group that stands for the base run's group: the same key (the
 * same test set, app or evaluator), else the only group of the same kind (another app).
 */
export function matchCompareGroupKey(
    base: {kind: string; key: string},
    groups: readonly {kind: string; key: string}[],
): string | null {
    if (groups.some((group) => group.key === base.key)) return base.key
    const sameKind = groups.filter((group) => group.kind === base.kind)
    return sameKind.length === 1 ? sameKind[0].key : null
}
