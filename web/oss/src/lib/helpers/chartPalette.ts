/**
 * The one categorical chart series palette. Series are assigned in this fixed order and cycle —
 * never picked per item. Flat fills only; no gradient ramps.
 *
 * Values come from `styles/theme/palette.ts` (the single source of truth) — this module only
 * flattens the {light, dark} pairs for the call sites that need a RESOLVED colour in JS, e.g.
 * deriving an area fill at 8% of the series colour. Everything that just paints a colour uses
 * the `var(--ag-chart-*)` custom properties instead, which follow the theme on their own.
 */
import {chartSeries as chartSeriesPairs} from "@/oss/styles/theme/palette"

const LIGHT = chartSeriesPairs.map((p) => p.light as string)
const DARK = chartSeriesPairs.map((p) => p.dark as string)

export const chartSeries = (isDark: boolean): string[] => (isDark ? DARK : LIGHT)
