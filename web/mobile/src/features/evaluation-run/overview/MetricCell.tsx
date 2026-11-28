import type {ReactNode} from "react"

import {
    binaryCounts,
    categorySegments,
    histogramBarsOf,
    isUnitScale,
    type EvaluatorRowMetric,
} from "@agenta/entities/evaluationRun"
import {formatNumber, useT} from "@agenta/i18n"
import runOverviewCatalog from "@agenta/i18n/catalogs/evaluations.runOverview"
import {MiniHistogram, ShareBar} from "@agenta/ui/components/presentational/charts"

/** `data-1` to `data-6` in order, then again from `data-1` (COLOR-05). */
const dataColor = (index: number) => `var(--data-${(index % 6) + 1})`

// Numbers in the chosen language: "75 %" and "0,82" in German.
const percent = (share: number) => formatNumber(share, {style: "percent", maximumFractionDigits: 0})
/** 3 significant digits, as `format3Sig`. */
const sig3 = (value: number) => formatNumber(value, {maximumSignificantDigits: 3})
/** A mean on 0 to 1 with 2 decimals, else 3 significant digits, as `formatMean`. */
const mean = (value: number, unitScale: boolean) =>
    unitScale
        ? formatNumber(value, {minimumFractionDigits: 2, maximumFractionDigits: 2})
        : sig3(value)

/** One metric of an evaluator row, drawn by its kind: binary, numeric or categorical. */
export const MetricCell = ({
    metric,
    noResult = 0,
}: {
    metric: EvaluatorRowMetric
    /** Test cases that ran where this metric's evaluator failed. */
    noResult?: number
}) => {
    const t = useT(runOverviewCatalog)
    const {stats, kind, label} = metric

    let value: ReactNode = null
    let sub: string | null = null
    let body: ReactNode = null

    if (!stats) {
        sub = t("evaluations.runOverview.noResultsYet")
    } else if (kind === "binary") {
        const {passed, failed} = binaryCounts(stats)
        const total = passed + failed
        if (total > 0) {
            const all = total + noResult
            value = percent(passed / total)
            sub =
                noResult > 0
                    ? t("evaluations.runOverview.passedOfTotalNoResult", {passed, total, noResult})
                    : t("evaluations.runOverview.passedOfTotal", {passed, total})
            body = (
                <ShareBar
                    title={t("evaluations.runOverview.passedFailed", {passed, failed})}
                    segments={[
                        {key: "passed", share: passed / all, color: "var(--success)"},
                        {key: "failed", share: failed / all, color: "var(--destructive)"},
                        {
                            key: "noResult",
                            share: noResult / all,
                            color: "var(--border-strong)",
                            striped: true,
                        },
                    ]}
                />
            )
        } else {
            sub = t("evaluations.runOverview.noResultsYet")
        }
    } else if (kind === "numeric") {
        value = stats.mean === undefined ? "—" : mean(stats.mean, isUnitScale(stats))
        sub =
            noResult > 0
                ? t("evaluations.runOverview.meanNoResult", {noResult})
                : t("evaluations.runOverview.mean")
        const bars = histogramBarsOf(stats)
        const total = stats.count ?? bars.reduce((sum, bar) => sum + bar.count, 0)
        if (bars.length > 0) {
            body = (
                <MiniHistogram
                    label={label}
                    start={sig3(bars[0].from)}
                    end={sig3(bars[bars.length - 1].to)}
                    bars={bars.map((bar, index) => ({
                        key: String(index),
                        share: bar.share,
                        title: t("evaluations.runOverview.binTooltip", {
                            from: sig3(bar.from),
                            to: sig3(bar.to),
                            count: bar.count,
                            total,
                        }),
                    }))}
                />
            )
        }
    } else {
        const segments = categorySegments(stats)
        const caption = segments
            .map((segment) => `${segment.label} ${percent(segment.share)}`)
            .join(", ")
        body = (
            <>
                <ShareBar
                    label={caption}
                    className="bg-transparent"
                    segments={segments.map((segment, index) => ({
                        key: segment.label,
                        share: segment.share,
                        color: dataColor(index),
                        title: `${segment.label} ${percent(segment.share)}`,
                    }))}
                />
                <span className="truncate text-meta text-muted-foreground" title={caption}>
                    {caption}
                </span>
            </>
        )
    }

    return (
        <div data-testid={`metric-${metric.id}`} className="flex min-w-0 flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-meta text-muted-foreground" title={label}>
                    {label}
                </span>
                {value !== null || sub ? (
                    <span className="shrink-0 text-label tabular-nums text-foreground">
                        {value}
                        {value !== null && sub ? " " : null}
                        {sub ? (
                            <span className="text-meta text-muted-foreground">{sub}</span>
                        ) : null}
                    </span>
                ) : null}
            </div>
            {body}
        </div>
    )
}
