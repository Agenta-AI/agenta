/**
 * The toolbar over the evaluator table as data: search, filter by evaluator and sort of the rows
 * of {@link buildEvaluatorRows}. Pure: no React. The chart does not read it.
 *
 * @packageDocumentation
 */

import {chartValue, type EvaluatorRow} from "./evaluatorRows"

/** "lowest": by the row's lowest chart value, rows with none last. "name": by evaluator name. */
export type EvaluatorRowSort = "lowest" | "name"

export interface EvaluatorRowsView {
    /** Matches the evaluator name or a metric label; case is ignored. */
    search: string
    /** Step keys of the rows the filter hides. */
    hidden: readonly string[]
    sort: EvaluatorRowSort
}

/** The lowest chart value of the row's metrics (a pass rate or a mean on 0 to 1), else null. */
export function lowestChartValue(row: EvaluatorRow): number | null {
    let lowest: number | null = null
    for (const metric of row.metrics) {
        const value = chartValue(metric.stats)
        if (value !== null && (lowest === null || value < lowest)) lowest = value
    }
    return lowest
}

const byName = (a: EvaluatorRow, b: EvaluatorRow) =>
    a.name.localeCompare(b.name) || a.stepKey.localeCompare(b.stepKey)

/**
 * The rows the table shows: a row matches the search by its name or one of its metric labels and
 * then keeps all its metrics; a hidden row is left out.
 */
export function filterAndSortRows(
    rows: readonly EvaluatorRow[],
    {search, hidden, sort}: EvaluatorRowsView,
): EvaluatorRow[] {
    const term = search.trim().toLowerCase()
    const shown = rows.filter(
        (row) =>
            !hidden.includes(row.stepKey) &&
            (!term ||
                row.name.toLowerCase().includes(term) ||
                row.metrics.some((metric) => metric.label.toLowerCase().includes(term))),
    )
    if (sort === "name") return shown.sort(byName)
    const lowest = new Map(shown.map((row) => [row.stepKey, lowestChartValue(row)]))
    return shown.sort((a, b) => {
        const va = lowest.get(a.stepKey) ?? null
        const vb = lowest.get(b.stepKey) ?? null
        if (va === null || vb === null) return va === null ? (vb === null ? byName(a, b) : 1) : -1
        return va - vb || byName(a, b)
    })
}
