/** Every Analytics color; components read them as `var(--analytics-*)` from `ANALYTICS_COLOR_CSS`. */
const LIGHT = {
    cost: "#7e90a4",
    runs: "#b5b16c",
    success: "#88ad94",
    tokens: "#d2a08a",
    tools: "#a995b3",
    avgcost: "#88b0ad",
    failed: "#d99491",
    // Stacked series by rank, then the "Other" remainder.
    series1: "#7e90a4",
    series2: "#d2a08a",
    series3: "#b5b16c",
    series4: "#88b0ad",
    series5: "#a995b3",
    other: "#d7d5d1",
    // Failure reasons by rank, most common darkest.
    reason1: "#a32d2d",
    reason2: "#e24b4a",
    reason3: "#f09595",
    reason4: "#f7c1c1",
    // Status dots and text.
    dotOk: "#88ad94",
    dotFailed: "#d94c4a",
    textBad: "#b33a38",
    textWarn: "#9a6b1f",
    textGood: "#2e7d3a",
}

const DARK: typeof LIGHT = {
    ...LIGHT,
    other: "#4b4a48",
    reason1: "#f7c1c1",
    reason2: "#f09595",
    reason3: "#e24b4a",
    reason4: "#a32d2d",
    textBad: "#e5807e",
    textWarn: "#d7a75a",
    textGood: "#7fbf88",
}

export type AnalyticsColor = keyof typeof LIGHT

export const analyticsColor = (name: AnalyticsColor) => `var(--analytics-${name})`

export const REASON_COLORS: AnalyticsColor[] = ["reason1", "reason2", "reason3", "reason4"]

export const SERIES_COLORS: AnalyticsColor[] = [
    "series1",
    "series2",
    "series3",
    "series4",
    "series5",
]

const declarations = (palette: typeof LIGHT) =>
    Object.entries(palette)
        .map(([name, value]) => `--analytics-${name}:${value};`)
        .join("")

export const ANALYTICS_COLOR_CSS = `:root{${declarations(LIGHT)}}.dark{${declarations(DARK)}}`
