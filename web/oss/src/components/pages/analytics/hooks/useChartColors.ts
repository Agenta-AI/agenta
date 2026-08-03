import {theme} from "antd"

import {ThemeMode, useAppTheme} from "@/oss/components/Layout/ThemeContextProvider"

// House palette for the analytics charts (docs/design/agent-analytics, Phase 5).
// Series colors are the design contract's fixed light/dark pairs; chart chrome
// (grid, axis, track) stays on antd semantic tokens so it tracks the theme.
export const useChartColors = () => {
    const {token} = theme.useToken()
    const {appTheme} = useAppTheme()
    const dark = appTheme === ThemeMode.Dark
    const pick = (light: string, darkValue: string) => (dark ? darkValue : light)

    return {
        // Primary series (Successful / Avg latency / Cost / Prompt tokens) — cyan.
        primary: pick("#0891b2", "#22b8cf"),
        // Failed / secondary series — rose.
        failed: pick("#e11d48", "#f7658c"),
        // Latency p95 marker — amber.
        p95: pick("#faad14", "#d89614"),
        // Second stacked-series accent (Completion tokens) — lime.
        accent: pick("#d1d151", "#d1d151"),
        // Chart chrome from theme tokens.
        grid: token.colorBorder,
        axis: token.colorTextSecondary,
        track: token.colorFillSecondary,
    }
}

export type ChartColors = ReturnType<typeof useChartColors>
