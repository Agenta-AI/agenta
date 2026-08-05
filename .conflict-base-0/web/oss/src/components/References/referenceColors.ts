export type ReferenceTone = "app" | "variant" | "testset" | "query" | "evaluator" | "environment"

export interface ReferenceToneColors {
    text: string
    background: string
    border: string
}

// Backed by per-tone CSS variables (see styles/theme-variables.css): light =
// the exact original Untitled-UI hex (unchanged), dark = the matching antd
// preset. So reference chips are light-lossless yet adapt automatically in dark.
const REFERENCE_TONE_COLORS: Record<ReferenceTone, ReferenceToneColors> = {
    app: {
        text: "var(--ag-ref-app-text)",
        background: "var(--ag-ref-app-bg)",
        border: "var(--ag-ref-app-border)",
    },
    variant: {
        text: "var(--ag-ref-variant-text)",
        background: "var(--ag-ref-variant-bg)",
        border: "var(--ag-ref-variant-border)",
    },
    testset: {
        text: "var(--ag-ref-testset-text)",
        background: "var(--ag-ref-testset-bg)",
        border: "var(--ag-ref-testset-border)",
    },
    query: {
        text: "var(--ag-ref-query-text)",
        background: "var(--ag-ref-query-bg)",
        border: "var(--ag-ref-query-border)",
    },
    evaluator: {
        text: "var(--ag-ref-evaluator-text)",
        background: "var(--ag-ref-evaluator-bg)",
        border: "var(--ag-ref-evaluator-border)",
    },
    environment: {
        text: "var(--ag-ref-environment-text)",
        background: "var(--ag-ref-environment-bg)",
        border: "var(--ag-ref-environment-border)",
    },
}

export const getReferenceToneColors = (tone?: ReferenceTone | null) =>
    tone ? (REFERENCE_TONE_COLORS[tone] ?? null) : null
