import {formatMean, type ChartMetric} from "@agenta/entities/evaluationRun"

/** A chart value as the table prints it: a pass rate as "63%", a mean on 0 to 1 as "0.82". */
export const chartValueText = (kind: ChartMetric["kind"], value: number): string =>
    kind === "binary" ? `${Math.round(value * 100)}%` : formatMean(value, true)

/** The bar color of a metric kind when one run is drawn (the legend under the bars). */
export const KIND_COLOR: Record<ChartMetric["kind"], string> = {
    binary: "var(--data-2)",
    numeric: "var(--data-1)",
}

/** The color of run `index` when several runs are drawn. */
export const runColor = (index: number) => `var(--data-${(index % 6) + 1})`
