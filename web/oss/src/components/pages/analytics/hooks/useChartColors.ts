import {theme} from "antd"

// Palette matched to the home-page (Observability) charts: cyan for every primary
// series and rose for every secondary series, identical in light and dark. Chart
// chrome (grid, axis, track) stays on antd tokens so it tracks the theme.
export const useChartColors = () => {
    const {token} = theme.useToken()

    return {
        // Primary series (Successful / Avg latency / Cost / Prompt & total tokens).
        primary: "#0891b2",
        // Secondary series (Failed / Completion tokens).
        failed: "#e11d48",
        // p95 is a distribution stat, not a failure — a neutral grey keeps it from
        // reading as an error next to the danger-red "Failed" series.
        p95: "#6b7280",
        accent: "#e11d48",
        // Chart chrome from theme tokens.
        grid: token.colorBorder,
        axis: token.colorTextSecondary,
        track: token.colorFillSecondary,
    }
}

export type ChartColors = ReturnType<typeof useChartColors>
