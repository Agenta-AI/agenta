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
    // Failure-rate bars: above and below the overall rate.
    failAbove: "#e3a9a5",
    failBelow: "#ecd2cf",
    // Failed-run bars under the success-rate line.
    failedRuns: "#ecc3c0",
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
    failBelow: "#6b4442",
    failedRuns: "#6b4442",
    textBad: "#e5807e",
    textWarn: "#d7a75a",
    textGood: "#7fbf88",
}

export type AnalyticsColor = keyof typeof LIGHT

export const analyticsColor = (name: AnalyticsColor) => `var(--analytics-${name})`

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
