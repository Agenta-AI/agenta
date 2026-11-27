/**
 * The result of one evaluator on one test case (or one span), as one row: which metrics show on
 * the row and how, what opens on expand, and whether the evaluator failed. Also the drawer
 * header's count of true binary metrics. Pure: no React, no request.
 *
 * Not the Overview's `EvaluatorRow` (`evaluatorRows.ts`), which aggregates one evaluator over a
 * whole run.
 *
 * @packageDocumentation
 */

import type {MetricKind} from "./evaluatorRows"

/** Up to this many short metrics show on the row by name; more show a count or the first two. */
export const EVALUATOR_ROW_INLINE_LIMIT = 3

/** `done` has values; `pending` still runs; `error` failed; `notRun` never ran (the app call failed). */
export type EvaluatorResultState = "done" | "pending" | "error" | "notRun"

export interface EvaluatorResultMetricInput {
    name: string
    value: unknown
    /** The kind from the run metric catalog; null (no catalog, as in the trace view) reads the value. */
    kind: MetricKind | null
}

export interface EvaluatorResultMetric {
    name: string
    value: unknown
    kind: MetricKind
}

/** What the collapsed row shows after the evaluator's name. */
export type EvaluatorResultInline =
    /** Up to three short metrics, each with its name. */
    | {kind: "metrics"; metrics: EvaluatorResultMetric[]}
    /** More than three, with binary metrics: "X of Y passed" and the failed names. */
    | {kind: "passed"; passed: number; total: number; failedNames: string[]}
    /** More than three, no binary metric: the first two and "+N more". */
    | {kind: "first"; metrics: EvaluatorResultMetric[]; more: number}

export interface EvaluatorResultSummary {
    state: EvaluatorResultState
    inline: EvaluatorResultInline
    /** Binary, numeric and categorical metrics, in their order; a grid on expand when over three. */
    short: EvaluatorResultMetric[]
    /** Reasons and JSON outputs: only on expand. */
    text: EvaluatorResultMetric[]
    /** True and all binary metrics with a value. */
    assertions: {passed: number; total: number}
    /** A false binary metric, or an error. An evaluator with no binary metric never fails. */
    failed: boolean
}

/** The kind of a metric with no catalog entry: true or false, a number, else text. */
export const metricKindOfValue = (value: unknown): MetricKind =>
    typeof value === "boolean" ? "binary" : typeof value === "number" ? "numeric" : "text"

/** Summarize one evaluator's metrics for one test case, by the taxonomy's evaluator row rule. */
export function summarizeEvaluatorResult(
    metrics: readonly EvaluatorResultMetricInput[],
    state: EvaluatorResultState,
): EvaluatorResultSummary {
    const all: EvaluatorResultMetric[] =
        state === "done"
            ? metrics.map(({name, value, kind}) => ({
                  name,
                  value,
                  kind: kind ?? metricKindOfValue(value),
              }))
            : []
    const short = all.filter((metric) => metric.kind !== "text")
    const text = all.filter((metric) => metric.kind === "text")
    const binaries = short.filter(
        (metric) => metric.kind === "binary" && typeof metric.value === "boolean",
    )
    const passed = binaries.filter((metric) => metric.value === true).length
    const failedNames = binaries
        .filter((metric) => metric.value === false)
        .map((metric) => metric.name)

    let inline: EvaluatorResultInline
    if (short.length <= EVALUATOR_ROW_INLINE_LIMIT) {
        inline = {kind: "metrics", metrics: short}
    } else if (binaries.length > 0) {
        inline = {kind: "passed", passed, total: binaries.length, failedNames}
    } else {
        inline = {kind: "first", metrics: short.slice(0, 2), more: short.length - 2}
    }

    return {
        state,
        inline,
        short,
        text,
        assertions: {passed, total: binaries.length},
        failed: state === "error" || failedNames.length > 0,
    }
}

const sortGroup = (summary: EvaluatorResultSummary) =>
    summary.state === "notRun" ? 2 : summary.failed ? 0 : 1

/**
 * The order of the rows: failed and errored first, by name; then the others as they came; then
 * the evaluators that did not run.
 */
export function sortEvaluatorResults<T extends {name: string; summary: EvaluatorResultSummary}>(
    rows: readonly T[],
): T[] {
    return rows
        .map((row, position) => ({row, position}))
        .sort((a, b) => {
            const group = sortGroup(a.row.summary) - sortGroup(b.row.summary)
            if (group !== 0) return group
            if (sortGroup(a.row.summary) === 0) {
                const byName = a.row.name.localeCompare(b.row.name)
                if (byName !== 0) return byName
            }
            return a.position - b.position
        })
        .map(({row}) => row)
}

/** The drawer header's count: true binary metrics of all binary metrics, or the main numbers. */
export type AssertionSummaryValue =
    | {kind: "assertions"; passed: number; total: number}
    /** No binary metric: the first numeric metric of up to two evaluators. Never "Passed". */
    | {kind: "mainNumbers"; items: {name: string; value: number}[]}

/** Up to this many evaluators give a main number when no metric is binary. */
const MAIN_NUMBERS = 2

/**
 * Count the true binary metrics over all binary metrics of a test case. With no binary metric,
 * give the first numeric metric of each evaluator, up to two. The run tile "Passed", which counts
 * test cases, is a different number.
 */
export function assertionSummary(
    summaries: readonly EvaluatorResultSummary[],
): AssertionSummaryValue {
    const total = summaries.reduce((sum, summary) => sum + summary.assertions.total, 0)
    if (total > 0) {
        const passed = summaries.reduce((sum, summary) => sum + summary.assertions.passed, 0)
        return {kind: "assertions", passed, total}
    }
    const items: {name: string; value: number}[] = []
    for (const summary of summaries) {
        const metric = summary.short.find(
            (candidate) => candidate.kind === "numeric" && typeof candidate.value === "number",
        )
        if (metric) items.push({name: metric.name, value: metric.value as number})
        if (items.length === MAIN_NUMBERS) break
    }
    return {kind: "mainNumbers", items}
}
