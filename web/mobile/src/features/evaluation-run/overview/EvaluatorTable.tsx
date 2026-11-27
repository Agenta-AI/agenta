import {histogramBarsOf, type EvaluatorRow} from "@agenta/entities/evaluationRun"
import {useT} from "@agenta/i18n"
import runOverviewCatalog from "@agenta/i18n/catalogs/evaluations.runOverview"

import {MetricCell} from "./MetricCell"

const COLUMNS = "grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-[240px_minmax(0,1fr)]"

const Swatch = ({className}: {className: string}) => (
    <span aria-hidden className={`inline-block h-1.5 w-2.5 rounded-xs ${className}`} />
)

/**
 * One row per evaluator step, every metric of the step inside its row, then a legend for the
 * kinds of cells the table draws.
 */
export const EvaluatorTable = ({
    rows,
    noResultByStep,
}: {
    rows: readonly EvaluatorRow[]
    /** By step key: the test cases that ran where the evaluator failed. */
    noResultByStep?: Readonly<Record<string, number>>
}) => {
    const t = useT(runOverviewCatalog)
    const metrics = rows.flatMap((row) => row.metrics)
    const hasBinary = metrics.some((metric) => metric.kind === "binary" && metric.stats)
    const histograms = metrics
        .filter((metric) => metric.kind === "numeric")
        .map((metric) => histogramBarsOf(metric.stats))
        .filter((bars) => bars.length > 0)
    const allUnit = histograms.every((bars) => bars[0].from === 0 && bars[bars.length - 1].to === 1)

    return (
        <div className="flex flex-col gap-2">
            <div
                role="table"
                className="box-border overflow-hidden rounded-lg border border-solid border-border"
            >
                <div
                    role="row"
                    className={`${COLUMNS} items-center bg-muted px-3 py-2 text-meta text-muted-foreground max-sm:hidden`}
                >
                    <span role="columnheader">{t("evaluations.runOverview.evaluator")}</span>
                    <span role="columnheader">{t("evaluations.runOverview.metrics")}</span>
                </div>
                {rows.map((row) => (
                    <div
                        key={row.stepKey}
                        role="row"
                        data-testid={`evaluator-${row.stepKey}`}
                        className={`${COLUMNS} items-start border-0 border-t border-solid border-border-muted px-3 py-2.5`}
                    >
                        <div role="cell" className="flex min-w-0 flex-col gap-0.5">
                            <span className="break-words text-label text-foreground">
                                {row.name}
                            </span>
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
                            className="grid grid-cols-[repeat(auto-fit,minmax(max(200px,calc((100%_-_3rem)/3)),1fr))] gap-x-6 gap-y-3"
                        >
                            {row.metrics.map((metric) => (
                                <MetricCell
                                    key={metric.id}
                                    metric={metric}
                                    noResult={noResultByStep?.[row.stepKey]}
                                />
                            ))}
                        </div>
                    </div>
                ))}
            </div>
            {hasBinary || histograms.length > 0 ? (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-muted-foreground">
                    {hasBinary ? (
                        <>
                            <span className="inline-flex items-center gap-1.5">
                                <Swatch className="bg-success" />
                                {t("evaluations.runOverview.passed")}
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                                <Swatch className="bg-destructive" />
                                {t("evaluations.runOverview.failed")}
                            </span>
                        </>
                    ) : null}
                    {histograms.length > 0 ? (
                        <span className="inline-flex items-center gap-1.5">
                            <Swatch className="bg-data-1" />
                            {allUnit
                                ? t("evaluations.runOverview.scoreLegendUnit")
                                : t("evaluations.runOverview.scoreLegend")}
                        </span>
                    ) : null}
                </div>
            ) : null}
        </div>
    )
}
