/**
 * CSV export of evaluation runs, copied from the old app as pure functions: the cell escaping of
 * `@agenta/ui` `useTableExport`, and the value and header rules of
 * `EvaluationRunsTablePOC/hooks/useEvaluationRunsColumns/utils.tsx` and
 * `EvaluationRunsTable/export/*`. The caller resolves names (evaluators, members) and passes them in.
 *
 * @packageDocumentation
 */

import {formatMetricValue} from "./metricFormat"
import type {MetricStats} from "./metricStats"
import {deriveEvaluationKind, EVALUATION_KIND_LABELS, type RunKindInput} from "./runKind"

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
