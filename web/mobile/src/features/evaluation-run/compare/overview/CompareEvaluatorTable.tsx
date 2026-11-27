import type {ReactNode} from "react"

import {
    binaryCounts,
    categorySegments,
    format3Sig,
    formatMean,
    type CompareEvaluatorRow,
    type CompareRowMetric,
} from "@agenta/entities/evaluationRun"
import {useT} from "@agenta/i18n"
import runOverviewCatalog from "@agenta/i18n/catalogs/evaluations.runOverview"
import {ShareBar} from "@agenta/ui/components/presentational/charts"
import {Badge} from "@agenta/ui/ui"

import {dataColor, percent} from "../../overview/MetricCell"
import {compareColor} from "../compareColor"

import {RunSwatch, type CompareColumn} from "./CompareSummaryTable"
import {useChangeText} from "./useChangeText"

const COLUMNS = "grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-[240px_minmax(0,1fr)]"

const BADGE = {up: "success", down: "destructive", flat: "default"} as const

const directionOf = (change: NonNullable<CompareRowMetric["change"]>) => {
    const size =
        change.kind === "points" ? change.points : change.kind === "difference" ? change.delta : 0
    return size > 0 ? "up" : size < 0 ? "down" : "flat"
}

/** One run's line of a metric: a bar in the run's color, then the value. */
const MetricLine = ({
    column,
    bar,
    value,
    sub,
}: {
    column: CompareColumn
    bar: ReactNode
    value: string
    sub?: string
}) => (
    <div data-testid={`line-${column.runId}`} className="flex min-w-0 items-center gap-2">
        <span className="sr-only">{column.name}</span>
        <div className="min-w-0 flex-1">{bar}</div>
        <span className="w-24 shrink-0 truncate text-right text-meta tabular-nums text-foreground">
            {value}
            {sub ? <span className="text-muted-foreground"> {sub}</span> : null}
        </span>
    </div>
)

/** One metric of a compare row: its label and change badge, then one line per run. */
const CompareMetricCell = ({
    metric,
    columns,
}: {
    metric: CompareRowMetric
    columns: readonly CompareColumn[]
}) => {
    const t = useT(runOverviewCatalog)
    const changeText = useChangeText()
    // One color per category value in every run, in the order the runs first show them.
    const categories =
        metric.kind === "categorical"
            ? [
                  ...new Set(
                      metric.stats.flatMap((stats) =>
                          categorySegments(stats).map((segment) => segment.label),
                      ),
                  ),
              ]
            : []

    const lineOf = (index: number, column: CompareColumn) => {
        const stats = metric.stats[index]
        const color = compareColor(column.slot)
        const track = (share: number) => (
            <ShareBar label={column.name} segments={[{key: column.runId, share, color}]} />
        )
        if (metric.kind === "binary") {
            const {passed, failed} = binaryCounts(stats)
            const total = passed + failed
            if (!stats || total === 0) return {bar: track(0), value: "—"}
            return {
                bar: track(passed / total),
                value: percent(passed / total),
                sub: t("evaluations.runOverview.passedOfTotal", {passed, total}),
            }
        }
        if (metric.kind === "numeric") {
            const mean = stats?.mean
            if (mean === undefined) return {bar: metric.unitScale ? track(0) : null, value: "—"}
            return {
                bar: metric.unitScale ? track(mean) : null,
                value: formatMean(mean, metric.unitScale),
                sub: t("evaluations.runOverview.mean"),
            }
        }
        const segments = categorySegments(stats)
        const caption = segments
            .map((segment) => `${segment.label} ${percent(segment.share)}`)
            .join(", ")
        return {
            bar: (
                <div className="flex items-center gap-1.5">
                    <RunSwatch slot={column.slot} />
                    <ShareBar
                        label={`${column.name}: ${caption}`}
                        segments={segments.map((segment) => ({
                            key: segment.label,
                            share: segment.share,
                            color: dataColor(categories.indexOf(segment.label)),
                            title: `${segment.label} ${percent(segment.share)}`,
                        }))}
                    />
                </div>
            ),
            value: segments[0] ? `${segments[0].label} ${percent(segments[0].share)}` : "—",
        }
    }

    return (
        <div data-testid={`metric-${metric.id}`} className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
                <span className="truncate text-meta text-muted-foreground" title={metric.label}>
                    {metric.label}
                </span>
                {metric.change ? (
                    <Badge
                        data-testid="compare-change"
                        variant={BADGE[directionOf(metric.change)]}
                        className="tabular-nums"
                    >
                        {changeText(metric.change, (value) =>
                            metric.unitScale ? value.toFixed(2) : format3Sig(value),
                        )}
                    </Badge>
                ) : null}
            </div>
            {columns.map((column, index) => (
                <MetricLine key={column.runId} column={column} {...lineOf(index, column)} />
            ))}
        </div>
    )
}

/** One row per evaluator of the compared runs; each metric has one line per run. */
export const CompareEvaluatorTable = ({
    rows,
    columns,
}: {
    rows: readonly CompareEvaluatorRow[]
    columns: readonly CompareColumn[]
}) => {
    const t = useT(runOverviewCatalog)
    return (
        <div
            role="table"
            className="box-border overflow-hidden rounded-lg border border-solid border-border"
        >
            <div
                role="row"
                className={`${COLUMNS} items-center bg-muted px-3 py-2 text-meta text-muted-foreground max-sm:hidden`}
            >
                <span role="columnheader">{t("evaluations.runOverview.evaluator")}</span>
                <span role="columnheader">{t("evaluations.runOverview.metricsPerEvaluation")}</span>
            </div>
            {rows.map((row) => (
                <div
                    key={row.key}
                    role="row"
                    data-testid={`evaluator-${row.key}`}
                    className={`${COLUMNS} items-start border-0 border-t border-solid border-border-muted px-3 py-2.5`}
                >
                    <div role="cell" className="flex min-w-0 flex-col gap-0.5">
                        <span className="break-words text-label text-foreground">{row.name}</span>
                        <span className="text-meta text-muted-foreground">
                            {row.metrics.length > 0
                                ? t("evaluations.runOverview.metricCount", {
                                      count: row.metrics.length,
                                  })
                                : t("evaluations.runOverview.noResultsYet")}
                        </span>
                    </div>
                    <div
                        role="cell"
                        className="grid grid-cols-[repeat(auto-fit,minmax(max(220px,calc((100%_-_2rem)/2)),1fr))] gap-x-8 gap-y-3"
                    >
                        {row.metrics.map((metric) => (
                            <CompareMetricCell key={metric.id} metric={metric} columns={columns} />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    )
}
