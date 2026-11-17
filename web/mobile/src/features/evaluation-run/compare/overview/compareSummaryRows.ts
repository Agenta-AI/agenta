import type {ReactNode} from "react"

import {buildRunSummaryRows} from "../../overview/runSummaryRows"
import type {RunReferenceLinks} from "../../overview/useRunReferenceLinks"

import type {CompareRunOverview} from "./useCompareOverview"

/** One row of the compared summary: its label and the value of each run, base run first. */
export interface CompareSummaryRow {
    key: string
    label: ReactNode
    values: ReactNode[]
}

const MISSING = "—"
const PENDING = "…"

/**
 * The summary rows of every run, side by side: each run's rows as the single-run overview builds
 * them, joined by row key. A row only one run has (a metric of an evaluator the other run did not
 * use) reads "—" in the other columns.
 */
export function buildCompareSummaryRows(
    runs: readonly CompareRunOverview[],
    links?: RunReferenceLinks,
): CompareSummaryRow[] {
    const rowsByRun = runs.map((run) =>
        run.header
            ? buildRunSummaryRows({
                  header: run.header,
                  references: run.references,
                  metrics: run.metrics,
                  metricsPending: run.metricsPending,
                  names: run.names,
                  links,
              })
            : null,
    )
    const order = new Map<string, ReactNode>()
    for (const rows of rowsByRun) {
        for (const row of rows ?? []) if (!order.has(row.key)) order.set(row.key, row.label)
    }
    return [...order].map(([key, label]) => ({
        key,
        label,
        values: rowsByRun.map((rows) =>
            rows ? (rows.find((row) => row.key === key)?.value ?? MISSING) : PENDING,
        ),
    }))
}
