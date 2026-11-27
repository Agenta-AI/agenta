import {useMemo, useState} from "react"

import {
    buildMetricsChart,
    defaultChartSelection,
    type MetricsChartRun,
} from "@agenta/entities/evaluationRun"
import {useT} from "@agenta/i18n"
import runOverviewCatalog from "@agenta/i18n/catalogs/evaluations.runOverview"
import {BarChart, RadarChart} from "@agenta/ui/components/presentational/charts"
import {useIsNarrowScreen} from "@agenta/ui/hooks"
import {Segmented} from "@agenta/ui/ui"

import {MetricPicker} from "./MetricPicker"
import {chartValueText, KIND_COLOR, runColor} from "./metricsChartText"

/** One run of the chart. Compare passes one entry per run; the first one orders the metrics. */
export interface ChartRun extends MetricsChartRun {
    name: string
}

type Plot = "bars" | "radar"

const RADAR_MIN = 3
/** A bar is at most about this wide, so a few metrics do not draw huge bars. */
const BAR_SLOT = 72
const BAR_AXIS = 48

/**
 * The "Metrics" card: one value per metric on one 0 to 1 scale, as bars or a radar, with a metric
 * picker. The picker starts on the default (every metric, or the 16 lowest); once the user changes
 * it, it keeps the user's choice for this page view.
 */
export const MetricsChart = ({runs}: {runs: readonly ChartRun[]}) => {
    const t = useT(runOverviewCatalog)
    const narrow = useIsNarrowScreen()
    const model = useMemo(() => buildMetricsChart(runs), [runs])
    const [chosen, setChosen] = useState<ReadonlySet<string> | null>(null)
    const [plot, setPlot] = useState<Plot>("bars")

    const selected = chosen ?? new Set(defaultChartSelection(model.metrics))
    const picked = model.metrics.filter((metric) => selected.has(metric.id))
    const canRadar = picked.length >= RADAR_MIN
    const shown: Plot = canRadar ? plot : "bars"
    const single = runs.length === 1
    const firstKey = runs[0]?.key ?? ""

    // Only scores off the 0 to 1 scale: the card keeps the note that says why there is no chart.
    const empty = model.metrics.length === 0
    if (empty && model.offScale === 0) return null

    const toggle = (id: string) => {
        const next = new Set(selected)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        setChosen(next)
    }

    const kindByName = new Map(picked.map((metric) => [metric.name, metric.kind]))
    const series = runs.map((run, index) => ({
        key: run.key,
        name: run.name,
        color: single ? KIND_COLOR.numeric : runColor(index),
    }))
    const notes = empty
        ? []
        : [
              chosen === null
                  ? model.metrics.length > picked.length
                      ? t("evaluations.runOverview.chartLowestMetrics", {
                            selected: picked.length,
                            total: model.metrics.length,
                        })
                      : t("evaluations.runOverview.chartEveryMetric")
                  : null,
              t("evaluations.runOverview.chartUnitScale"),
              canRadar ? null : t("evaluations.runOverview.radarNeedsThree"),
          ].filter(Boolean)
    const kinds = single
        ? (["binary", "numeric"] as const).filter((kind) =>
              picked.some((metric) => metric.kind === kind),
          )
        : []

    return (
        <section
            aria-labelledby="run-metrics-chart"
            className="box-border flex flex-col gap-3 rounded-lg border border-solid border-border p-4"
        >
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                    <h2 id="run-metrics-chart" className="m-0 text-subtitle text-foreground">
                        {t("evaluations.runOverview.metrics")}
                    </h2>
                    {notes.length > 0 ? (
                        <p className="m-0 text-meta text-muted-foreground">{notes.join(" ")}</p>
                    ) : null}
                </div>
                {empty ? null : (
                    <div className="flex items-center gap-2">
                        <Segmented
                            size="sm"
                            aria-label={t("evaluations.runOverview.chartType")}
                            value={shown}
                            onChange={(value) => setPlot(value as Plot)}
                            options={[
                                {value: "bars", label: t("evaluations.runOverview.chartBars")},
                                {
                                    value: "radar",
                                    label: t("evaluations.runOverview.chartRadar"),
                                    disabled: !canRadar,
                                },
                            ]}
                        />
                        <MetricPicker
                            metrics={model.metrics}
                            selected={selected}
                            valueKey={firstKey}
                            onToggle={toggle}
                        />
                    </div>
                )}
            </div>
            {shown === "radar" ? (
                <RadarChart
                    title={t("evaluations.runOverview.radarChartLabel")}
                    height={narrow ? 260 : 330}
                    series={series}
                    axes={picked.map((metric) => ({
                        name: metric.name,
                        max: 1,
                        values: Object.fromEntries(
                            runs.map((run) => {
                                const value = metric.values[run.key]
                                return [
                                    run.key,
                                    value === null ? null : {normalized: value, raw: value},
                                ]
                            }),
                        ),
                    }))}
                    formatAxisValue={(raw, axis) =>
                        chartValueText(kindByName.get(axis.name) ?? "numeric", raw)
                    }
                />
            ) : picked.length > 0 ? (
                <div
                    className="mx-auto w-full"
                    style={{maxWidth: picked.length * runs.length * BAR_SLOT + BAR_AXIS}}
                >
                    <BarChart
                        title={t("evaluations.runOverview.barChartLabel")}
                        height={180}
                        series={series}
                        yMax={1}
                        verticalLabels
                        data={picked.map((metric) => ({
                            category: metric.name,
                            values: metric.values,
                        }))}
                        valueLabel={(value, category) =>
                            chartValueText(kindByName.get(category) ?? "numeric", value)
                        }
                        barColor={
                            single
                                ? (category) => KIND_COLOR[kindByName.get(category) ?? "numeric"]
                                : undefined
                        }
                    />
                </div>
            ) : null}
            {shown === "bars" && kinds.length > 0 ? (
                <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-meta text-muted-foreground">
                    {kinds.map((kind) => (
                        <li key={kind} className="flex items-center gap-1.5">
                            <span
                                aria-hidden
                                className="size-2 shrink-0 rounded-xs"
                                style={{background: KIND_COLOR[kind]}}
                            />
                            {kind === "binary"
                                ? t("evaluations.runOverview.legendPassRate")
                                : t("evaluations.runOverview.legendScoreMean")}
                        </li>
                    ))}
                </ul>
            ) : null}
            {model.offScale > 0 ? (
                <p className="m-0 text-meta text-muted-foreground">
                    {t("evaluations.runOverview.offScale", {count: model.offScale})}
                </p>
            ) : null}
        </section>
    )
}
