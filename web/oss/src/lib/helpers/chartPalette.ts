/**
 * The one categorical chart series palette (recolor spec). Series are assigned in this fixed
 * order and cycle — never picked per item. Flat fills only; no gradient ramps.
 *
 * Pure by design (no React import): charts render as SVG presentation attributes (`fill=`/
 * `stroke=`), which take a plain color rather than a CSS `light-dark()` value, so components
 * resolve the mode with `useAppTheme()` and call `chartSeries(isDark)`.
 */
export const CHART_SERIES_LIGHT = ["#D97757", "#54B5FA", "#D9D92C", "#113955", "#9D9D9D"]
export const CHART_SERIES_DARK = ["#D1D151", "#8CCFFF", "#FF8E8C", "#8FBF7A", "#787878"]

export const chartSeries = (isDark: boolean): string[] =>
    isDark ? CHART_SERIES_DARK : CHART_SERIES_LIGHT

export const chartSeriesColor = (index: number, isDark: boolean): string => {
    const set = chartSeries(isDark)
    return set[((index % set.length) + set.length) % set.length]
}
