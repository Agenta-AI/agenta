import {theme} from "antd"

// Theme-aware series and chrome colors for the analytics charts. All values come
// from antd tokens (semantic + preset palettes) so both light and dark themes
// track the design system; no literals. See web/AGENTS.md "Styling".
export const useChartColors = () => {
    const {token} = theme.useToken()

    return {
        // Shared primary series (Successful / Avg / Prompt) — the design's blue.
        // Brand colorPrimary is navy/yellow, so use the geekblue preset instead.
        primary: token.geekblue5,
        // Health/success semantics (green) — distinct from the blue primary series.
        success: token.colorSuccess,
        failed: token.colorError,
        // Latency p95 marker.
        latency: token.geekblue5,
        p95: token.colorWarning,
        // Cost / token completion split.
        prompt: token.geekblue5,
        completion: token.purple5,
        // Health bands + soft badge/pill backgrounds.
        healthy: token.colorSuccess,
        watch: token.colorWarning,
        atRisk: token.colorError,
        neutral: token.colorTextQuaternary,
        successBg: token.colorSuccessBg,
        warningBg: token.colorWarningBg,
        errorBg: token.colorErrorBg,
        neutralBg: token.colorFillTertiary,
        // Chart chrome. `grid` uses the stronger border token so the dotted grid
        // reads clearly; `colorBorderSecondary` was too faint.
        grid: token.colorBorder,
        axis: token.colorTextSecondary,
        track: token.colorFillSecondary,
    }
}

export type ChartColors = ReturnType<typeof useChartColors>
