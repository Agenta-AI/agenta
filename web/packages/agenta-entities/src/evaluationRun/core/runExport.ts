/**
 * CSV export of evaluation runs, copied from the old app as pure functions: the cell escaping of
 * `@agenta/ui` `useTableExport`, and the value and header rules of
 * `EvaluationRunsTablePOC/hooks/useEvaluationRunsColumns/utils.tsx` and
 * `EvaluationRunsTable/export/*`. The caller resolves names (evaluators, members) and passes them in.
 *
 * @packageDocumentation
 */

import {formatMetricValue, METRIC_PLACEHOLDER} from "./metricFormat"
import type {MetricStats} from "./metricStats"
import {deriveEvaluationKind, EVALUATION_KIND_LABELS, type RunKindInput} from "./runKind"
import type {RunListColumns, RunListReferenceColumn} from "./runListColumns"
import {selectRunMetricStats, type RunStatsMap} from "./runStatsMap"

/**
 * One CSV cell: quoted when it holds a comma, a quote or a line break; quotes doubled. Text that
 * starts with =, +, -, @, a tab or a carriage return gets a leading quote so a spreadsheet does not
 * run it as a formula.
 */
export function csvCell(value: unknown): string {
    const text =
        value === null || value === undefined
            ? ""
            : typeof value === "string"
              ? value
              : typeof value === "number" || typeof value === "boolean"
                ? String(value)
                : JSON.stringify(value)
    // A text cell that starts like a formula would run in a spreadsheet: prefix it with a quote.
    const safe = typeof value === "string" && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** A header row and the data rows as one CSV text, one line per row. */
export function buildCsv(
    headers: readonly string[],
    rows: readonly (readonly unknown[])[],
): string {
    return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")
}

/** "evaluation-run-<key>.csv" with every run of other characters as one dash. */
export function runExportFilename(key: string): string {
    return `evaluation-run-${key.replace(/[^a-zA-Z0-9-_]+/g, "-")}.csv`
}

const text = (value: unknown): string | null => {
    if (typeof value === "string") return value.trim() || null
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    return null
}

export interface RunExportInput extends RunKindInput {
    id: string
    name?: string | null
    status?: string | null
    created_at?: string | null
}

/** The run name, else its id. */
export const runExportName = (run: RunExportInput): string => text(run.name) ?? run.id

/** The raw status ("success", "running"), as the old export writes it. */
export const runExportStatus = (run: RunExportInput): string => text(run.status) ?? ""

/** The creation time as ISO text; text that is not a date stays as it is. */
export function runExportCreatedAt(run: RunExportInput): string {
    if (!run.created_at) return ""
    const date = new Date(run.created_at)
    return Number.isNaN(date.getTime()) ? run.created_at : date.toISOString()
}

/** "Auto", "Human", "Live" or "SDK". */
export const runExportKind = (run: RunExportInput): string =>
    EVALUATION_KIND_LABELS[deriveEvaluationKind(run)]

/** A metric header: "<evaluator> • <metric>", or the metric alone without an evaluator. */
export const metricExportHeader = (metricLabel: string, groupLabel?: string | null): string =>
    groupLabel ? `${groupLabel} • ${metricLabel}` : metricLabel

/** A metric cell, the same text the old list cell and export print. */
export const metricExportValue = (
    metricKey: string,
    stats: MetricStats | null | undefined,
): string => formatMetricValue(metricKey, stats)

/**
 * A metric cell of a runs list export. A negative number ("-0.5") is written as a number, so the
 * formula guard of {@link csvCell} does not turn it into the text "'-0.5". Any other text stays
 * text.
 */
const metricExportCell = (text: string): string | number =>
    /^-\d+(\.\d+)?(e[+-]?\d+)?$/i.test(text) ? Number(text) : text

/** The reference column headers, the old list's labels. */
export const RUN_LIST_REFERENCE_LABELS: Record<RunListReferenceColumn, string> = {
    testset: "Test set",
    query: "Query",
    application: "Application",
}

/**
 * The header line of a runs list export, for the columns on screen: Status, Name, Kind (All tab),
 * the reference columns, "<evaluator> • <metric>" per evaluator metric, "Invocation • <metric>"
 * per invocation metric, Created on and Created by. `evaluatorNames` maps an evaluator group id
 * to its name; a group without one uses its id.
 */
export function runListExportHeaders(
    plan: RunListColumns,
    evaluatorNames: Readonly<Record<string, string>>,
): string[] {
    return [
        "Status",
        "Name",
        ...(plan.showKind ? ["Kind"] : []),
        ...plan.references.map((reference) => RUN_LIST_REFERENCE_LABELS[reference]),
        ...plan.evaluators.flatMap((group) =>
            group.columns.map((column) =>
                metricExportHeader(column.label, evaluatorNames[group.id] ?? group.id),
            ),
        ),
        ...plan.invocation.map((column) => metricExportHeader(column.label, "Invocation")),
        "Created on",
        "Created by",
    ]
}

/** The names a run's export line shows, resolved by the caller. Null writes an empty cell. */
export interface RunListExportNames {
    testset: string | null
    application: string | null
    query: string | null
    createdBy: string | null
}

/**
 * One run's export line, in the order of {@link runListExportHeaders}. A metric cell is the text
 * the list cell prints; a run without the column's evaluator writes "—", as the old export does.
 */
export function runListExportRow(
    run: RunExportInput,
    plan: RunListColumns,
    {names, stats}: {names: RunListExportNames; stats: RunStatsMap | null},
): (string | number)[] {
    return [
        runExportStatus(run),
        runExportName(run),
        ...(plan.showKind ? [runExportKind(run)] : []),
        ...plan.references.map((reference) => names[reference] ?? ""),
        ...plan.evaluators.flatMap((group) =>
            group.columns.map((column) => {
                const stepKey = column.stepKeysByRunId[run.id]
                if (!stepKey) return METRIC_PLACEHOLDER
                const value = stats
                    ? selectRunMetricStats(stats, {metricKey: column.metricKey, stepKey})
                    : null
                return metricExportCell(metricExportValue(column.metricKey, value))
            }),
        ),
        ...plan.invocation.map((column) =>
            metricExportCell(
                metricExportValue(
                    column.metricKey,
                    stats ? selectRunMetricStats(stats, {metricKey: column.metricKey}) : null,
                ),
            ),
        ),
        runExportCreatedAt(run),
        names.createdBy ?? "",
    ]
}
