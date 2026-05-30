export type ReferenceTone = "app" | "variant" | "testset" | "query" | "evaluator" | "environment"

export interface ReferenceToneColors {
    text: string
    background: string
    border: string
}

// Backed by antd preset-palette CSS variables (emitted via ConfigProvider's
// cssVar mode). Each tone uses {text: -7, background: -1, border: -3}, so the
// chips adapt to light/dark automatically — antd swaps the palette under the
// active algorithm. (Previously bespoke Untitled-UI hex that stayed light in
// dark mode.)
const REFERENCE_TONE_COLORS: Record<ReferenceTone, ReferenceToneColors> = {
    app: {
        text: "var(--ant-blue-7)",
        background: "var(--ant-blue-1)",
        border: "var(--ant-blue-3)",
    },
    variant: {
        text: "var(--ant-green-7)",
        background: "var(--ant-green-1)",
        border: "var(--ant-green-3)",
    },
    testset: {
        text: "var(--ant-purple-7)",
        background: "var(--ant-purple-1)",
        border: "var(--ant-purple-3)",
    },
    query: {
        text: "var(--ant-volcano-7)",
        background: "var(--ant-volcano-1)",
        border: "var(--ant-volcano-3)",
    },
    evaluator: {
        text: "var(--ant-magenta-7)",
        background: "var(--ant-magenta-1)",
        border: "var(--ant-magenta-3)",
    },
    environment: {
        text: "var(--ant-cyan-7)",
        background: "var(--ant-cyan-1)",
        border: "var(--ant-cyan-3)",
    },
}

export const getReferenceToneColors = (tone?: ReferenceTone | null) =>
    tone ? (REFERENCE_TONE_COLORS[tone] ?? null) : null
